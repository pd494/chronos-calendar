import { RRule, RRuleSet } from 'rrule'
import type { CalendarEvent, EventCompletion, EventDateTime } from '../types'

export interface ExpandedEvent extends CalendarEvent {
  isVirtual: boolean
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

function buildRRuleSet(rruleStrings: string[], dtstart: Date): RRuleSet | null {
  try {
    const set = new RRuleSet()
    for (const line of rruleStrings) {
      if (line.startsWith('RRULE:')) {
        const rule = RRule.fromString(line.substring(6))
        set.rrule(new RRule({ ...rule.origOptions, dtstart }))
      } else if (line.startsWith('EXDATE:') || line.startsWith('EXDATE;')) {
        for (const d of parseICalDateValues(line)) set.exdate(d)
      } else if (line.startsWith('RDATE:') || line.startsWith('RDATE;')) {
        for (const d of parseICalDateValues(line)) set.rdate(d)
      }
    }
    return set
  } catch (e) {
    console.warn('Failed to build RRuleSet:', rruleStrings, e)
    return null
  }
}

function getEventDurationMs(event: CalendarEvent): number {
  if (event.start.dateTime) {
    return new Date(event.end.dateTime!).getTime() - new Date(event.start.dateTime).getTime()
  }
  return new Date(event.end.date! + 'T00:00:00Z').getTime() - new Date(event.start.date! + 'T00:00:00Z').getTime()
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
  const lastUnderscore = virtualId.lastIndexOf('_')
  if (lastUnderscore === -1) return null
  const masterId = virtualId.substring(0, lastUnderscore)
  const timestamp = Number(virtualId.substring(lastUnderscore + 1))
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

    const isAllDay = !!master.start.date && !master.start.dateTime
    const durationMs = getEventDurationMs(master)
    const masterExceptions = exceptionsByMaster.get(master.id) || []
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
        const instanceStartStr = isAllDay
          ? formatDateStringUTC(instanceDate)
          : instanceDate.toISOString()
        const isCompleted = completionSet.has(`${master.id}|${instanceStartStr}`)
        expanded.push({
          ...master,
          id: `${master.id}_${instanceDate.getTime()}`,
          completed: isCompleted,
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
  expandedEvents: ExpandedEvent[],
  completionSet: Set<string> = new Set()
): ExpandedEvent[] {
  const merged: ExpandedEvent[] = []
  const addedIds = new Set<string>()

  for (const event of regularEvents) {
    if (!addedIds.has(event.id)) {
      const instanceStart = event.start.dateTime ?? event.start.date!
      const isCompleted = completionSet.has(`${event.id}|${instanceStart}`)
      merged.push({ ...event, completed: isCompleted, isVirtual: false })
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
        : new Date(e.start.date! + 'T00:00:00').getTime()
    return toTime(a) - toTime(b)
  })
}

export function getExpandedEvents(
  events: CalendarEvent[],
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
