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
import { getApiUrl } from "../api/client";
import { googleApi } from "../api/google";

const POLL_INTERVAL_MS = 10 * 60 * 1000;

type SSECalendarEvent = Omit<CalendarEvent, "created" | "updated"> & {
  created?: string | null;
  updated?: string | null;
};

interface SSEEventsPayload {
  calendar_id: string;
  events: SSECalendarEvent[];
}

export interface UseCalendarSyncOptions {
  calendarIds: string[];
  enabled?: boolean;
  pollInterval?: number;
}

export interface UseCalendarSyncResult {
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

  const eventSourceRef = useRef<EventSource | null>(null);
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

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const sync = useCallback(async () => {
    const ids = calendarIdsRef.current;
    if (!ids.length) return;
    if (syncPromiseRef.current) return syncPromiseRef.current;

    try {
      closeEventSource();
      startSync(ids);
      setProgress({
        eventsLoaded: 0,
        calendarsComplete: 0,
        totalCalendars: ids.length,
      });
      const url = `${getApiUrl()}/calendar/sync?calendar_ids=${ids.join(",")}`;

      const syncPromise = new Promise<void>((resolve, reject) => {
        const eventSource = new EventSource(url, { withCredentials: true });
        eventSourceRef.current = eventSource;

        let eventsLoaded = 0;
        let calendarsComplete = 0;
        let connectionOpened = false;
        let settled = false;

        const finalizeSync = () => {
          setIsLoading(false);
          eventSource.close();
          if (eventSourceRef.current === eventSource) {
            eventSourceRef.current = null;
          }
          syncPromiseRef.current = null;
          rejectSyncRef.current = null;
          completeSync();
        };

        const resolveSync = () => {
          if (settled) return;
          settled = true;
          finalizeSync();
          resolve();
        };

        const rejectSync = (reason: Error, errorMessage?: string) => {
          if (settled) return;
          settled = true;
          if (errorMessage) {
            setError(errorMessage);
          }
          finalizeSync();
          reject(reason);
        };

        rejectSyncRef.current = rejectSync;

        eventSource.onopen = () => {
          connectionOpened = true;
        };

        eventSource.addEventListener("events", async (e) => {
          try {
            const payload: SSEEventsPayload = JSON.parse(
              (e as MessageEvent).data,
            );
            await processEvents(payload);
            eventsLoaded += payload.events.length;
            setProgress((p) => ({ ...p, eventsLoaded }));
            setIsLoading(false);
          } catch (err) {
            console.error("Failed to process events:", err);
          }
        });

        eventSource.addEventListener("sync_token", () => {
          calendarsComplete++;
          setProgress((p) => ({ ...p, calendarsComplete }));
        });

        eventSource.addEventListener("sync_error", (e) => {
          try {
            const payload = JSON.parse((e as MessageEvent).data);
            console.error("Sync error:", payload);
            if (!payload.retryable) {
              setError(payload.message);
            }
          } catch {
            console.error("Failed to parse sync error payload");
          }
        });

        eventSource.addEventListener("complete", async (e) => {
          try {
            const payload = JSON.parse((e as MessageEvent).data);
            const syncedAt = payload.last_sync_at
              ? new Date(payload.last_sync_at)
              : new Date();
            await setLastSyncAt(syncedAt);
            setLastSyncAtState(syncedAt);
            lastKnownSyncRef.current = syncedAt.getTime();
            setProgress({
              eventsLoaded: payload.total_events,
              calendarsComplete: payload.calendars_synced,
              totalCalendars: ids.length,
            });
            resolveSync();
          } catch (err) {
            rejectSync(
              err instanceof Error
                ? err
                : new Error("Failed to finalize sync completion"),
            );
          }
        });

        eventSource.onerror = () => {
          if (!connectionOpened) {
            rejectSync(
              new Error("Unable to establish sync stream"),
              "Unable to start sync",
            );
            return;
          }

          if (eventSource.readyState === EventSource.CLOSED) {
            rejectSync(new Error("SSE connection closed"), "Connection lost");
            return;
          }
          console.warn("SSE connection dropped, retrying");
        };
      });
      syncPromiseRef.current = syncPromise;
      return syncPromise;
    } catch (error) {
      console.error("Sync failed:", error);
      completeSync();
    }
  }, [closeEventSource, startSync, completeSync, setError, processEvents]);

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
        await sync();
        return;
      }

      setIsLoading(false);
      sync().catch(() => {});
    },
    [hydrateFromSupabase, sync],
  );

  useEffect(() => {
    return () => {
      closeEventSource();
      if (rejectSyncRef.current) {
        rejectSyncRef.current(new Error("Component unmounted"));
        rejectSyncRef.current = null;
      }
      syncPromiseRef.current = null;
    };
  }, [closeEventSource]);

  useEffect(() => {
    if (!shouldStop) return;

    closeEventSource();
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
  }, [shouldStop, resetStopFlag, closeEventSource]);

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
        // non-critical — next interval will retry
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
