import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, dexieToCalendarEvent, dexieToCompletion } from '../lib/db'
import type { CalendarEvent, EventCompletion } from '../types'

interface UseEventsLiveResult {
  events: CalendarEvent[]
  masters: CalendarEvent[]
  exceptions: CalendarEvent[]
  completions: EventCompletion[]
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

  const rawCompletions = useLiveQuery(
    async () => {
      if (!calendarIds.length) return db.completedEvents.toArray()
      return db.completedEvents.where('googleCalendarId').anyOf(calendarIds).toArray()
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
