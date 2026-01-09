import { useMemo } from 'react'
import { useEventsContext } from '../contexts/EventsContext'
import { getEventStart, CalendarEvent } from '../types'

export function useCombinedEvents() {
  const { events, isLoading, isFetching, error } = useEventsContext()

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aStart = getEventStart(a)
      const bStart = getEventStart(b)
      return aStart.getTime() - bStart.getTime()
    })
  }, [events])

  const eventsByDate = useMemo(() => {
    const byDate: Record<string, CalendarEvent[]> = {}
    for (const event of sortedEvents) {
      const dateKey = getEventStart(event).toISOString().split('T')[0]
      if (!byDate[dateKey]) {
        byDate[dateKey] = []
      }
      byDate[dateKey].push(event)
    }
    return byDate
  }, [sortedEvents])

  return {
    events: sortedEvents,
    eventsByDate,
    isLoading,
    isFetching,
    error,
    totalCount: events.length,
  }
}
