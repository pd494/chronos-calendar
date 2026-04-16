import { RRule, RRuleSet } from 'rrule'
import type { CalendarEvent, DisplayOccurrence, EventCompletion, EventDateTime } from '../../types'

export type ExpandedEvent = DisplayOccurrence

interface ExpansionCache {
  key: string
  result: ExpandedEvent[]
}

let expansionCache: ExpansionCache | null = null

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

function computeCacheKey(
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): string {
  const masterIds = masters
    .map((event) => `${assertDefined(event.googleEventId, 'Master event is missing googleEventId')}:${event.updatedAt}`)
    .sort()
    .join(',')
  const exceptionIds = exceptions
    .map((event) => `${assertDefined(event.googleEventId, 'Exception event is missing googleEventId')}:${event.updatedAt}`)
    .sort()
    .join(',')
  return `${masterIds}|${exceptionIds}|${rangeStart.getTime()}|${rangeEnd.getTime()}`
}

function parseICalDateValues(line: string): Date[] {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return []
  const dates: Date[] = []
  for (const raw of line.substring(colonIdx + 1).split(',')) {
    const s = raw.trim()
    if (!s) continue
    dates.push(s.length === 8
      ? new Date(Date.UTC(parseInt(s.substring(0, 4)), parseInt(s.substring(4, 6)) - 1, parseInt(s.substring(6, 8))))
      : new Date(s))
  }
  return dates
}

function buildRRuleSet(rruleStrings: string[], dtstart: Date): RRuleSet {
  const set = new RRuleSet()
  for (const line of rruleStrings) {
    if (line.startsWith('RRULE:')) {
      const rule = RRule.fromString(line.substring(6))
      set.rrule(new RRule({ ...rule.origOptions, dtstart }))
      continue
    }

    if (line.startsWith('EXDATE:') || line.startsWith('EXDATE;')) {
      for (const date of parseICalDateValues(line)) {
        set.exdate(date)
      }
      continue
    }

    if (line.startsWith('RDATE:') || line.startsWith('RDATE;')) {
      for (const date of parseICalDateValues(line)) {
        set.rdate(date)
      }
    }
  }
  return set
}

function getEventDurationMs(event: CalendarEvent): number {
  if (event.start.dateTime) {
    return new Date(assertDefined(event.end.dateTime, 'Timed event is missing end dateTime')).getTime() - new Date(event.start.dateTime).getTime()
  }
  return new Date(assertDefined(event.end.date, 'All-day event is missing end date') + 'T00:00:00Z').getTime()
    - new Date(assertDefined(event.start.date, 'All-day event is missing start date') + 'T00:00:00Z').getTime()
}

function formatDateStringUTC(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(date: Date, isAllDay: boolean, timeZone?: string): EventDateTime {
  if (isAllDay) {
    return { date: formatDateStringUTC(date) }
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
    return exceptionOriginalStart.date === formatDateStringUTC(instanceDate)
  }

  const exceptionTime = exceptionOriginalStart.dateTime
    ? new Date(exceptionOriginalStart.dateTime).getTime()
    : 0
  return Math.abs(instanceDate.getTime() - exceptionTime) < 1000
}

export function getGoogleInstanceId(masterGoogleEventId: string, instanceDate: Date, isAllDay: boolean): string {
  if (isAllDay) {
    const y = instanceDate.getUTCFullYear()
    const m = String(instanceDate.getUTCMonth() + 1).padStart(2, '0')
    const d = String(instanceDate.getUTCDate()).padStart(2, '0')
    return `${masterGoogleEventId}_${y}${m}${d}`
  }
  const formatted = instanceDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  return `${masterGoogleEventId}_${formatted}`
}

export function parseVirtualId(virtualId: string): { masterId: string; instanceTimestamp: number } | null {
  const parts = virtualId.split(':')
  if (parts.length !== 4 || parts[0] !== 'virtual') return null
  const masterId = parts[2]
  const timestamp = new Date(parts[3]).getTime()
  if (isNaN(timestamp)) return null
  return { masterId, instanceTimestamp: timestamp }
}

export function expandRecurringEvents(
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  completions: EventCompletion[] = []
): ExpandedEvent[] {
  const cacheKey = computeCacheKey(masters, exceptions, rangeStart, rangeEnd)
  if (expansionCache && expansionCache.key === cacheKey && completions.length === 0) {
    return [...expansionCache.result]
  }

  const completionSet = new Set(
    completions.map((c) => `${c.master_event_id}|${c.instance_start}`)
  )

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
    if (!master.googleEventId) continue

    const isAllDay = !!master.start.date && !master.start.dateTime
    const durationMs = getEventDurationMs(master)
    const masterEventId = master.googleEventId
    const masterExceptions = exceptionsByMaster.get(masterEventId) || []
    const timeZone = master.start.timeZone

    const rruleStrings = master.recurrence.filter(
      (r) => r.startsWith('RRULE:') || r.startsWith('EXDATE:') || r.startsWith('RDATE:')
    )
    if (rruleStrings.length === 0) continue

    let dtstart: Date
    if (isAllDay) {
      const [y, m, d] = master.start.date!.split('-').map(Number)
      dtstart = new Date(Date.UTC(y, m - 1, d))
    } else if (master.start.dateTime) {
      dtstart = new Date(master.start.dateTime)
    } else {
      continue
    }

    const rruleSet = buildRRuleSet(rruleStrings, dtstart)
    const instances = rruleSet.between(rangeStart, rangeEnd, true)

    for (const instanceDate of instances) {
      const matchingException = masterExceptions.find((exc) =>
        instanceMatchesException(
          instanceDate,
          exc.recurringEventId === masterEventId ? exc.originalStartTime : undefined,
          isAllDay
        )
      )

      if (matchingException) {
        if (matchingException.status === 'cancelled') continue
        expanded.push({
          ...matchingException,
          displayId: matchingException.googleEventId ?? `exception:${matchingException.googleCalendarId}:${matchingException.updatedAt}`,
          entityKind: 'exception',
          seriesMasterId: masterEventId,
          instanceOriginalStart: matchingException.originalStartTime,
          effectiveRecurrence: master.recurrence,
        })
      } else {
        const endDate = new Date(instanceDate.getTime() + durationMs)
        const instanceStartStr = isAllDay
          ? formatDateStringUTC(instanceDate)
          : instanceDate.toISOString()
        const isCompleted = completionSet.has(`${masterEventId}|${instanceStartStr}`)
        const displayId = `virtual:${master.googleCalendarId}:${masterEventId}:${instanceStartStr}`
        expanded.push({
          ...master,
          googleEventId: undefined,
          displayId,
          entityKind: 'virtual',
          seriesMasterId: masterEventId,
          instanceOriginalStart: formatDateTime(instanceDate, isAllDay, timeZone),
          completed: isCompleted,
          start: formatDateTime(instanceDate, isAllDay, timeZone),
          end: formatDateTime(endDate, isAllDay, master.end.timeZone),
          recurrence: undefined,
          effectiveRecurrence: master.recurrence,
          recurringEventId: masterEventId,
        })
      }
    }
  }

  expansionCache = { key: cacheKey, result: expanded }
  return [...expanded]
}

export function mergeEventsWithExpanded(
  regularEvents: DisplayOccurrence[],
  expandedEvents: ExpandedEvent[],
  completionSet: Set<string> = new Set()
): ExpandedEvent[] {
  const merged: ExpandedEvent[] = []
  const addedIds = new Set<string>()

  for (const event of regularEvents) {
    const id = event.displayId ?? event.googleEventId ?? ''
    if (!addedIds.has(id)) {
      const instanceStart = event.start.dateTime ?? event.start.date!
      const isCompleted = completionSet.has(`${event.googleEventId}|${instanceStart}`)
      merged.push({ ...event, completed: isCompleted })
      addedIds.add(id)
    }
  }

  for (const event of expandedEvents) {
    const id = event.displayId ?? event.googleEventId ?? ''
    if (!addedIds.has(id)) {
      merged.push(event)
      addedIds.add(id)
    }
  }

  return merged.sort((a, b) => {
    const toTime = (e: ExpandedEvent) =>
      e.start.dateTime
        ? new Date(e.start.dateTime).getTime()
        : new Date(e.start.date! + 'T00:00:00').getTime()
    return toTime(a) - toTime(b)
  })
}

export function getExpandedEvents(
  events: DisplayOccurrence[],
  masters: CalendarEvent[],
  exceptions: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  completions: EventCompletion[] = []
): ExpandedEvent[] {
  const completionSet = new Set(
    completions.map((c) => `${c.master_event_id}|${c.instance_start}`)
  )
  const expanded = expandRecurringEvents(masters, exceptions, rangeStart, rangeEnd, completions)
  return mergeEventsWithExpanded(events, expanded, completionSet)
}
