import { useQueries, keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api'
import { startOfMonth, endOfMonth, addMonths, format } from 'date-fns'
import type { CalendarEvent } from '../types'
import { RRule } from 'rrule'
import { eventKeys } from '../lib'

interface EventsResponse {
  events: CalendarEvent[]
  masters: CalendarEvent[]
}

interface MonthKey {
  year: number
  month: number
  start: string
  end: string
}

function getMonthsInRange(currentDate: Date, monthsBefore = 1, monthsAfter = 1): MonthKey[] {
  const months: MonthKey[] = []
  const startMonth = addMonths(currentDate, -monthsBefore)
  const endMonth = addMonths(currentDate, monthsAfter)

  let current = startOfMonth(startMonth)
  const end = endOfMonth(endMonth)

  while (current <= end) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
      start: startOfMonth(current).toISOString(),
      end: endOfMonth(current).toISOString(),
    })
    current = addMonths(current, 1)
  }

  return months
}

function expandRecurringEvents(
  masters: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): CalendarEvent[] {
  const expanded: CalendarEvent[] = []

  for (const master of masters) {
    if (!master.recurrence?.length) continue

    const rruleStr = master.recurrence.find((r) => r.startsWith('RRULE:'))
    if (!rruleStr) continue

    try {
      const eventStart = master.start.dateTime
        ? new Date(master.start.dateTime)
        : new Date(master.start.date + 'T00:00:00')

      const eventEnd = master.end.dateTime
        ? new Date(master.end.dateTime)
        : new Date(master.end.date + 'T00:00:00')

      const duration = eventEnd.getTime() - eventStart.getTime()

      const rule = RRule.fromString(rruleStr.replace('RRULE:', ''))
      rule.options.dtstart = eventStart

      const instances = rule.between(rangeStart, rangeEnd, true)

      for (const instanceStart of instances) {
        const instanceEnd = new Date(instanceStart.getTime() + duration)

        expanded.push({
          ...master,
          id: `${master.id}_${instanceStart.toISOString()}`,
          recurringEventId: master.id,
          start: master.start.dateTime
            ? { dateTime: instanceStart.toISOString(), timeZone: master.start.timeZone }
            : { date: format(instanceStart, 'yyyy-MM-dd') },
          end: master.end.dateTime
            ? { dateTime: instanceEnd.toISOString(), timeZone: master.end.timeZone }
            : { date: format(instanceEnd, 'yyyy-MM-dd') },
        })
      }
    } catch {
      // Skip invalid RRULE
    }
  }

  return expanded
}

export function useGoogleEvents(currentDate: Date, visibleCalendarIds?: string[]) {
  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`
  const months = useMemo(() => getMonthsInRange(currentDate, 2, 2), [monthKey])

  const queries = useQueries({
    queries: months.map((m) => ({
      queryKey: eventKeys.byMonth(m.year, m.month, visibleCalendarIds),
      queryFn: async () => {
        const params: Record<string, string> = { start: m.start, end: m.end }
        if (visibleCalendarIds?.length) {
          params.calendar_ids = visibleCalendarIds.join(',')
        }
        return api.get<EventsResponse>('/events', params)
      },
      enabled: false, // Disabled during caching system implementation
      placeholderData: keepPreviousData,
    })),
  })

  const isInitialLoading = !visibleCalendarIds?.length || queries.every((q) => q.isLoading && !q.data)
  const isFetching = queries.some((q) => q.isFetching)
  const error = queries.find((q) => q.error)?.error

  const rangeStart = useMemo(() => startOfMonth(addMonths(currentDate, -2)), [monthKey])
  const rangeEnd = useMemo(() => endOfMonth(addMonths(currentDate, 2)), [monthKey])

  const events = useMemo(() => {
    const allSingleEvents: CalendarEvent[] = []
    const allMasters: CalendarEvent[] = []

    for (const query of queries) {
      if (query.data) {
        allSingleEvents.push(...query.data.events)
        allMasters.push(...query.data.masters)
      }
    }

    const expandedRecurring = expandRecurringEvents(allMasters, rangeStart, rangeEnd)
    const allEvents = [...allSingleEvents, ...expandedRecurring]

    const eventMap = new Map<string, CalendarEvent>()
    for (const event of allEvents) {
      const key = event.recurringEventId
        ? `${event.calendarId}:${event.recurringEventId}:${event.start.dateTime || event.start.date}`
        : `${event.calendarId}:${event.id}`

      const existing = eventMap.get(key)
      if (!existing || (event.recurringEventId && !existing.recurringEventId)) {
        eventMap.set(key, event)
      }
    }

    return Array.from(eventMap.values()).sort((a, b) => {
      const aStart = a.start.dateTime || a.start.date || ''
      const bStart = b.start.dateTime || b.start.date || ''
      return aStart.localeCompare(bStart)
    })
  }, [queries, rangeStart, rangeEnd])

  return { events, isLoading: isInitialLoading, isFetching, error }
}
