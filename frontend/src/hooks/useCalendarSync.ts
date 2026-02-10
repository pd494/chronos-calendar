import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarEvent } from '../types'
import {
  db,
  upsertEvents,
  setLastSyncAt,
  getLastSyncAt,
  calendarEventToDexie,
  clearEncryptedEvents,
  type DexieEvent,
} from '../lib/db'
import { useSyncStore } from '../stores'
import { getApiUrl } from '../api/client'
import { isDesktop } from '../lib/platform'
import { getAccessToken } from '../lib/tokenStorage'

const POLL_INTERVAL_MS = 5 * 60 * 1000
const STALE_THRESHOLD_MS = POLL_INTERVAL_MS

type SSECalendarEvent = Omit<CalendarEvent, 'created' | 'updated'> & {
  created?: string | null
  updated?: string | null
}

interface SSEEventsPayload {
  calendar_id: string
  events: SSECalendarEvent[]
}

export interface UseCalendarSyncOptions {
  calendarIds: string[]
  enabled?: boolean
  pollInterval?: number
}

export interface UseCalendarSyncResult {
  isLoading: boolean
  isSyncing: boolean
  error: string | null
  lastSyncAt: Date | null
  progress: { eventsLoaded: number; calendarsComplete: number; totalCalendars: number }
  sync: () => Promise<void>
}

export function useCalendarSync({
  calendarIds,
  enabled = true,
  pollInterval = POLL_INTERVAL_MS,
}: UseCalendarSyncOptions): UseCalendarSyncResult {
  const [isLoading, setIsLoading] = useState(true)
  const [lastSyncAt, setLastSyncAtState] = useState<Date | null>(null)
  const [progress, setProgress] = useState({ eventsLoaded: 0, calendarsComplete: 0, totalCalendars: 0 })
  const { startSync, completeSync, setError, error, isSyncing: isSyncingFn, shouldStop, resetStopFlag } = useSyncStore()
  const isSyncing = isSyncingFn()

  // useRef holds mutable values that persist across re-renders without triggering
  // them. Unlike useState, changing a ref doesn't cause the component to re-render.
  // These refs track long-lived objects (timers, connections, promises) that exist
  // outside React's render cycle.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)       // setInterval handle for polling
  const initStartedRef = useRef(false)                                       // guards one-time init
  const calendarIdsRef = useRef(calendarIds)                                 // latest IDs accessible in stale closures
  const eventSourceRef = useRef<EventSource | null>(null)                    // active SSE connection
  const syncPromiseRef = useRef<Promise<void> | null>(null)                  // deduplicates concurrent sync() calls
  const rejectSyncRef = useRef<((reason: Error) => void) | null>(null)       // rejects sync Promise on abort/unmount

  // calendarIds is a prop that changes on re-render. Callbacks created with useCallback
  // capture the value at creation time (closure). This ref always points to the latest
  // value so callbacks don't need to be recreated when calendarIds changes.
  calendarIdsRef.current = calendarIds

  // Converts a batch of SSE calendar events into Dexie format and bulk-upserts
  // them into IndexedDB. Called each time the backend streams an "events" message.
  const processEvents = useCallback(async (payload: SSEEventsPayload) => {
    const now = new Date().toISOString()
    const dexieEvents: DexieEvent[] = payload.events.map((event) => ({
      ...calendarEventToDexie({
        ...event,
        created: event.created || now,
        updated: event.updated || now,
      }),
      pendingSupabaseSync: false,
    }))

    if (dexieEvents.length > 0) {
      await upsertEvents(dexieEvents)
    }
  }, [])

  // Tears down the active SSE connection. Called before starting a new sync,
  // on component unmount, and when the user manually stops a sync.
  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

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
    const ids = calendarIdsRef.current
    if (!ids.length) return
    if (syncPromiseRef.current) return syncPromiseRef.current

    closeEventSource()
    startSync(ids)
    setProgress({ eventsLoaded: 0, calendarsComplete: 0, totalCalendars: ids.length })
    const url = `${getApiUrl()}/calendar/sync?calendar_ids=${ids.join(',')}`

    // Desktop path: fetch-based SSE with bearer auth. Uses ReadableStream to read
    // chunks as they arrive, accumulates in a buffer, splits on \n\n to find complete
    // SSE messages. No Promise constructor needed — async/await all the way down.
    if (isDesktop()) {
      const desktopSync = async () => {
        const accessToken = await getAccessToken()
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        })

        if (!response.ok || !response.body) {
          setError('Failed to connect to sync')
          completeSync()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let eventsLoaded = 0
        let calendarsComplete = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const parts = buffer.split('\n\n')
          buffer = parts.pop()!

          for (const part of parts) {
            if (!part.trim()) continue
            let eventType = ''
            let data = ''
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7)
              if (line.startsWith('data: ')) data = line.slice(6)
            }

            if (eventType === 'events') {
              const payload: SSEEventsPayload = JSON.parse(data)
              await processEvents(payload)
              eventsLoaded += payload.events.length
              setProgress((p) => ({ ...p, eventsLoaded }))
              setIsLoading(false)
            } else if (eventType === 'sync_token') {
              calendarsComplete++
              setProgress((p) => ({ ...p, calendarsComplete }))
            } else if (eventType === 'sync_error') {
              const payload = JSON.parse(data)
              console.error('Sync error:', payload)
              if (!payload.retryable) setError(payload.message)
            } else if (eventType === 'complete') {
              const payload = JSON.parse(data)
              const now = new Date()
              await setLastSyncAt(now)
              setLastSyncAtState(now)
              setProgress({
                eventsLoaded: payload.total_events,
                calendarsComplete: payload.calendars_synced,
                totalCalendars: ids.length,
              })
              completeSync()
            }
          }
        }
        completeSync()
      }

      const promise = desktopSync().catch((err) => {
        setError('Connection lost')
        completeSync()
        throw err
      }).finally(() => {
        syncPromiseRef.current = null
        rejectSyncRef.current = null
      })
      syncPromiseRef.current = promise
      return promise

    } else {

    // Web path: EventSource with cookies. Callback-based API, so we wrap it in a
    // manually-constructed Promise. resolve/reject are captured and called from inside
    // the SSE event handlers (complete → resolve, connection lost → reject).
    const syncPromise = new Promise<void>((resolve, reject) => {
      rejectSyncRef.current = reject
      // EventSource is the browser's built-in SSE client. It opens a long-lived HTTP
      // connection, auto-reconnects on drops, and parses the SSE text format into events.
      // withCredentials: true sends cookies cross-origin (needed for web auth).
      
      const eventSource = new EventSource(url, { withCredentials: true })
      eventSourceRef.current = eventSource

      let eventsLoaded = 0
      let calendarsComplete = 0

      // Backend streams calendar events in batches as it fetches them from Google.
      // Each message contains a calendar_id and an array of events. We parse the JSON,
      // store in IndexedDB, and update progress. setIsLoading(false) fires here because
      // once the first batch arrives, we have data to render.
      eventSource.addEventListener('events', async (e) => {
        try {
          const payload: SSEEventsPayload = JSON.parse((e as MessageEvent).data)
          await processEvents(payload)
          eventsLoaded += payload.events.length
          setProgress((p) => ({ ...p, eventsLoaded }))
          setIsLoading(false)
        } catch (err) {
          console.error('Failed to process events:', err)
        }
      })

      // Fired when one calendar finishes syncing. The sync token itself (Google's
      // cursor for incremental sync) is handled server-side — frontend just tracks
      // how many calendars are done for the progress indicator.
      eventSource.addEventListener('sync_token', () => {
        calendarsComplete++
        setProgress((p) => ({ ...p, calendarsComplete }))
      })

      // A calendar failed to sync. If retryable (e.g. temporary Google API error),
      // just log it — backend will retry next sync. If not retryable (e.g. permissions
      // revoked), surface the error to the UI.
      eventSource.addEventListener('sync_error', (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data)
          console.error('Sync error:', payload)
          if (!payload.retryable) {
            setError(payload.message)
          }
        } catch {
          console.error('Failed to parse sync error payload')
        }
      })

      // All calendars done. Closes the connection, records sync timestamp in IndexedDB,
      // sets final progress from the server's summary, and resolves the wrapping Promise
      // so any `await sync()` unblocks.
      eventSource.addEventListener('complete', async (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data)
          eventSource.close()
          eventSourceRef.current = null

          const now = new Date()
          await setLastSyncAt(now)
          setLastSyncAtState(now)
          setProgress({
            eventsLoaded: payload.total_events,
            calendarsComplete: payload.calendars_synced,
            totalCalendars: ids.length,
          })
          completeSync()
          syncPromiseRef.current = null
          rejectSyncRef.current = null
          resolve()
        } catch (err) {
          syncPromiseRef.current = null
          rejectSyncRef.current = null
          reject(err)
        }
      })

      // EventSource has 3 readyStates: CONNECTING (0), OPEN (1), CLOSED (2).
      // On error, if readyState is CLOSED the connection is dead. Otherwise
      // EventSource is auto-reconnecting (built-in behavior) — just log a warning.
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null
          syncPromiseRef.current = null
          rejectSyncRef.current = null
          setError('Connection lost')
          reject(new Error('SSE connection closed'))
          return
        }
        console.warn('SSE connection dropped, retrying')
      }
    })
    // Store the Promise so concurrent calls to sync() return the same one (line 101)
    // instead of opening duplicate connections.
    syncPromiseRef.current = syncPromise
    return syncPromise

    } // end else (web path)
    // useCallback dependency array — this function is recreated only if these change.
    // All other values accessed inside (calendarIdsRef, syncPromiseRef, etc.) are refs
    // which are stable across renders, so they don't need to be listed.
  }, [closeEventSource, startSync, completeSync, setError, processEvents])

  // Fire-and-forget wrapper around sync(). Swallows errors so it can be used
  // safely in polling intervals and focus handlers without crashing the UI.
  const syncBackground = useCallback(async () => {
    try {
      await sync()
    } catch {
    }
  }, [sync])

  // Cleanup on unmount — closes the SSE connection and rejects any in-flight
  // sync Promise so callers aren't left hanging.
  useEffect(() => {
    return () => {
      closeEventSource()
      if (rejectSyncRef.current) {
        rejectSyncRef.current(new Error('Component unmounted'))
        rejectSyncRef.current = null
      }
      syncPromiseRef.current = null
    }
  }, [closeEventSource])

  // Handles user-initiated sync stop — tears down connection, rejects the
  // sync Promise, and clears the poll timer.
  useEffect(() => {
    if (!shouldStop) return

    closeEventSource()
    if (rejectSyncRef.current) {
      rejectSyncRef.current(new Error('Sync stopped'))
      rejectSyncRef.current = null
    }
    syncPromiseRef.current = null
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    resetStopFlag()
  }, [shouldStop, resetStopFlag, closeEventSource])

  // Runs once on mount. Clears stale encrypted data, checks if Dexie already has
  // events. If yes, syncs in background (user sees cached data immediately). If
  // empty, syncs in foreground (user sees loading state until first events arrive).
  useEffect(() => {
    if (!enabled || initStartedRef.current) return
    initStartedRef.current = true

    async function init() {
      await clearEncryptedEvents()

      const [totalDexieCount, storedLastSync] = await Promise.all([
        db.events.count(),
        getLastSyncAt(),
      ])

      setLastSyncAtState(storedLastSync)
      setIsLoading(false)

      if (totalDexieCount > 0) {
        syncBackground()
      } else if (calendarIdsRef.current.length) {
        sync()
      }
    }

    init()
  }, [enabled, sync, syncBackground])

  // Re-syncs every pollInterval (default 5 min) to pick up changes made
  // outside the app (e.g. events added via Google Calendar web).
  useEffect(() => {
    if (!enabled || !calendarIds.length || pollInterval <= 0) return

    pollRef.current = setInterval(syncBackground, pollInterval)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [calendarIds.length, enabled, pollInterval, syncBackground])

  // When the user switches back to the app, checks if data is stale (older than
  // STALE_THRESHOLD_MS). If so, triggers a background sync to catch up.
  const handleFocus = useCallback(() => {
    getLastSyncAt().then((storedLastSync) => {
      const isStale = !storedLastSync || Date.now() - storedLastSync.getTime() > STALE_THRESHOLD_MS
      if (isStale) {
        syncBackground()
      }
    })
  }, [syncBackground])

  useEffect(() => {
    if (!enabled || !calendarIds.length) return

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [calendarIds.length, enabled, handleFocus])

  return {
    isLoading,
    isSyncing,
    error,
    lastSyncAt,
    progress,
    sync,
  }
}
