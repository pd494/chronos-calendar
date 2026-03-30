import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, dexieToCompletion } from '../lib/db'
import type { CalendarEvent, EventCompletion } from '../types'

interface UseEventsLiveResult {
  events: CalendarEvent[]
  masters: CalendarEvent[]
  exceptions: CalendarEvent[]
  completions: EventCompletion[]
}

export function useEventsLive(calendarIds: string[]): UseEventsLiveResult {
  const calendarKey = useMemo(() => [...calendarIds].sort().join(','), [calendarIds])

  const rawEvents = useLiveQuery(
    async () => {
      if (!calendarIds.length) return db.events.toArray()
      return db.events.where('googleCalendarId').anyOf(calendarIds).toArray()
    },
    [calendarKey],
    []
  )

  const rawCompletions = useLiveQuery(
    async () => {
      if (!calendarIds.length) return db.completedEvents.toArray()
      return db.completedEvents.where('googleCalendarId').anyOf(calendarIds).toArray()
    },
    [calendarKey],
    []
  )

  const { events, masters, exceptions } = useMemo(() => {
    const result = { events: [] as CalendarEvent[], masters: [] as CalendarEvent[], exceptions: [] as CalendarEvent[] }

    for (const e of rawEvents ?? []) {
      if (e.recurringEventId) {
        result.exceptions.push(e)
      } else if (e.recurrence?.length) {
        if (e.status === 'cancelled') continue
        result.masters.push(e)
      } else {
        if (e.status === 'cancelled') continue
        result.events.push(e)
      }
    }

    return result
  }, [rawEvents])

  const completions = useMemo(
    () => (rawCompletions ?? []).map(dexieToCompletion),
    [rawCompletions]
  )

  return {
    events,
    masters,
    exceptions,
    completions,
  }
}
