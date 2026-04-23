import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { RRule } from 'rrule'
import { toast } from 'sonner'
import { eventsApi, type AllResult, type FollowingResult } from '../api/events'
import { eventKeys } from '../lib'
import { db, type DexieCompletion } from '../lib/db'
import { adjustRecurrenceForStartChange } from '../lib/recurrence'
import type { MutationPlan } from '../lib/recurrence/planner'
import type { CalendarEvent, EventDateTime } from '../types'

type PreviousLists = [unknown, CalendarEvent[] | undefined][]

interface MutationContext {
  previousLists: PreviousLists
  previousMaster?: CalendarEvent
  previousExceptions: CalendarEvent[]
  previousCompletions: DexieCompletion[]
  previousDownstreamMasters: CalendarEvent[]
  previousDownstreamExceptions: CalendarEvent[]
  previousDownstreamCompletions: DexieCompletion[]
  tempTailId?: string
}

const ICAL_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

function dateTimeValue(value: EventDateTime): string {
  return value.dateTime ?? assertDefined(value.date, 'Expected date or dateTime')
}

function eventDuration(previousMaster: CalendarEvent): number {
  if (previousMaster.start.dateTime) {
    return new Date(assertDefined(previousMaster.end.dateTime, 'Timed event is missing end dateTime')).getTime()
      - new Date(previousMaster.start.dateTime).getTime()
  }
  return new Date(assertDefined(previousMaster.end.date, 'All-day event is missing end date')).getTime()
    - new Date(assertDefined(previousMaster.start.date, 'All-day event is missing start date')).getTime()
}

function shiftDateTimeValue(value: EventDateTime, deltaMs: number): EventDateTime {
  if (value.dateTime) {
    return {
      dateTime: new Date(new Date(value.dateTime).getTime() + deltaMs).toISOString(),
      timeZone: value.timeZone,
    }
  }

  const shifted = new Date(`${assertDefined(value.date, 'All-day value is missing date')}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + Math.round(deltaMs / 86400000))
  return { date: shifted.toISOString().split('T')[0] }
}

function seriesDeltaMs(splitPoint: string, patch: Partial<CalendarEvent>): number {
  if (!patch.start) return 0

  if (patch.start.dateTime) {
    return new Date(patch.start.dateTime).getTime() - new Date(splitPoint).getTime()
  }

  const nextDate = assertDefined(patch.start.date, 'All-day patch start is missing date')
  const splitDate = splitPoint.includes('T') ? splitPoint.split('T')[0] : splitPoint
  return new Date(`${nextDate}T00:00:00Z`).getTime() - new Date(`${splitDate}T00:00:00Z`).getTime()
}

function isFutureOccurrence(value: string, splitPoint: string): boolean {
  return value >= splitPoint
}

function isSplitPointOccurrence(value: string, splitPoint: string): boolean {
  return value === splitPoint
}

function weekdayIndex(value: EventDateTime): number {
  const day = value.dateTime
    ? new Date(value.dateTime).getDay()
    : new Date(`${assertDefined(value.date, 'All-day value is missing date')}T00:00:00Z`).getUTCDay()
  return day === 0 ? 6 : day - 1
}

function rewriteByDay(rrule: string, oldDay: number, newDay: number): string {
  const match = rrule.match(/BYDAY=([^;]+)/)
  if (!match) return rrule

  const oldByDay = ICAL_DAYS[oldDay]
  const newByDay = ICAL_DAYS[newDay]
  const days = match[1].split(',').map((day) => day === oldByDay ? newByDay : day)
  return rrule.replace(/BYDAY=[^;]+/, `BYDAY=${days.join(',')}`)
}

function splitPointToDateTime(splitPoint: string): EventDateTime {
  return splitPoint.includes('T') ? { dateTime: splitPoint } : { date: splitPoint }
}

function buildOptimisticTailRecurrence(
  recurrence: string[],
  splitPoint: string,
  previousMaster: CalendarEvent,
  tailStart: EventDateTime,
): string[] {
  return recurrence
    .filter((rule) => !rule.startsWith('EXDATE') || new Date(rule.substring(rule.indexOf(':') + 1).trim()) >= new Date(splitPoint))
    .map((rule) => {
      if (!rule.startsWith('RRULE:')) return rule

      let nextRule = rule
      const oldDay = weekdayIndex(splitPointToDateTime(splitPoint))
      const newDay = weekdayIndex(tailStart)
      if (oldDay !== newDay && nextRule.includes('BYDAY=')) {
        nextRule = rewriteByDay(nextRule, oldDay, newDay)
      }

      const countMatch = nextRule.match(/COUNT=(\d+)/)
      if (!countMatch) return nextRule

      const ruleSet = new RRule({
        ...RRule.fromString(rule.substring(6)).origOptions,
        dtstart: new Date(dateTimeValue(previousMaster.start)),
      })
      const remainingCount = ruleSet.all().filter((occurrence) => occurrence >= new Date(splitPoint)).length
      return nextRule.replace(/COUNT=\d+/, `COUNT=${Math.max(1, remainingCount)}`)
    })
}

function recurrenceChanged(patch: Partial<CalendarEvent>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'recurrence') && !!patch.recurrence?.length
}

function resetsExceptions(patch: Partial<CalendarEvent>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(patch, 'recurrence') ||
    Object.prototype.hasOwnProperty.call(patch, 'start') ||
    Object.prototype.hasOwnProperty.call(patch, 'end')
  )
}

function splitUntilString(splitPoint: string, isAllDay: boolean): string {
  const untilDate = new Date(splitPoint)
  if (isAllDay) {
    untilDate.setUTCDate(untilDate.getUTCDate() - 1)
    const year = untilDate.getUTCFullYear()
    const month = String(untilDate.getUTCMonth() + 1).padStart(2, '0')
    const day = String(untilDate.getUTCDate()).padStart(2, '0')
    return `${year}${month}${day}T235959Z`
  }

  untilDate.setDate(untilDate.getDate() - 1)
  return untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function normalizeRange(
  previousMaster: CalendarEvent,
  start: EventDateTime,
  end: EventDateTime,
): { start: EventDateTime; end: EventDateTime } {
  if (start.date && end.date && new Date(end.date) <= new Date(start.date)) {
    const normalizedEnd = new Date(start.date)
    normalizedEnd.setDate(normalizedEnd.getDate() + Math.max(1, Math.round(eventDuration(previousMaster) / 86400000)))
    return { start, end: { date: normalizedEnd.toISOString().split('T')[0] } }
  }

  if (start.dateTime && end.dateTime && new Date(end.dateTime) <= new Date(start.dateTime)) {
    return {
      start,
      end: {
        dateTime: new Date(new Date(start.dateTime).getTime() + Math.max(60_000, eventDuration(previousMaster))).toISOString(),
        timeZone: end.timeZone ?? previousMaster.end.timeZone,
      },
    }
  }

  return { start, end }
}

function alignedExceptionRange(
  previousMaster: CalendarEvent,
  alignedOriginalStart: EventDateTime,
  tailStart: EventDateTime,
  tailEnd: EventDateTime,
): { start: EventDateTime; end: EventDateTime } {
  if (alignedOriginalStart.date && tailStart.date && tailEnd.date) {
    const endDate = new Date(`${alignedOriginalStart.date}T00:00:00Z`)
    endDate.setUTCDate(endDate.getUTCDate() + Math.max(1, Math.round(eventDuration(previousMaster) / 86400000)))
    return {
      start: { date: alignedOriginalStart.date },
      end: { date: endDate.toISOString().split('T')[0] },
    }
  }

  const startDateTime = assertDefined(alignedOriginalStart.dateTime, 'Timed exception is missing dateTime')
  return normalizeRange(previousMaster, {
    dateTime: startDateTime,
    timeZone: tailStart.timeZone ?? previousMaster.start.timeZone,
  }, {
    dateTime: new Date(new Date(startDateTime).getTime() + Math.max(60_000, eventDuration(previousMaster))).toISOString(),
    timeZone: tailEnd.timeZone ?? previousMaster.end.timeZone,
  })
}

function instanceOriginalStart(instanceStart: string): EventDateTime {
  return instanceStart.includes('T') ? { dateTime: instanceStart } : { date: instanceStart }
}

function buildOptimisticInstanceEvent(
  previousMaster: CalendarEvent,
  calendarId: string,
  masterId: string,
  instanceStart: string,
  patch: Partial<CalendarEvent>,
  googleEventId: string,
): CalendarEvent {
  const originalStart = instanceOriginalStart(instanceStart)
  const start = patch.start ?? originalStart
  const end = patch.end ?? (
    start.dateTime
      ? { dateTime: new Date(new Date(start.dateTime).getTime() + Math.max(60_000, eventDuration(previousMaster))).toISOString(), timeZone: previousMaster.end.timeZone }
      : { date: new Date(new Date(assertDefined(start.date, 'All-day instance is missing date')).getTime() + Math.max(86400000, eventDuration(previousMaster))).toISOString().split('T')[0] }
  )
  const normalized = normalizeRange(previousMaster, start, end)

  return {
    ...previousMaster,
    ...patch,
    uuid: undefined,
    googleEventId,
    googleCalendarId: calendarId,
    recurringEventId: masterId,
    originalStartTime: originalStart,
    recurrence: undefined,
    start: normalized.start,
    end: normalized.end,
    completed: false,
    status: patch.status ?? previousMaster.status,
    visibility: patch.visibility ?? previousMaster.visibility,
    transparency: patch.transparency ?? previousMaster.transparency,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

async function deleteDownstreamData(calendarId: string, masterIds: string[]): Promise<void> {
  if (!masterIds.length) return

  const masters = await db.events
    .where('[googleCalendarId+googleEventId]')
    .anyOf(masterIds.map((masterId) => [calendarId, masterId] as [string, string]))
    .toArray()
  await db.events.bulkDelete(masters.map((master) => assertDefined(master.uuid, 'Master is missing uuid')))

  const exceptions = await db.events
    .where('recurringEventId')
    .anyOf(masterIds)
    .filter((event) => event.googleCalendarId === calendarId)
    .toArray()
  await db.events.bulkDelete(exceptions.map((exception) => assertDefined(exception.uuid, 'Exception is missing uuid')))

  const completions = await db.completedEvents
    .filter((completion) => completion.googleCalendarId === calendarId && masterIds.includes(completion.masterEventId))
    .toArray()
  await db.completedEvents.bulkDelete(completions.map((completion) => assertDefined(completion.id, 'Completion is missing id')))
}

async function cancelAndSnapshot(queryClient: QueryClient): Promise<PreviousLists> {
  await queryClient.cancelQueries({ queryKey: eventKeys.lists() })
  return queryClient.getQueriesData<CalendarEvent[]>({ queryKey: eventKeys.lists() })
}

function restoreLists(queryClient: QueryClient, previousLists: PreviousLists): void {
  for (const [queryKey, data] of previousLists) {
    queryClient.setQueryData(queryKey as string[], data)
  }
}

async function executePlan(plan: MutationPlan) {
  switch (plan.command) {
    case 'instance-edit':
    case 'instance-delete':
      return eventsApi.thisEvent(plan.calendarId, plan.masterId, plan.payload)
    case 'event-edit':
      return eventsApi.update(plan.calendarId, plan.eventId, plan.payload)
    case 'event-delete':
      return eventsApi.delete(plan.calendarId, plan.eventId)
    case 'all-edit':
    case 'all-delete':
      return eventsApi.all(plan.calendarId, plan.masterId, plan.payload)
    case 'following-edit':
    case 'following-delete':
      return eventsApi.following(plan.calendarId, plan.masterId, plan.payload)
  }
}

async function getMaster(calendarId: string, masterId: string): Promise<CalendarEvent> {
  return assertDefined(
    await db.events
      .where('[googleCalendarId+googleEventId]')
      .equals([calendarId, masterId])
      .first(),
    'Recurring mutation master is missing',
  )
}

async function getExceptions(masterId: string): Promise<CalendarEvent[]> {
  return db.events.where('recurringEventId').equals(masterId).toArray()
}

function downstreamMasterIds(plan: MutationPlan): string[] {
  if (plan.command !== 'following-edit' && plan.command !== 'following-delete') return []
  return [...new Set(plan.payload.downstream_master_ids ?? [])].filter((id) => id && id !== plan.masterId)
}

async function snapshotDownstream(calendarId: string, masterIds: string[]) {
  if (!masterIds.length) {
    return { masters: [], exceptions: [], completions: [] }
  }

  const masters = await db.events
    .where('[googleCalendarId+googleEventId]')
    .anyOf(masterIds.map((masterId) => [calendarId, masterId] as [string, string]))
    .toArray()
  const exceptions = await db.events
    .where('recurringEventId')
    .anyOf(masterIds)
    .filter((event) => event.googleCalendarId === calendarId)
    .toArray()
  const completions = await db.completedEvents
    .filter((completion) => completion.googleCalendarId === calendarId && masterIds.includes(completion.masterEventId))
    .toArray()

  return { masters, exceptions, completions }
}

function followingPatch(plan: Extract<MutationPlan, { command: 'following-edit' | 'following-delete' }>): Partial<CalendarEvent> {
  return plan.command === 'following-edit' ? plan.payload.patch : {}
}

function allPatch(plan: Extract<MutationPlan, { command: 'all-edit' | 'all-delete' }>): Partial<CalendarEvent> {
  return plan.command === 'all-edit' ? plan.payload.patch : {}
}

export function useRecurringMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: executePlan,
    onMutate: async (plan): Promise<MutationContext> => {
      const previousLists = await cancelAndSnapshot(queryClient)
      const { calendarId, masterId } = plan
      const previousMaster = await getMaster(calendarId, masterId)
      const previousExceptions = await getExceptions(masterId)
      const previousCompletions = await db.completedEvents
        .filter((completion) => completion.masterEventId === masterId)
        .toArray()
      const downstream = await snapshotDownstream(calendarId, downstreamMasterIds(plan))
      let tempTailId: string | undefined

      switch (plan.command) {
        case 'instance-edit':
          await db.events.add(buildOptimisticInstanceEvent(
            previousMaster,
            calendarId,
            masterId,
            plan.payload.instance_start,
            plan.payload.patch,
            `temp-instance-${Date.now()}`,
          ))
          break

        case 'instance-delete':
          await db.events.add({
            ...previousMaster,
            uuid: undefined,
            googleEventId: `temp-cancel-${Date.now()}`,
            googleCalendarId: calendarId,
            recurringEventId: masterId,
            originalStartTime: instanceOriginalStart(plan.payload.instance_start),
            instanceOriginalStart: instanceOriginalStart(plan.payload.instance_start),
            recurrence: undefined,
            status: 'cancelled',
            start: instanceOriginalStart(plan.payload.instance_start),
            end: instanceOriginalStart(plan.payload.instance_start),
            completed: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          break

        case 'event-edit': {
          const existing = assertDefined(
            await db.events.where('[googleCalendarId+googleEventId]').equals([calendarId, plan.eventId]).first(),
            'Event edit target is missing',
          )
          await db.events.put({ ...existing, ...plan.payload, updatedAt: new Date().toISOString() })
          break
        }

        case 'event-delete': {
          const existing = assertDefined(
            await db.events.where('[googleCalendarId+googleEventId]').equals([calendarId, plan.eventId]).first(),
            'Event delete target is missing',
          )
          await db.events.put({ ...existing, status: 'cancelled', updatedAt: new Date().toISOString() })
          break
        }

        case 'all-edit': {
          let patch = allPatch(plan)
          if (patch.start && !Object.prototype.hasOwnProperty.call(patch, 'recurrence')) {
            const adjustedRecurrence = adjustRecurrenceForStartChange(previousMaster.recurrence, previousMaster.start, patch.start)
            if (adjustedRecurrence) {
              patch = { ...patch, recurrence: adjustedRecurrence }
            }
          }
          await db.events.put({ ...previousMaster, ...patch, updatedAt: new Date().toISOString() })
          if (resetsExceptions(patch)) {
            await db.events.bulkDelete(previousExceptions.map((event) => assertDefined(event.uuid, 'Exception is missing uuid')))
          } else {
            for (const exception of previousExceptions) {
              await db.events.put({ ...exception, ...patch, updatedAt: new Date().toISOString() })
            }
          }
          break
        }

        case 'all-delete':
          await db.events.delete(assertDefined(previousMaster.uuid, 'Master is missing uuid'))
          await db.events.bulkDelete(previousExceptions.map((event) => assertDefined(event.uuid, 'Exception is missing uuid')))
          break

        case 'following-edit':
        case 'following-delete': {
          const splitPoint = plan.payload.split_point
          const patch = followingPatch(plan)
          await deleteDownstreamData(calendarId, downstreamMasterIds(plan))

          const isAllDay = !!previousMaster.start.date && !previousMaster.start.dateTime
          const untilStr = splitUntilString(splitPoint, isAllDay)
          const truncatedRecurrence = assertDefined(previousMaster.recurrence, 'Following mutation requires recurrence')
            .filter((rule) => !rule.startsWith('EXDATE') || new Date(rule.substring(rule.indexOf(':') + 1).trim()) < new Date(splitPoint))
            .map((rule) => rule.startsWith('RRULE:')
              ? rule.replace(/;?UNTIL=[^;]+/, '').replace(/;?COUNT=\d+/, '') + `;UNTIL=${untilStr}`
              : rule)
          await db.events.put({ ...previousMaster, recurrence: truncatedRecurrence, updatedAt: new Date().toISOString() })

          if (plan.command === 'following-delete') {
            const futureExceptions = previousExceptions.filter((exception) => isFutureOccurrence(dateTimeValue(assertDefined(exception.originalStartTime, 'Exception is missing originalStartTime')), splitPoint))
            await db.events.bulkDelete(futureExceptions.map((event) => assertDefined(event.uuid, 'Exception is missing uuid')))
            const futureCompletions = previousCompletions.filter((completion) => isFutureOccurrence(completion.instanceStart, splitPoint))
            await db.completedEvents.bulkDelete(futureCompletions.map((completion) => assertDefined(completion.id, 'Completion is missing id')))
            break
          }

          const deltaMs = seriesDeltaMs(splitPoint, patch)
          const duration = eventDuration(previousMaster)
          const tailStart = patch.start ?? (isAllDay ? { date: splitPoint } : { dateTime: splitPoint, timeZone: previousMaster.start.timeZone })
          const tailEnd = patch.end ?? (
            isAllDay
              ? { date: new Date(new Date(assertDefined(tailStart.date, 'All-day tail is missing date')).getTime() + Math.max(86400000, duration)).toISOString().split('T')[0] }
              : { dateTime: new Date(new Date(assertDefined(tailStart.dateTime, 'Timed tail is missing dateTime')).getTime() + Math.max(60_000, duration)).toISOString(), timeZone: previousMaster.end.timeZone }
          )
          const normalizedTail = normalizeRange(previousMaster, tailStart, tailEnd)
          const ruleChanged = recurrenceChanged(patch)
          tempTailId = `temp-following-${Date.now()}`

          await db.events.add({
            ...previousMaster,
            ...patch,
            uuid: undefined,
            googleEventId: tempTailId,
            start: normalizedTail.start,
            end: normalizedTail.end,
            recurrence: patch.recurrence ?? buildOptimisticTailRecurrence(
              assertDefined(previousMaster.recurrence, 'Following mutation requires recurrence'),
              splitPoint,
              previousMaster,
              normalizedTail.start,
            ),
            recurringEventId: undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })

          for (const exception of previousExceptions) {
            const originalStartTime = assertDefined(exception.originalStartTime, 'Exception is missing originalStartTime')
            const exceptionStart = dateTimeValue(originalStartTime)
            if (!isFutureOccurrence(exceptionStart, splitPoint)) continue
            if (isSplitPointOccurrence(exceptionStart, splitPoint) || ruleChanged) {
              await db.events.delete(assertDefined(exception.uuid, 'Exception is missing uuid'))
              continue
            }

            const alignedOriginalStart = shiftDateTimeValue(originalStartTime, deltaMs)
            const alignedRange = alignedExceptionRange(
              previousMaster,
              alignedOriginalStart,
              normalizedTail.start,
              normalizedTail.end,
            )
            await db.events.put({
              ...exception,
              recurringEventId: tempTailId,
              originalStartTime: alignedOriginalStart,
              instanceOriginalStart: alignedOriginalStart,
              start: alignedRange.start,
              end: alignedRange.end,
              updatedAt: new Date().toISOString(),
            })
          }

          for (const completion of previousCompletions) {
            if (!isFutureOccurrence(completion.instanceStart, splitPoint)) continue
            await db.completedEvents.delete(assertDefined(completion.id, 'Completion is missing id'))
            await db.completedEvents.put({
              googleCalendarId: completion.googleCalendarId,
              masterEventId: tempTailId,
              instanceStart: dateTimeValue(shiftDateTimeValue(instanceOriginalStart(completion.instanceStart), deltaMs)),
            })
          }
          break
        }
      }

      return {
        previousLists,
        previousMaster,
        previousExceptions,
        previousCompletions,
        previousDownstreamMasters: downstream.masters,
        previousDownstreamExceptions: downstream.exceptions,
        previousDownstreamCompletions: downstream.completions,
        tempTailId,
      }
    },
    onError: async (_, __, context) => {
      if (!context) return
      restoreLists(queryClient, context.previousLists)

      await db.transaction('rw', db.events, db.completedEvents, async () => {
        const tempEvents = await db.events
          .filter((event) => event.googleEventId?.startsWith('temp-') ?? false)
          .toArray()
        await db.events.bulkDelete(tempEvents.map((event) => assertDefined(event.uuid, 'Temp event is missing uuid')))

        if (context.previousMaster) {
          await db.events.put(context.previousMaster)
        }
        await db.events.bulkPut([
          ...context.previousExceptions,
          ...context.previousDownstreamMasters,
          ...context.previousDownstreamExceptions,
        ])

        const tempCompletions = await db.completedEvents
          .filter((completion) => completion.masterEventId === context.tempTailId || completion.masterEventId === context.previousMaster?.googleEventId)
          .toArray()
        await db.completedEvents.bulkDelete(tempCompletions.map((completion) => assertDefined(completion.id, 'Temp completion is missing id')))
        await db.completedEvents.bulkPut([
          ...context.previousCompletions,
          ...context.previousDownstreamCompletions,
        ])
      })

      toast.error('Failed to update event')
    },
    onSuccess: async (response, plan, context) => {
      if (!response) return

      await db.transaction('rw', db.events, db.completedEvents, async () => {
        if (plan.command === 'following-edit' || plan.command === 'following-delete') {
          const result = response as FollowingResult
          await deleteDownstreamData(plan.calendarId, downstreamMasterIds(plan))

          const existingTruncated = await db.events
            .where('[googleCalendarId+googleEventId]')
            .equals([result.truncated_master.googleCalendarId, assertDefined(result.truncated_master.googleEventId, 'Truncated master is missing googleEventId')])
            .first()
          await db.events.put({ ...result.truncated_master, uuid: existingTruncated?.uuid })

          if (result.new_master) {
            const newMasterId = assertDefined(result.new_master.googleEventId, 'New master is missing googleEventId')
            const tempTailId = context?.tempTailId
            const existingReal = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([result.new_master.googleCalendarId, newMasterId])
              .first()
            const tempTail = tempTailId
              ? await db.events
                  .where('[googleCalendarId+googleEventId]')
                  .equals([plan.calendarId, tempTailId])
                  .first()
              : undefined
            await db.events.put({ ...result.new_master, uuid: existingReal?.uuid ?? tempTail?.uuid })

            if (tempTailId) {
              const tempExceptions = await db.events.where('recurringEventId').equals(tempTailId).toArray()
              await db.events.bulkDelete(tempExceptions.map((event) => assertDefined(event.uuid, 'Temp exception is missing uuid')))

              const tempCompletions = await db.completedEvents
                .filter((completion) => completion.masterEventId === tempTailId)
                .toArray()
              for (const completion of tempCompletions) {
                await db.completedEvents.put({ ...completion, masterEventId: newMasterId })
              }
            }
          }

          for (const deletedId of result.deleted_exception_ids) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([plan.calendarId, deletedId])
              .first()
            if (existing?.uuid) {
              await db.events.delete(existing.uuid)
            }
          }

          for (const exception of result.migrated_exceptions) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([exception.googleCalendarId, assertDefined(exception.googleEventId, 'Migrated exception is missing googleEventId')])
              .first()
            const tempMatch = !existing?.uuid && context?.tempTailId
              ? await db.events
                  .where('recurringEventId')
                  .equals(context.tempTailId)
                  .filter((event) => dateTimeValue(assertDefined(event.originalStartTime, 'Temp exception is missing originalStartTime')) === dateTimeValue(assertDefined(exception.originalStartTime, 'Migrated exception is missing originalStartTime')))
                  .first()
              : undefined
            await db.events.put({ ...exception, uuid: existing?.uuid ?? tempMatch?.uuid })
          }
        }

        if (plan.command === 'instance-edit' || plan.command === 'event-edit') {
          const event = response as CalendarEvent
          const existing = await db.events
            .where('[googleCalendarId+googleEventId]')
            .equals([event.googleCalendarId, assertDefined(event.googleEventId, 'Event response is missing googleEventId')])
            .first()
          await db.events.put({ ...event, uuid: existing?.uuid })
        }

        if (plan.command === 'all-edit') {
          const result = response as AllResult
          const existing = await db.events
            .where('[googleCalendarId+googleEventId]')
            .equals([result.master.googleCalendarId, assertDefined(result.master.googleEventId, 'All events master is missing googleEventId')])
            .first()
          await db.events.put({ ...result.master, uuid: existing?.uuid })

          for (const exception of result.updated_exceptions) {
            const existingException = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([exception.googleCalendarId, assertDefined(exception.googleEventId, 'Updated exception is missing googleEventId')])
              .first()
            await db.events.put({ ...exception, uuid: existingException?.uuid })
          }

          for (const deletedId of result.deleted_exception_ids) {
            const existingException = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([plan.calendarId, deletedId])
              .first()
            if (existingException?.uuid) {
              await db.events.delete(existingException.uuid)
            }
          }
        }

        if (plan.command === 'all-delete') {
          const master = await db.events
            .where('[googleCalendarId+googleEventId]')
            .equals([plan.calendarId, plan.masterId])
            .first()
          if (master?.uuid) {
            await db.events.delete(master.uuid)
          }
          const exceptions = await db.events.where('recurringEventId').equals(plan.masterId).toArray()
          await db.events.bulkDelete(exceptions.map((event) => assertDefined(event.uuid, 'Exception is missing uuid')))
        }

        const tempEvents = await db.events
          .filter((event) => event.googleEventId?.startsWith('temp-') ?? false)
          .toArray()
        await db.events.bulkDelete(tempEvents.map((event) => assertDefined(event.uuid, 'Temp event is missing uuid')))
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}
