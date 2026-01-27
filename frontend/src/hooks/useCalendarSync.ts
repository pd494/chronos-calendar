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

const POLL_INTERVAL_MS = 5 * 60 * 1000
const STALE_THRESHOLD_MS = 5 * 60 * 1000

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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const initStartedRef = useRef(false)
  const calendarIdsRef = useRef(calendarIds)
  const eventSourceRef = useRef<EventSource | null>(null)
  const syncPromiseRef = useRef<Promise<void> | null>(null)

  calendarIdsRef.current = calendarIds

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

  const sync = useCallback(async () => {
    const ids = calendarIdsRef.current
    if (!ids.length) return
    if (syncPromiseRef.current) return syncPromiseRef.current

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    startSync(ids)
    setProgress({ eventsLoaded: 0, calendarsComplete: 0, totalCalendars: ids.length })

    const syncPromise = new Promise<void>((resolve, reject) => {
      const baseUrl = getApiUrl()
      const url = `${baseUrl}/calendar/sync?calendar_ids=${ids.join(',')}`
      const eventSource = new EventSource(url, { withCredentials: true })
      eventSourceRef.current = eventSource

      let eventsLoaded = 0
      let calendarsComplete = 0

      eventSource.addEventListener('events', async (e) => {
        try {
          const payload: SSEEventsPayload = JSON.parse((e as MessageEvent).data)
          await processEvents(payload)
          eventsLoaded += payload.events.length
          if (mountedRef.current) {
            setProgress((p) => ({ ...p, eventsLoaded }))
            setIsLoading(false)
          }
        } catch (err) {
          console.error('Failed to process events:', err)
        }
      })

      eventSource.addEventListener('sync_token', () => {
        calendarsComplete++
        if (mountedRef.current) {
          setProgress((p) => ({ ...p, calendarsComplete }))
        }
      })

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

      eventSource.addEventListener('complete', async (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data)
          eventSource.close()
          eventSourceRef.current = null

          const now = new Date()
          await setLastSyncAt(now)
          if (mountedRef.current) {
            setLastSyncAtState(now)
            setProgress({
              eventsLoaded: payload.total_events,
              calendarsComplete: payload.calendars_synced,
              totalCalendars: ids.length,
            })
          }
          completeSync()
          syncPromiseRef.current = null
          resolve()
        } catch (err) {
          syncPromiseRef.current = null
          reject(err)
        }
      })

      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null
          syncPromiseRef.current = null
          setError('Connection lost')
          reject(new Error('SSE connection closed'))
          return
        }
        console.warn('SSE connection dropped, retrying')
      }
    })
    syncPromiseRef.current = syncPromise
    return syncPromise
  }, [startSync, completeSync, setError, processEvents])

  const syncBackground = useCallback(async () => {
    try {
      await sync()
    } catch {
      // Background sync failures are silent
    }
  }, [sync])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
      syncPromiseRef.current = null
    }
  }, [])

  useEffect(() => {
    if (shouldStop) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      syncPromiseRef.current = null
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      resetStopFlag()
    }
  }, [shouldStop, resetStopFlag])

  useEffect(() => {
    if (!enabled || initStartedRef.current) return
    initStartedRef.current = true

    async function init() {
      await clearEncryptedEvents()

      const totalDexieCount = await db.events.count()
      const storedLastSync = await getLastSyncAt()

      if (mountedRef.current) {
        setLastSyncAtState(storedLastSync)
      }

      if (totalDexieCount > 0) {
        if (mountedRef.current) {
          setIsLoading(false)
        }
        syncBackground()
      } else {
        const ids = calendarIdsRef.current
        if (!ids.length) {
          if (mountedRef.current) setIsLoading(false)
          return
        }

        if (mountedRef.current) {
          setIsLoading(false)
        }
        sync()
      }
    }

    init()
  }, [enabled, sync, syncBackground])

  useEffect(() => {
    if (!enabled || !calendarIds.length || pollInterval <= 0) return

    pollRef.current = setInterval(() => {
      syncBackground()
    }, pollInterval)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [calendarIds.length, enabled, pollInterval, syncBackground])

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
