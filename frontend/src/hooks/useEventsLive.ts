import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, dexieToCalendarEvent } from '../lib/db'
import type { CalendarEvent } from '../types'

export interface UseEventsLiveResult {
  events: CalendarEvent[]
  masters: CalendarEvent[]
  exceptions: CalendarEvent[]
  isLoading: boolean
}

export function useEventsLive(calendarIds: string[]): UseEventsLiveResult {
  const rawEvents = useLiveQuery(
    async () => {
      if (!calendarIds.length) return db.events.toArray()
      return db.events.where('calendarId').anyOf(calendarIds).toArray()
    },
    [calendarIds.join(',')],
    []
  )

  const { events, masters, exceptions } = useMemo(() => {
    const result = { events: [] as CalendarEvent[], masters: [] as CalendarEvent[], exceptions: [] as CalendarEvent[] }

    for (const e of rawEvents ?? []) {
      if (e.status === 'cancelled') continue
      const converted = dexieToCalendarEvent(e)
      if (e.recurringEventId) {
        result.exceptions.push(converted)
      } else if (e.recurrence?.length) {
        result.masters.push(converted)
      } else {
        result.events.push(converted)
      }
    }

    return result
  }, [rawEvents])

  return {
    events,
    masters,
    exceptions,
    isLoading: false,
  }
}

export function useEventCount(calendarIds: string[]): number {
  const count = useLiveQuery(
    async () => {
      if (!calendarIds.length) return db.events.count()
      return db.events.where('calendarId').anyOf(calendarIds).count()
    },
    [calendarIds.join(',')],
    0
  )
  return count ?? 0
}

export function useDexieHasData(): boolean {
  const count = useLiveQuery(async () => db.events.count(), [], 0)
  return (count ?? 0) > 0
}
