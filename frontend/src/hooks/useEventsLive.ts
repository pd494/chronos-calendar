import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, dexieToCompletion } from '../lib/db'
import type { CalendarEvent, DisplayOccurrence, EventCompletion } from '../types'

interface UseEventsLiveResult {
  events: DisplayOccurrence[]
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
    const result = { events: [] as DisplayOccurrence[], masters: [] as CalendarEvent[], exceptions: [] as CalendarEvent[] }

    for (const event of rawEvents ?? []) {
      if (event.status === 'cancelled' && !event.recurringEventId) continue
      if (event.recurrence?.length && !event.recurringEventId) {
        result.masters.push(event)
      }
    }

    const masterIds = new Set(result.masters.map((event) => event.googleEventId).filter(Boolean))

    for (const event of rawEvents ?? []) {
      if (event.recurringEventId) {
        if (masterIds.has(event.recurringEventId)) {
          result.exceptions.push(event)
          continue
        }
        if (event.status === 'cancelled') continue
        result.events.push({
          ...event,
          displayId: event.googleEventId ?? `orphan:${event.googleCalendarId}:${event.recurringEventId ?? 'unknown'}`,
          entityKind: 'orphan-exception',
          seriesMasterId: event.recurringEventId,
          instanceOriginalStart: event.originalStartTime,
          isOrphan: true,
          effectiveRecurrence: undefined,
        })
        continue
      }

      if (event.recurrence?.length) continue
      if (event.status === 'cancelled') continue
      result.events.push({
        ...event,
        displayId: event.googleEventId ?? `event:${event.googleCalendarId}:${event.createdAt}`,
        entityKind: 'regular',
        effectiveRecurrence: undefined,
      })
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
