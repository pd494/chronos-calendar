import { RRule } from 'rrule'
import type { CalendarEvent, DisplayOccurrence, RecurrenceEditScope } from '../../types'

interface ScopeInput {
  action: 'edit' | 'delete'
  event: DisplayOccurrence
  masterEvent?: CalendarEvent
  patch: Partial<CalendarEvent>
  hasFollowingLineage?: boolean
}

interface ScopeResult {
  visibleScopes: RecurrenceEditScope[]
  defaultScope: RecurrenceEditScope
  autoSubmit: RecurrenceEditScope | null
  warningText: string | null
}

function getRRuleLine(recurrence?: string[]): string | undefined {
  return recurrence?.find((line) => line.startsWith('RRULE:'))
}

function getOccurrenceStart(event: CalendarEvent): string | undefined {
  return event.instanceOriginalStart?.dateTime
    ?? event.instanceOriginalStart?.date
    ?? event.originalStartTime?.dateTime
    ?? event.originalStartTime?.date
    ?? event.start.dateTime
    ?? event.start.date
}

function getMasterStart(masterEvent: CalendarEvent | undefined): string | undefined {
  return masterEvent?.start.dateTime ?? masterEvent?.start.date
}

function getLastOccurrenceStart(masterEvent: CalendarEvent | undefined): string | null {
  if (!masterEvent) return null

  const rruleLine = getRRuleLine(masterEvent.recurrence)
  if (!rruleLine) return null

  const rule = RRule.fromString(rruleLine.substring(6))
  if (!rule.origOptions.count && !rule.origOptions.until) return null

  const dtstart = masterEvent.start.dateTime
    ? new Date(masterEvent.start.dateTime)
    : masterEvent.start.date
      ? new Date(`${masterEvent.start.date}T00:00:00Z`)
      : null

  if (!dtstart) return null

  const allDates = new RRule({ ...rule.origOptions, dtstart }).all()
  const last = allDates[allDates.length - 1]
  if (!last) return null

  return masterEvent.start.dateTime
    ? last.toISOString()
    : last.toISOString().split('T')[0]
}

function hasOwn<T extends object>(value: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function resolveScopes({ action, event, masterEvent, patch, hasFollowingLineage = false }: ScopeInput): ScopeResult {
  const resolvedMaster = masterEvent ?? (event.recurrence?.length ? event : undefined)
  const orphanException = event.entityKind === 'orphan-exception'
  const parentLoaded = !!resolvedMaster || (!!(event.recurringEventId || event.seriesMasterId) && !orphanException)
  const isParentEvent = !!event.recurrence?.length && !event.recurringEventId && !event.seriesMasterId
  const occurrenceStart = getOccurrenceStart(event)
  const masterStart = getMasterStart(resolvedMaster)
  const lastOccurrenceStart = getLastOccurrenceStart(resolvedMaster)
  const isFirstOccurrence = !!occurrenceStart && !!masterStart && occurrenceStart === masterStart
  const isLastOccurrence = !!occurrenceStart && !!lastOccurrenceStart && occurrenceStart === lastOccurrenceStart
  const recurrenceTouched = hasOwn(patch, 'recurrence')
  const recurrenceRemoved = recurrenceTouched && (!patch.recurrence || patch.recurrence.length === 0)
  const ruleChanged = action === 'edit' && recurrenceTouched
  const calendarChange = action === 'edit' && hasOwn(patch, 'calendarId') && !!(patch as { calendarId?: string }).calendarId && (patch as { calendarId?: string }).calendarId !== event.googleCalendarId
  const timeChange = action === 'edit' && (hasOwn(patch, 'start') || hasOwn(patch, 'end'))
  const warningText = ruleChanged ? 'One-off changes to individual events in this series may be reset.' : null
  const canShowFollowing =
    !isFirstOccurrence &&
    parentLoaded &&
    !calendarChange &&
    !isParentEvent &&
    (!isLastOccurrence || hasFollowingLineage)

  if (orphanException) {
    return {
      visibleScopes: ['this'],
      defaultScope: 'this',
      autoSubmit: null,
      warningText,
    }
  }

  if (action === 'delete') {
    const visibleScopes: RecurrenceEditScope[] = ['this']
    if (canShowFollowing) {
      visibleScopes.push('following')
    }
    visibleScopes.push('all')

    return {
      visibleScopes,
      defaultScope: 'this',
      autoSubmit: null,
      warningText: null,
    }
  }

  if (recurrenceRemoved) {
    return {
      visibleScopes: ['all'],
      defaultScope: 'all',
      autoSubmit: null,
      warningText,
    }
  }

  if (ruleChanged) {
    if (isFirstOccurrence || (isLastOccurrence && !hasFollowingLineage) || isParentEvent) {
      return {
        visibleScopes: ['all'],
        defaultScope: 'all',
        autoSubmit: null,
        warningText,
      }
    }

    const visibleScopes: RecurrenceEditScope[] = []
    if (canShowFollowing) {
      visibleScopes.push('following')
    }
    visibleScopes.push('all')

    return {
      visibleScopes,
      defaultScope: visibleScopes[0],
      autoSubmit: null,
      warningText,
    }
  }

  if (timeChange && !isFirstOccurrence && !calendarChange && !isParentEvent) {
    const visibleScopes: RecurrenceEditScope[] = ['this']
    if ((!isLastOccurrence || hasFollowingLineage) && parentLoaded) {
      visibleScopes.push('following')
    }

    return {
      visibleScopes,
      defaultScope: 'this',
      autoSubmit: null,
      warningText,
    }
  }

  const visibleScopes: RecurrenceEditScope[] = ['this']
  if (canShowFollowing) {
    visibleScopes.push('following')
  }
  if (!(timeChange && !isFirstOccurrence) || calendarChange || isParentEvent) {
    visibleScopes.push('all')
  }

  return {
    visibleScopes,
    defaultScope: 'this',
    autoSubmit: null,
    warningText,
  }
}
