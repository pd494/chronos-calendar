import { RRule, RRuleSet, rrulestr } from 'rrule'
import type { CalendarEvent, EventDateTime } from '../types'

export interface ExpandedEvent extends CalendarEvent {
  isVirtual?: boolean
  originalMasterId?: string
}

interface ExpansionCache {
  key: string
  result: ExpandedEvent[]
}

let expansionCache: ExpansionCache | null = null

function computeCacheKey(
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): string {
  const masterIds = masters.map((m) => `${m.id}:${m.updated}`).sort().join(',')
  const exceptionIds = exceptions.map((e) => `${e.id}:${e.updated}`).sort().join(',')
  return `${masterIds}|${exceptionIds}|${rangeStart.getTime()}|${rangeEnd.getTime()}`
}

function parseRRuleString(rruleString: string, tzid?: string): RRuleSet | RRule | null {
  try {
    return rrulestr(rruleString, { forceset: true, tzid })
  } catch {
    return null
  }
}

function formatDateTimeForTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
}

function getEventDurationMs(event: CalendarEvent): number {
  const startMs = event.start.dateTime
    ? new Date(event.start.dateTime).getTime()
    : new Date((event.start.date ?? '1970-01-01') + 'T00:00:00').getTime()
  const endMs = event.end.dateTime
    ? new Date(event.end.dateTime).getTime()
    : new Date((event.end.date ?? '1970-01-01') + 'T00:00:00').getTime()
  return endMs - startMs
}

function formatDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(date: Date, isAllDay: boolean, timeZone?: string): EventDateTime {
  if (isAllDay) {
    return { date: formatDateString(date) }
  }
  return { dateTime: date.toISOString(), timeZone }
}

function instanceMatchesException(
  instanceDate: Date,
  exceptionOriginalStart: EventDateTime | undefined,
  isAllDay: boolean
): boolean {
  if (!exceptionOriginalStart) return false

  if (isAllDay) {
    return exceptionOriginalStart.date === formatDateString(instanceDate)
  }

  const exceptionTime = exceptionOriginalStart.dateTime
    ? new Date(exceptionOriginalStart.dateTime).getTime()
    : 0
  return Math.abs(instanceDate.getTime() - exceptionTime) < 1000
}

function buildRRuleString(dtstart: Date, rruleStrings: string[], options?: { timeZone?: string; allDay?: boolean }): string {
  if (options?.allDay) {
    const year = dtstart.getFullYear()
    const month = String(dtstart.getMonth() + 1).padStart(2, '0')
    const day = String(dtstart.getDate()).padStart(2, '0')
    return `DTSTART;VALUE=DATE:${year}${month}${day}\n${rruleStrings.join('\n')}`
  }

  if (options?.timeZone) {
    const localTime = formatDateTimeForTimezone(dtstart, options.timeZone)
    const formatted = localTime.replace(/[-:]/g, '')
    return `DTSTART;TZID=${options.timeZone}:${formatted}\n${rruleStrings.join('\n')}`
  }

  const utcFormatted = dtstart.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  return `DTSTART:${utcFormatted}\n${rruleStrings.join('\n')}`
}

export function expandRecurringEvents(
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): ExpandedEvent[] {
  const cacheKey = computeCacheKey(masters, exceptions, rangeStart, rangeEnd)
  if (expansionCache && expansionCache.key === cacheKey) {
    return [...expansionCache.result]
  }

  const expanded: ExpandedEvent[] = []
  const exceptionsByMaster = new Map<string, CalendarEvent[]>()

  for (const exception of exceptions) {
    if (!exception.recurringEventId) continue
    const existing = exceptionsByMaster.get(exception.recurringEventId) || []
    existing.push(exception)
    exceptionsByMaster.set(exception.recurringEventId, existing)
  }

  for (const master of masters) {
    if (!master.recurrence?.length) continue

    const isAllDay = !!master.start.date && !master.start.dateTime
    const durationMs = getEventDurationMs(master)
    const masterExceptions = exceptionsByMaster.get(master.id) || []
    const timeZone = master.start.timeZone

    let dtstart: Date
    if (master.start.dateTime) {
      dtstart = new Date(master.start.dateTime)
    } else if (master.start.date) {
      dtstart = new Date(master.start.date + 'T00:00:00')
    } else {
      continue
    }

    const rruleStrings = master.recurrence.filter(
      (r) => r.startsWith('RRULE:') || r.startsWith('EXDATE:') || r.startsWith('RDATE:')
    )
    if (rruleStrings.length === 0) continue

    const fullRRule = buildRRuleString(dtstart, rruleStrings, isAllDay ? { allDay: true } : { timeZone })
    const rruleSet = parseRRuleString(fullRRule, isAllDay ? undefined : timeZone)
    if (!rruleSet) continue

    let instances: Date[]
    try {
      instances = rruleSet.between(rangeStart, rangeEnd, true)
    } catch {
      continue
    }

    for (const instanceDate of instances) {
      const matchingException = masterExceptions.find((exc) =>
        instanceMatchesException(
          instanceDate,
          exc.recurringEventId === master.id ? exc.originalStartTime : undefined,
          isAllDay
        )
      )

      if (matchingException) {
        if (matchingException.status === 'cancelled') continue
        expanded.push({
          ...matchingException,
          isVirtual: false,
          originalMasterId: master.id,
        })
      } else {
        const endDate = new Date(instanceDate.getTime() + durationMs)
        expanded.push({
          ...master,
          id: `${master.id}_${instanceDate.getTime()}`,
          start: formatDateTime(instanceDate, isAllDay, timeZone),
          end: formatDateTime(endDate, isAllDay, master.end.timeZone),
          recurrence: undefined,
          recurringEventId: master.id,
          isVirtual: true,
          originalMasterId: master.id,
        })
      }
    }
  }

  expansionCache = { key: cacheKey, result: expanded }
  return [...expanded]
}

export function mergeEventsWithExpanded(
  regularEvents: CalendarEvent[],
  expandedEvents: ExpandedEvent[]
): ExpandedEvent[] {
  const merged: ExpandedEvent[] = []
  const addedIds = new Set<string>()

  for (const event of regularEvents) {
    if (!addedIds.has(event.id)) {
      merged.push({ ...event, isVirtual: false })
      addedIds.add(event.id)
    }
  }

  for (const event of expandedEvents) {
    if (!addedIds.has(event.id)) {
      merged.push(event)
      addedIds.add(event.id)
    }
  }

  return merged.sort((a, b) => {
    const toTime = (e: ExpandedEvent) =>
      e.start.dateTime
        ? new Date(e.start.dateTime).getTime()
        : new Date((e.start.date ?? '1970-01-01') + 'T00:00:00').getTime()
    return toTime(a) - toTime(b)
  })
}

export function getExpandedEvents(
  events: CalendarEvent[],
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): ExpandedEvent[] {
  const expanded = expandRecurringEvents(masters, exceptions, rangeStart, rangeEnd)
  return mergeEventsWithExpanded(events, expanded)
}
