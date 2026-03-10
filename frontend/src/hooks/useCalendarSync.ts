import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "../types";
import {
  db,
  upsertEvents,
  setLastSyncAt,
  getLastSyncAt,
  calendarEventToDexie,
  type DexieEvent,
} from "../lib/db";
import { useSyncStore } from "../stores";
import {
  getApiUrl,
  getCsrfToken,
  notifyUnauthorizedIfActive,
  withAuthSignal,
} from "../api/client";
import { googleApi } from "../api/google";

const POLL_INTERVAL_MS = 10 * 60 * 1000;
const MAX_FOREGROUND_SYNC_ATTEMPTS = 5;
const FOREGROUND_SYNC_RETRY_DELAY_MS = 1000;

type SSECalendarEvent = Omit<CalendarEvent, "created" | "updated"> & {
  created?: string | null;
  updated?: string | null;
};

interface SSEEventsPayload {
  calendar_id: string;
  events: SSECalendarEvent[];
}

interface UseCalendarSyncOptions {
  calendarIds: string[];
  enabled?: boolean;
  pollInterval?: number;
}

interface UseCalendarSyncResult {
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  lastSyncAt: Date | null;
  progress: {
    eventsLoaded: number;
    calendarsComplete: number;
    totalCalendars: number;
  };
  sync: () => Promise<void>;
}

export function useCalendarSync({
  calendarIds,
  enabled = true,
  pollInterval = POLL_INTERVAL_MS,
}: UseCalendarSyncOptions): UseCalendarSyncResult {
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncAt, setLastSyncAtState] = useState<Date | null>(null);
  const [progress, setProgress] = useState({
    eventsLoaded: 0,
    calendarsComplete: 0,
    totalCalendars: 0,
  });
  const {
    startSync,
    completeSync,
    setError,
    error,
    isSyncing: isSyncingFn,
    shouldStop,
    resetStopFlag,
  } = useSyncStore();
  const isSyncing = isSyncingFn();

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initKeyRef = useRef<string | null>(null);
  const calendarIdsRef = useRef(calendarIds);
  const lastKnownSyncRef = useRef<number>(0);
  const smartPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncAbortControllerRef = useRef<AbortController | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const rejectSyncRef = useRef<((reason: Error) => void) | null>(null);

  calendarIdsRef.current = calendarIds;

  const processEvents = useCallback(async (payload: SSEEventsPayload) => {
    const now = new Date().toISOString();
    const dexieEvents: DexieEvent[] = payload.events.map((event) =>
      calendarEventToDexie({
        ...event,
        created: event.created || now,
        updated: event.updated || now,
      }),
    );

    if (dexieEvents.length > 0) {
      await upsertEvents(dexieEvents);
    }
  }, []);

  const closeSyncStream = useCallback(() => {
    if (syncAbortControllerRef.current) {
      syncAbortControllerRef.current.abort();
      syncAbortControllerRef.current = null;
    }
  }, []);

  const resetInFlightSync = useCallback(() => {
    syncAbortControllerRef.current = null;
    syncPromiseRef.current = null;
    rejectSyncRef.current = null;
  }, []);

  const sync = useCallback(async () => {
    const ids = calendarIdsRef.current;
    if (!ids.length) return;
    if (syncPromiseRef.current) return syncPromiseRef.current;

    const failSync = (
      reject: (reason: Error) => void,
      reason: string,
      uiError?: string,
    ) => {
      if (uiError) {
        setError(uiError);
      }
      completeSync();
      resetInFlightSync();
      reject(new Error(reason));
    };

    try {
      closeSyncStream();
      startSync(ids);
      setProgress({
        eventsLoaded: 0,
        calendarsComplete: 0,
        totalCalendars: ids.length,
      });
      const params = new URLSearchParams({ calendar_ids: ids.join(",") });
      const url = `${getApiUrl()}/calendar/sync?${params.toString()}`;

      const syncPromise = new Promise<void>((resolve, reject) => {
        rejectSyncRef.current = reject;
        const abortController = new AbortController();
        syncAbortControllerRef.current = abortController;
        let eventsLoaded = 0;
        let calendarsComplete = 0;
        let shouldRetry = false;
        let completed = false;
        let csrfTokenOverride = getCsrfToken();

        const processEvent = async (eventName: string, data: string) => {
          if (eventName === "events") {
            try {
              const payload: SSEEventsPayload = JSON.parse(data);
              await processEvents(payload);
              eventsLoaded += payload.events.length;
              setProgress((p) => ({ ...p, eventsLoaded }));
              setIsLoading(false);
            } catch (err) {
              console.error("Failed to process events:", err);
            }
            return;
          }

          if (eventName === "sync_token") {
            calendarsComplete++;
            setProgress((p) => ({ ...p, calendarsComplete }));
            return;
          }

          if (eventName === "sync_error") {
            try {
              const payload = JSON.parse(data);
              console.error("Sync error:", payload);
              if (payload.retryable) {
                shouldRetry = true;
                abortController.abort();
                failSync(reject, "Retryable sync error");
                return;
              }
              if (!payload.retryable) {
                setError(payload.message);
              }
            } catch {
              console.error("Failed to parse sync error payload");
            }
            return;
          }

          if (eventName === "complete") {
            try {
              const payload = JSON.parse(data);
              completed = true;
              syncAbortControllerRef.current = null;

              const syncedAt = payload.last_sync_at
                ? new Date(payload.last_sync_at)
                : new Date();
              void (async () => {
                await setLastSyncAt(syncedAt);
                setLastSyncAtState(syncedAt);
                lastKnownSyncRef.current = syncedAt.getTime();
                setProgress({
                  eventsLoaded: payload.total_events,
                  calendarsComplete: payload.calendars_synced,
                  totalCalendars: ids.length,
                });
                completeSync();
                resetInFlightSync();
                resolve();
              })().catch((err) => {
                completeSync();
                resetInFlightSync();
                reject(
                  err instanceof Error
                    ? err
                    : new Error("Sync completion failed"),
                );
              });
              return;
            } catch (err) {
              completeSync();
              resetInFlightSync();
              reject(
                err instanceof Error
                  ? err
                  : new Error("Sync completion failed"),
              );
            }
          }
        };

        const readStream = async (hasRetriedCsrf: boolean) => {
          const requestAuthSignal = withAuthSignal();
          try {
            const headers = new Headers();
            if (csrfTokenOverride) {
              headers.set("X-CSRF-Token", csrfTokenOverride);
            }

            const response = await fetch(url, {
              credentials: "include",
              headers,
              signal: withAuthSignal(abortController.signal),
            });

            if (!response.ok) {
              let message = `API Error: ${response.status} ${response.statusText}`;
              let detail: string | null = null;
              try {
                const details = await response.json();
                if (
                  typeof details === "object" &&
                  details &&
                  "detail" in details
                ) {
                  detail = String((details as { detail: unknown }).detail);
                  message = detail;
                }
              } catch {
                const text = await response.text().catch(() => "");
                if (text) {
                  message = text;
                }
              }
              if (
                response.status === 403 &&
                !hasRetriedCsrf &&
                detail &&
                detail.includes("CSRF")
              ) {
                const csrfResponse = await fetch(`${getApiUrl()}/auth/csrf`, {
                  method: "GET",
                  credentials: "include",
                });
                if (csrfResponse.ok) {
                  csrfTokenOverride = getCsrfToken();
                  return readStream(true);
                }
              }
              if (response.status === 401) {
                notifyUnauthorizedIfActive(requestAuthSignal);
              }
              failSync(
                reject,
                `Sync request failed with status ${response.status}`,
                message,
              );
              return;
            }

            if (!response.body) {
              failSync(
                reject,
                "Sync stream missing body",
                "Failed to connect to sync stream",
              );
              return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const findEventBoundary = (value: string) => {
              const match = /(\r\n\r\n|\n\n)/.exec(value);
              if (!match || match.index === undefined) {
                return null;
              }
              return {
                index: match.index,
                length: match[0].length,
              };
            };

            const flushEventBlock = async (rawBlock: string) => {
              const block = rawBlock.replace(/\r/g, "").trim();
              if (!block || block.startsWith(":")) {
                return;
              }

              let eventName = "message";
              const dataLines: string[] = [];

              for (const line of block.split("\n")) {
                if (line.startsWith("event:")) {
                  eventName = line.slice(6).trim();
                  continue;
                }
                if (line.startsWith("data:")) {
                  dataLines.push(line.slice(5).trim());
                }
              }

              if (!dataLines.length) {
                return;
              }

              await processEvent(eventName, dataLines.join("\n"));
            };

            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  break;
                }
                buffer += decoder.decode(value, { stream: true });

                let boundary = findEventBoundary(buffer);
                while (boundary) {
                  const rawBlock = buffer.slice(0, boundary.index);
                  buffer = buffer.slice(boundary.index + boundary.length);
                  await flushEventBlock(rawBlock);
                  if (completed || shouldRetry) {
                    return;
                  }
                  boundary = findEventBoundary(buffer);
                }
              }

              buffer += decoder.decode();
              if (buffer) {
                await flushEventBlock(buffer);
              }
            } catch (error) {
              if (abortController.signal.aborted) {
                return;
              }

              failSync(reject, "SSE connection closed", "Connection lost");
              return;
            } finally {
              reader.releaseLock();
            }

            if (!completed && !shouldRetry && !abortController.signal.aborted) {
              failSync(reject, "SSE connection closed", "Connection lost");
            }
          } catch (error) {
            if (abortController.signal.aborted) {
              return;
            }
            failSync(reject, "SSE connection closed", "Connection lost");
          }
        };

        void readStream(false);
      });
      syncPromiseRef.current = syncPromise;
      return syncPromise;
    } catch (error) {
      console.error("Sync failed:", error);
      completeSync();
      resetInFlightSync();
    }
  }, [
    closeSyncStream,
    startSync,
    completeSync,
    setError,
    processEvents,
    resetInFlightSync,
  ]);

  const hydrateFromSupabase = useCallback(async (ids: string[]) => {
    const response = await googleApi.getEvents(ids);
    const allEvents = [
      ...response.events,
      ...response.masters,
      ...response.exceptions,
    ];

    const dexieEvents: DexieEvent[] = allEvents.map((event) =>
      calendarEventToDexie(event),
    );

    await db.transaction("rw", db.events, async () => {
      await db.events.where("calendarId").anyOf(ids).delete();
      if (dexieEvents.length > 0) {
        await db.events.bulkPut(dexieEvents);
      }
    });

    return { count: dexieEvents.length };
  }, []);

  const refreshFromSupabaseAndMaybeSync = useCallback(
    async (opts: { ids: string[]; allowForegroundSync: boolean }) => {
      const { ids, allowForegroundSync } = opts;

      const existingLocalCount = await db.events
        .where("calendarId")
        .anyOf(ids)
        .count();
      if (existingLocalCount > 0) {
        setIsLoading(false);
      }

      let hydratedCount = 0;
      try {
        const hydrated = await hydrateFromSupabase(ids);
        hydratedCount = hydrated.count;
      } catch (e) {
        console.error("Error hydrating from Supabase:", e);
      }

      let serverLastSyncAt: Date | null = null;
      try {
        const status = await googleApi.getSyncStatus(ids);
        serverLastSyncAt = status.lastSyncAt
          ? new Date(status.lastSyncAt)
          : null;
      } catch (e) {
        console.error("Error fetching sync status:", e);
      }

      if (serverLastSyncAt) {
        await setLastSyncAt(serverLastSyncAt);
        setLastSyncAtState(serverLastSyncAt);
        lastKnownSyncRef.current = serverLastSyncAt.getTime();
      } else {
        setLastSyncAtState(null);
      }

      const noDataYet = hydratedCount === 0 && existingLocalCount === 0;

      if (allowForegroundSync && noDataYet) {
        setIsLoading(true);
        for (
          let attempt = 0;
          attempt < MAX_FOREGROUND_SYNC_ATTEMPTS;
          attempt += 1
        ) {
          try {
            await sync();
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (
              message === "Component unmounted" ||
              message === "Sync stopped"
            ) {
              setIsLoading(false);
              return;
            }
            if (attempt < MAX_FOREGROUND_SYNC_ATTEMPTS - 1) {
              const retryDelayMs =
                FOREGROUND_SYNC_RETRY_DELAY_MS * 2 ** attempt;
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
              continue;
            }
            setError("Unable to sync right now. Please try again.");
            setIsLoading(false);
            return;
          }
        }
      }

      setIsLoading(false);
      sync().catch(() => {});
    },
    [hydrateFromSupabase, setError, sync],
  );

  useEffect(() => {
    return () => {
      closeSyncStream();
      if (rejectSyncRef.current) {
        rejectSyncRef.current(new Error("Component unmounted"));
        rejectSyncRef.current = null;
      }
      syncPromiseRef.current = null;
    };
  }, [closeSyncStream]);

  useEffect(() => {
    if (!shouldStop) return;

    closeSyncStream();
    if (rejectSyncRef.current) {
      rejectSyncRef.current(new Error("Sync stopped"));
      rejectSyncRef.current = null;
    }
    syncPromiseRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (smartPollRef.current) {
      clearInterval(smartPollRef.current);
      smartPollRef.current = null;
    }
    resetStopFlag();
  }, [shouldStop, resetStopFlag, closeSyncStream]);

  useEffect(() => {
    if (!enabled || !calendarIds.length) return;

    const nextInitKey = [...calendarIds].sort().join(",");
    if (initKeyRef.current === nextInitKey) return;
    initKeyRef.current = nextInitKey;

    async function init() {
      const storedLastSync = await getLastSyncAt();
      setLastSyncAtState(storedLastSync);

      await refreshFromSupabaseAndMaybeSync({
        ids: calendarIds,
        allowForegroundSync: true,
      });
    }

    init();
  }, [enabled, calendarIds, refreshFromSupabaseAndMaybeSync]);

  useEffect(() => {
    if (!enabled || !calendarIds.length || pollInterval <= 0) return;

    pollRef.current = setInterval(() => {
      sync().catch(() => {});
    }, pollInterval);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [calendarIds.length, enabled, pollInterval, sync]);

  useEffect(() => {
    if (!enabled || !calendarIds.length) return;

    smartPollRef.current = setInterval(async () => {
      if (syncPromiseRef.current) return;
      try {
        const status = await googleApi.getSyncStatus(calendarIds);
        const serverTs = status.lastSyncAt
          ? new Date(status.lastSyncAt).getTime()
          : 0;
        if (serverTs > lastKnownSyncRef.current) {
          lastKnownSyncRef.current = serverTs;
          await hydrateFromSupabase(calendarIds);
          const serverDate = new Date(serverTs);
          await setLastSyncAt(serverDate);
          setLastSyncAtState(serverDate);
        }
      } catch {
        return;
      }
    }, 60_000);

    return () => {
      if (smartPollRef.current) {
        clearInterval(smartPollRef.current);
        smartPollRef.current = null;
      }
    };
  }, [enabled, calendarIds, hydrateFromSupabase]);

  return {
    isLoading,
    isSyncing,
    error,
    lastSyncAt,
    progress,
    sync,
  };
}
