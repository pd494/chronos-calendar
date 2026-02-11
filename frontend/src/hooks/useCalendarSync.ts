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
import { isDesktop } from "../lib/platform";
import { getAccessToken } from "../lib/tokenStorage";
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

  // useRef holds mutable values that persist across re-renders without triggering
  // them. Unlike useState, changing a ref doesn't cause the component to re-render.
  // These refs track long-lived objects (timers, connections, promises) that exist
  // outside React's render cycle.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null); // setInterval handle for polling
  const initKeyRef = useRef<string | null>(null); // guards init per calendar ID set
  const calendarIdsRef = useRef(calendarIds); // latest IDs accessible in stale closures

  const eventSourceRef = useRef<EventSource | null>(null); // active SSE connection
  const syncPromiseRef = useRef<Promise<void> | null>(null); // deduplicates concurrent sync() calls
  const rejectSyncRef = useRef<((reason: Error) => void) | null>(null); // rejects sync Promise on abort/unmount

  calendarIdsRef.current = calendarIds;

  // Converts a batch of SSE calendar events into Dexie format and bulk-upserts
  // them into IndexedDB. Called each time the backend streams an "events" message.
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

  // Tears down the active SSE connection. Called before starting a new sync,
  // on component unmount, and when the user manually stops a sync.
  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Streams calendar events from /calendar/sync into IndexedDB. Two transport paths:
  //
  // Desktop: fetch() with Authorization header + ReadableStream. Manually parses the
  // SSE text format (split on \n\n, extract event:/data: lines). Straight async/await
  // flow — no Promise constructor needed since fetch is already Promise-based.
  //
  // Web: EventSource with cookies (withCredentials: true). Callback-based, so the
  // lifecycle is wrapped in a manual Promise — resolves on "complete", rejects on
  // connection loss or unmount.
  //
  // Both paths handle the same four SSE event types:
  //   "events"     — batch of calendar events, stored in Dexie
  //   "sync_token" — one calendar finished syncing
  //   "sync_error" — a calendar failed (may be retryable)
  //   "complete"   — all calendars done, connection closed
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

      // Desktop path: fetch-based SSE with bearer auth. Uses ReadableStream to read
      // chunks as they arrive, accumulates in a buffer, splits on \n\n to find complete
      // SSE messages. No Promise constructor needed — async/await all the way down.
      if (isDesktop()) {
        const desktopSync = async () => {
          const accessToken = await getAccessToken();
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (response.status === 429) {
            setIsLoading(false);
            setError("Sync rate limited, will retry on next poll");
            completeSync();
            syncPromiseRef.current = null;
            return;
          }

          if (!response.ok || !response.body) {
            setError("Failed to connect to sync");
            completeSync();
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let eventsLoaded = 0;
          let calendarsComplete = 0;
          let completed = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop()!;

            for (const part of parts) {
              if (!part.trim()) continue;
              let eventType = "";
              let data = "";
              for (const line of part.split("\n")) {
                if (line.startsWith("event: ")) eventType = line.slice(7);
                if (line.startsWith("data: ")) data = line.slice(6);
              }

              if (eventType === "events") {
                const payload: SSEEventsPayload = JSON.parse(data);
                await processEvents(payload);
                eventsLoaded += payload.events.length;
                setProgress((p) => ({ ...p, eventsLoaded }));
                setIsLoading(false);
              } else if (eventType === "sync_token") {
                calendarsComplete++;
                setProgress((p) => ({ ...p, calendarsComplete }));
              } else if (eventType === "sync_error") {
                const payload = JSON.parse(data);
                console.error("Sync error:", payload);
                if (!payload.retryable) setError(payload.message);
              } else if (eventType === "complete") {
                const payload = JSON.parse(data);
                const now = new Date();
                await setLastSyncAt(now);
                setLastSyncAtState(now);
                setProgress({
                  eventsLoaded: payload.total_events,
                  calendarsComplete: payload.calendars_synced,
                  totalCalendars: ids.length,
                });
                completeSync();
                completed = true;
              }
            }
          }
          if (!completed) completeSync();
        };

        const promise = desktopSync()
          .catch((err) => {
            setError("Connection lost");
            completeSync();
            throw err;
          })
          .finally(() => {
            syncPromiseRef.current = null;
            rejectSyncRef.current = null;
          });
        syncPromiseRef.current = promise;
        return promise;
      } else {
        const syncPromise = new Promise<void>((resolve, reject) => {
          rejectSyncRef.current = reject;
          // EventSource is the browser's built-in SSE client. It opens a long-lived HTTP
          // connection, auto-reconnects on drops, and parses the SSE text format into events.
          // withCredentials: true sends cookies cross-origin (needed for web auth).

          const eventSource = new EventSource(url, { withCredentials: true });
          eventSourceRef.current = eventSource;

          let eventsLoaded = 0;
          let calendarsComplete = 0;
          let connectionOpened = false;

          eventSource.onopen = () => {
            connectionOpened = true;
          };

          // Backend streams calendar events in batches as it fetches them from Google.
          // Each message contains a calendar_id and an array of events. We parse the JSON,
          // store in IndexedDB, and update progress. setIsLoading(false) fires here because
          // once the first batch arrives, we have data to render.
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

          // Fired when one calendar finishes syncing. The sync token itself (Google's
          // cursor for incremental sync) is handled server-side — frontend just tracks
          // how many calendars are done for the progress indicator.
          eventSource.addEventListener("sync_token", () => {
            calendarsComplete++;
            setProgress((p) => ({ ...p, calendarsComplete }));
          });

          // A calendar failed to sync. If retryable (e.g. temporary Google API error),
          // just log it — backend will retry next sync. If not retryable (e.g. permissions
          // revoked), surface the error to the UI.
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

          // All calendars done. Closes the connection, records sync timestamp in IndexedDB,
          // sets final progress from the server's summary, and resolves the wrapping Promise
          // so any `await sync()` unblocks.
          eventSource.addEventListener("complete", async (e) => {
            try {
              const payload = JSON.parse((e as MessageEvent).data);
              eventSource.close();
              eventSourceRef.current = null;

              const now = new Date();
              await setLastSyncAt(now);
              setLastSyncAtState(now);
              setProgress({
                eventsLoaded: payload.total_events,
                calendarsComplete: payload.calendars_synced,
                totalCalendars: ids.length,
              });
              completeSync();
              syncPromiseRef.current = null;
              rejectSyncRef.current = null;
              resolve();
            } catch (err) {
              syncPromiseRef.current = null;
              rejectSyncRef.current = null;
              reject(err);
            }
          });

          // EventSource has 3 readyStates: CONNECTING (0), OPEN (1), CLOSED (2).
          // On error, if readyState is CLOSED the connection is dead. Otherwise
          // EventSource is auto-reconnecting (built-in behavior) — just log a warning.
          eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) {
              eventSourceRef.current = null;
              syncPromiseRef.current = null;
              rejectSyncRef.current = null;

              if (!connectionOpened) {
                completeSync();
                resolve();
                return;
              }

              setError("Connection lost");
              reject(new Error("SSE connection closed"));
              return;
            }
            console.warn("SSE connection dropped, retrying");
          };
        });
        // Store the Promise so concurrent calls to sync() return the same one (line 101)
        // instead of opening duplicate connections.
        syncPromiseRef.current = syncPromise;
        return syncPromise;
      } // end else (web path)
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

    // Supabase is the shared source of truth across devices; overwrite local cache
    // for the calendars we care about.
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

      // If we already have something local, show it immediately while hydration runs.
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

      // Use server-side sync state (shared across devices) to update the UI timestamp.
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
      } else {
        setLastSyncAtState(null);
      }

      const noDataYet = hydratedCount === 0 && existingLocalCount === 0;

      // If there's nothing to show and we're in the initial foreground path,
      // keep the loader visible until SSE delivers the first batch.
      if (allowForegroundSync && noDataYet) {
        setIsLoading(true);
        await sync();
        return;
      }

      // Otherwise, paint immediately from Supabase hydration, then run delta sync
      // in the background (fast no-op when nothing changed).
      setIsLoading(false);
      sync().catch(() => {});
    },
    [hydrateFromSupabase, sync],
  );

  // Cleanup on unmount — closes the SSE connection and rejects any in-flight
  // sync Promise so callers aren't left hanging.
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

  // Handles user-initiated sync stop — tears down connection, rejects the
  // sync Promise, and clears the poll timer.
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
    resetStopFlag();
  }, [shouldStop, resetStopFlag, closeEventSource]);

  // Runs once on mount. Clears stale encrypted data, checks if Dexie already has
  // events. If yes, syncs in background (user sees cached data immediately). If
  // empty, syncs in foreground (user sees loading state until first events arrive).
  useEffect(() => {
    if (!enabled || !calendarIds.length) return;

    // Supabase-first: overwrite IndexedDB from Supabase, then run delta sync.
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

  // Re-syncs every pollInterval (default 5 min) to pick up changes made
  // outside the app (e.g. events added via Google Calendar web).
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

  return {
    isLoading,
    isSyncing,
    error,
    lastSyncAt,
    progress,
    sync,
  };
}
