import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { RRule } from 'rrule'
import { toast } from 'sonner'
import { eventsApi, type AllResult, type FollowingResult } from '../api/events'
import { eventKeys } from '../lib'
import { db, type DexieCompletion, type DexieRecurrenceSegment } from '../lib/db'
import { adjustRecurrenceForStartChange } from '../lib/recurrence'
import type { CalendarEvent } from '../types'
import type { MutationPlan } from '../lib/recurrence/planner'

type PreviousLists = [unknown, CalendarEvent[] | undefined][]

interface MutationContext {
  previousLists: PreviousLists
  previousMaster?: CalendarEvent
  previousExceptions: CalendarEvent[]
  previousCompletions: DexieCompletion[]
  previousDownstreamMasters: CalendarEvent[]
  previousDownstreamExceptions: CalendarEvent[]
  previousDownstreamCompletions: DexieCompletion[]
  previousSegments: DexieRecurrenceSegment[]
  tempTailId?: string
  lineageRootId: string
}

const ICAL_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function getDateTimeValue(value: CalendarEvent['start'] | CalendarEvent['originalStartTime'] | undefined): string {
  return value?.dateTime ?? value?.date ?? ''
}

function shiftDateTimeValue(
  value: CalendarEvent['start'] | CalendarEvent['originalStartTime'] | undefined,
  deltaMs: number,
): CalendarEvent['start'] | CalendarEvent['originalStartTime'] | undefined {
  if (!value) return value
  if (value.dateTime) {
    return {
      dateTime: new Date(new Date(value.dateTime).getTime() + deltaMs).toISOString(),
      timeZone: value.timeZone,
    }
  }
  if (value.date) {
    const shifted = new Date(`${value.date}T00:00:00Z`)
    shifted.setUTCDate(shifted.getUTCDate() + Math.round(deltaMs / 86400000))
    return { date: shifted.toISOString().split('T')[0] }
  }
  return value
}

function getSeriesDeltaMs(
  splitPoint: string,
  patch: Partial<CalendarEvent>,
  previousMaster: CalendarEvent | undefined,
): number {
  const nextStart = patch.start
  if (!nextStart) return 0

  if (nextStart.dateTime) {
    return new Date(nextStart.dateTime).getTime() - new Date(splitPoint).getTime()
  }

  if (nextStart.date) {
    const splitDate = splitPoint.includes('T') ? splitPoint.split('T')[0] : splitPoint
    return new Date(`${nextStart.date}T00:00:00Z`).getTime() - new Date(`${splitDate}T00:00:00Z`).getTime()
  }

  if (previousMaster?.start.dateTime && splitPoint.includes('T')) {
    return new Date(previousMaster.start.dateTime).getTime() - new Date(splitPoint).getTime()
  }

  return 0
}

function isFutureOccurrence(value: string, splitPoint: string): boolean {
  return value >= splitPoint
}

function isSplitPointOccurrence(value: string, splitPoint: string): boolean {
  return value === splitPoint
}

function getWeekdayIndex(value: CalendarEvent['start'] | CalendarEvent['originalStartTime'] | undefined): number | null {
  if (!value) return null
  if (value.dateTime) {
    return new Date(value.dateTime).getDay() === 0 ? 6 : new Date(value.dateTime).getDay() - 1
  }
  if (value.date) {
    const day = new Date(`${value.date}T00:00:00Z`).getUTCDay()
    return day === 0 ? 6 : day - 1
  }
  return null
}

function rewriteByDay(rrule: string, oldDay: number, newDay: number): string {
  const oldByDay = ICAL_DAYS[oldDay]
  const newByDay = ICAL_DAYS[newDay]
  const match = rrule.match(/BYDAY=([^;]+)/)
  if (!match) return rrule
  const days = match[1].split(',').map((day) => day === oldByDay ? newByDay : day)
  return rrule.replace(/BYDAY=[^;]+/, `BYDAY=${days.join(',')}`)
}

function buildOptimisticTailRecurrence(
  recurrence: string[],
  splitPoint: string,
  previousMaster: CalendarEvent,
  tailStart: CalendarEvent['start'],
): string[] {
  return recurrence
    .filter((rule) => {
      if (!rule.startsWith('EXDATE')) return true
      const dateStr = rule.substring(rule.indexOf(':') + 1).trim()
      return new Date(dateStr) >= new Date(splitPoint)
    })
    .map((rule) => {
      if (!rule.startsWith('RRULE:')) return rule
      let nextRule = rule
      const oldDay = getWeekdayIndex(splitPoint.includes('T') ? { dateTime: splitPoint } : { date: splitPoint })
      const newDay = getWeekdayIndex(tailStart)
      if (oldDay !== null && newDay !== null && oldDay !== newDay && nextRule.includes('BYDAY=')) {
        nextRule = rewriteByDay(nextRule, oldDay, newDay)
      }
      const countMatch = nextRule.match(/COUNT=(\d+)/)
      const originalStart = getDateTimeValue(previousMaster.start)
      if (countMatch && originalStart) {
        const ruleSet = new RRule({
          ...RRule.fromString(rule.substring(6)).origOptions,
          dtstart: new Date(originalStart),
        })
        const remainingCount = ruleSet.all().filter((occurrence) => occurrence >= new Date(splitPoint)).length
        nextRule = nextRule.replace(/COUNT=\d+/, `COUNT=${Math.max(1, remainingCount)}`)
      }
      return nextRule
    })
}

function recurrenceChanged(patch: Partial<CalendarEvent>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'recurrence') && !!patch.recurrence?.length
}

function resetsExceptions(patch: Partial<CalendarEvent>): boolean {
  return (
    (Object.prototype.hasOwnProperty.call(patch, 'recurrence')) ||
    Object.prototype.hasOwnProperty.call(patch, 'start') ||
    Object.prototype.hasOwnProperty.call(patch, 'end')
  )
}

function getSplitUntilString(splitPoint: string, isAllDay: boolean): string {
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

function normalizeOptimisticRange(
  previousMaster: CalendarEvent | undefined,
  start: CalendarEvent['start'],
  end: CalendarEvent['end'],
): { start: CalendarEvent['start']; end: CalendarEvent['end'] } {
  if (start.date && end.date) {
    const startDate = new Date(start.date)
    const endDate = new Date(end.date)

    if (endDate <= startDate) {
      const baseStart = previousMaster?.start.date ? new Date(previousMaster.start.date) : null
      const baseEnd = previousMaster?.end.date ? new Date(previousMaster.end.date) : null
      const durationDays = baseStart && baseEnd ? Math.max(1, Math.round((baseEnd.getTime() - baseStart.getTime()) / 86400000)) : 1
      const normalizedEnd = new Date(startDate)
      normalizedEnd.setDate(normalizedEnd.getDate() + durationDays)
      return {
        start,
        end: { date: normalizedEnd.toISOString().split('T')[0] },
      }
    }
  }

  if (start.dateTime && end.dateTime) {
    const startDate = new Date(start.dateTime)
    const endDate = new Date(end.dateTime)

    if (endDate <= startDate) {
      const baseStart = previousMaster?.start.dateTime ? new Date(previousMaster.start.dateTime) : null
      const baseEnd = previousMaster?.end.dateTime ? new Date(previousMaster.end.dateTime) : null
      const durationMs = baseStart && baseEnd ? Math.max(60_000, baseEnd.getTime() - baseStart.getTime()) : 3_600_000
      return {
        start,
        end: {
          dateTime: new Date(startDate.getTime() + durationMs).toISOString(),
          timeZone: end.timeZone ?? previousMaster?.end.timeZone,
        },
      }
    }
  }

  return { start, end }
}

function buildAlignedExceptionRange(
  previousMaster: CalendarEvent | undefined,
  alignedOriginalStart: CalendarEvent['start'] | CalendarEvent['originalStartTime'] | undefined,
  tailStart: CalendarEvent['start'],
  tailEnd: CalendarEvent['end'],
): { start: CalendarEvent['start']; end: CalendarEvent['end'] } {
  if (alignedOriginalStart?.date && tailStart.date && tailEnd.date) {
    const durationDays = Math.max(
      1,
      Math.round(
        (new Date(tailEnd.date).getTime() - new Date(tailStart.date).getTime()) / 86400000,
      ),
    )
    const start = { date: alignedOriginalStart.date }
    const endDate = new Date(`${alignedOriginalStart.date}T00:00:00Z`)
    endDate.setUTCDate(endDate.getUTCDate() + durationDays)
    return {
      start,
      end: { date: endDate.toISOString().split('T')[0] },
    }
  }

  if (alignedOriginalStart?.dateTime && tailStart.dateTime && tailEnd.dateTime) {
    const durationMs = Math.max(
      60_000,
      new Date(tailEnd.dateTime).getTime() - new Date(tailStart.dateTime).getTime(),
    )
    const start = {
      dateTime: alignedOriginalStart.dateTime,
      timeZone: tailStart.timeZone ?? previousMaster?.start.timeZone,
    }
    const end = {
      dateTime: new Date(new Date(alignedOriginalStart.dateTime).getTime() + durationMs).toISOString(),
      timeZone: tailEnd.timeZone ?? previousMaster?.end.timeZone,
    }
    return normalizeOptimisticRange(previousMaster, start, end)
  }

  return {
    start: tailStart,
    end: tailEnd,
  }
}

function buildOptimisticInstanceEvent(
  previousMaster: CalendarEvent | undefined,
  calendarId: string,
  masterId: string,
  instanceStart: string,
  patch: Partial<CalendarEvent>,
  googleEventId: string,
): CalendarEvent {
  const isTimed = instanceStart.includes('T')

  if (isTimed) {
    const baseStart = previousMaster?.start.dateTime ? new Date(previousMaster.start.dateTime) : null
    const baseEnd = previousMaster?.end.dateTime ? new Date(previousMaster.end.dateTime) : null
    const durationMs = baseStart && baseEnd ? Math.max(60_000, baseEnd.getTime() - baseStart.getTime()) : 3_600_000
    const start = patch.start ?? { dateTime: instanceStart, timeZone: previousMaster?.start.timeZone }
    const startDateTime = start.dateTime ?? instanceStart
    const end = patch.end ?? {
      dateTime: new Date(new Date(startDateTime).getTime() + durationMs).toISOString(),
      timeZone: previousMaster?.end.timeZone,
    }
    const normalized = normalizeOptimisticRange(previousMaster, start, end)

    return {
      ...previousMaster,
      ...patch,
      uuid: undefined,
      googleEventId,
      googleCalendarId: calendarId,
      recurringEventId: masterId,
      originalStartTime: { dateTime: instanceStart },
      recurrence: undefined,
      start: normalized.start,
      end: normalized.end,
      completed: false,
      status: patch.status ?? previousMaster?.status ?? 'confirmed',
      visibility: patch.visibility ?? previousMaster?.visibility ?? 'default',
      transparency: patch.transparency ?? previousMaster?.transparency ?? 'opaque',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as CalendarEvent
  }

  const baseStart = previousMaster?.start.date ? new Date(previousMaster.start.date) : null
  const baseEnd = previousMaster?.end.date ? new Date(previousMaster.end.date) : null
  const durationDays = baseStart && baseEnd ? Math.max(1, Math.round((baseEnd.getTime() - baseStart.getTime()) / 86400000)) : 1
  const start = patch.start ?? { date: instanceStart }
  const startDate = start.date ?? instanceStart
  const end = patch.end ?? {
    date: new Date(new Date(startDate).setDate(new Date(startDate).getDate() + durationDays)).toISOString().split('T')[0],
  }
  const normalized = normalizeOptimisticRange(previousMaster, start, end)

  return {
    ...previousMaster,
    ...patch,
    uuid: undefined,
    googleEventId,
    googleCalendarId: calendarId,
    recurringEventId: masterId,
    originalStartTime: { date: instanceStart },
    recurrence: undefined,
    start: normalized.start,
    end: normalized.end,
    completed: false,
    status: patch.status ?? previousMaster?.status ?? 'confirmed',
    visibility: patch.visibility ?? previousMaster?.visibility ?? 'default',
    transparency: patch.transparency ?? previousMaster?.transparency ?? 'opaque',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as CalendarEvent
}

async function upsertRecurrenceSegment(
  segment: Omit<DexieRecurrenceSegment, 'id'>,
): Promise<void> {
  const existing = await db.recurrenceSegments
    .where('[googleCalendarId+masterEventId]')
    .equals([segment.googleCalendarId, segment.masterEventId])
    .first()

  await db.recurrenceSegments.put({
    ...segment,
    id: existing?.id,
  })
}

async function deleteDownstreamData(
  calendarId: string,
  masterIds: string[],
): Promise<void> {
  if (!masterIds.length) return

  const masters = await db.events
    .where('[googleCalendarId+googleEventId]')
    .anyOf(masterIds.map((masterId) => [calendarId, masterId] as [string, string]))
    .toArray()
  for (const master of masters) {
    if (master.uuid) await db.events.delete(master.uuid)
  }

  const exceptions = await db.events
    .where('recurringEventId')
    .anyOf(masterIds)
    .filter((event) => event.googleCalendarId === calendarId)
    .toArray()
  for (const exception of exceptions) {
    if (exception.uuid) await db.events.delete(exception.uuid)
  }

  const completions = await db.completedEvents
    .filter((completion) => completion.googleCalendarId === calendarId && masterIds.includes(completion.masterEventId))
    .toArray()
  for (const completion of completions) {
    if (completion.id) await db.completedEvents.delete(completion.id)
  }

  const segments = await db.recurrenceSegments
    .where('[googleCalendarId+masterEventId]')
    .anyOf(masterIds.map((masterId) => [calendarId, masterId] as [string, string]))
    .toArray()
  for (const segment of segments) {
    if (segment.id) await db.recurrenceSegments.delete(segment.id)
  }
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
      return eventsApi.thisEvent(plan.calendarId, plan.masterId, plan.payload as any)
    case 'event-edit':
      return eventsApi.update(plan.calendarId, plan.eventId ?? plan.masterId, plan.payload as any)
    case 'event-delete':
      return eventsApi.delete(plan.calendarId, plan.eventId ?? plan.masterId)
    case 'all-edit':
    case 'all-delete':
      return eventsApi.all(plan.calendarId, plan.masterId, plan.payload as any)
    case 'following-edit':
    case 'following-delete':
      return eventsApi.following(plan.calendarId, plan.masterId, plan.payload as any)
  }
}

export function useRecurringMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: executePlan,
    onMutate: async (plan) => {
      const previousLists = await cancelAndSnapshot(queryClient)
      const { calendarId, masterId, eventId, command } = plan
      const patch = (plan.payload as any).patch ?? plan.payload
      let tempTailId: string | undefined
      const downstreamMasterIds = (((plan.payload as any).downstream_master_ids ?? []) as string[])
        .filter((value, index, values) => !!value && value !== masterId && values.indexOf(value) === index)

      const previousMaster = await db.events
        .where('[googleCalendarId+googleEventId]')
        .equals([calendarId, masterId])
        .first()

      const previousExceptions = await db.events
        .where('recurringEventId')
        .equals(masterId)
        .toArray()
      const previousCompletions = await db.completedEvents
        .filter((completion) => completion.masterEventId === masterId)
        .toArray()
      const previousDownstreamMasters = downstreamMasterIds.length
        ? await db.events
            .where('[googleCalendarId+googleEventId]')
            .anyOf(downstreamMasterIds.map((downstreamMasterId) => [calendarId, downstreamMasterId] as [string, string]))
            .toArray()
        : []
      const previousDownstreamExceptions = downstreamMasterIds.length
        ? await db.events
            .where('recurringEventId')
            .anyOf(downstreamMasterIds)
            .filter((event) => event.googleCalendarId === calendarId)
            .toArray()
        : []
      const previousDownstreamCompletions = downstreamMasterIds.length
        ? await db.completedEvents
            .filter((completion) => completion.googleCalendarId === calendarId && downstreamMasterIds.includes(completion.masterEventId))
            .toArray()
        : []
      const previousSegments = await db.recurrenceSegments
        .where('googleCalendarId')
        .equals(calendarId)
        .toArray()
      const currentSegment = await db.recurrenceSegments
        .where('[googleCalendarId+masterEventId]')
        .equals([calendarId, masterId])
        .first()
      const lineageRootId = ((plan.payload as any).lineage_root_id as string | undefined)
        ?? currentSegment?.lineageRootId
        ?? masterId

      switch (command) {
        case 'instance-edit': {
          const tempId = `temp-instance-${Date.now()}`
          const instanceStart = (plan.payload as any).instance_start
          await db.events.add(
            buildOptimisticInstanceEvent(
              previousMaster,
              calendarId,
              masterId,
              instanceStart,
              patch,
              tempId,
            ),
          )
          break
        }

        case 'instance-delete': {
          // Create a cancelled exception so expansion skips this instance
          const tempId = `temp-cancel-${Date.now()}`
          const instanceStart = (plan.payload as any).instance_start
          await db.events.add({
            googleEventId: tempId,
            googleCalendarId: calendarId,
            recurringEventId: masterId,
            originalStartTime: instanceStart?.includes('T')
              ? { dateTime: instanceStart }
              : { date: instanceStart },
            summary: '',
            start: instanceStart?.includes('T') ? { dateTime: instanceStart } : { date: instanceStart },
            end: instanceStart?.includes('T') ? { dateTime: instanceStart } : { date: instanceStart },
            status: 'cancelled',
            completed: false,
            visibility: 'default',
            transparency: 'opaque',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as CalendarEvent)
          break
        }

        case 'event-edit': {
          // Patch the existing exception in place
          const existing = eventId
            ? await db.events.where('[googleCalendarId+googleEventId]').equals([calendarId, eventId]).first()
            : undefined
          if (existing) {
            await db.events.put({ ...existing, ...patch, updatedAt: new Date().toISOString() })
          }
          break
        }

        case 'event-delete': {
          // Mark existing exception as cancelled
          const existing = eventId
            ? await db.events.where('[googleCalendarId+googleEventId]').equals([calendarId, eventId]).first()
            : undefined
          if (existing) {
            await db.events.put({ ...existing, status: 'cancelled', updatedAt: new Date().toISOString() })
          }
          break
        }

        case 'all-edit': {
          const shouldResetExceptions = resetsExceptions(patch)
          let optimisticPatch = patch
          if (
            previousMaster &&
            patch.start &&
            !Object.prototype.hasOwnProperty.call(patch, 'recurrence')
          ) {
            const adjustedRecurrence = adjustRecurrenceForStartChange(
              previousMaster.recurrence,
              previousMaster.start,
              patch.start,
            )
            if (adjustedRecurrence) {
              optimisticPatch = {
                ...patch,
                recurrence: adjustedRecurrence,
              }
            }
          }
          if (previousMaster) {
            await db.events.put({ ...previousMaster, ...optimisticPatch, updatedAt: new Date().toISOString() })
            await upsertRecurrenceSegment({
              googleCalendarId: calendarId,
              masterEventId: masterId,
              lineageRootId,
              segmentStart: getDateTimeValue(optimisticPatch.start ?? previousMaster.start),
            })
          }
          if (shouldResetExceptions) {
            for (const exc of previousExceptions) {
              await db.events.delete(exc.uuid!)
            }
          } else {
            for (const exc of previousExceptions) {
              await db.events.put({ ...exc, ...optimisticPatch, updatedAt: new Date().toISOString() })
            }
          }
          break
        }

        case 'all-delete': {
          // Delete master + all exceptions
          if (previousMaster) await db.events.delete(previousMaster.uuid!)
          for (const exc of previousExceptions) {
            await db.events.delete(exc.uuid!)
          }
          const currentSegmentRecord = await db.recurrenceSegments
            .where('[googleCalendarId+masterEventId]')
            .equals([calendarId, masterId])
            .first()
          if (currentSegmentRecord?.id) {
            await db.recurrenceSegments.delete(currentSegmentRecord.id)
          }
          break
        }

        case 'following-edit': {
          const splitPoint = (plan.payload as any).split_point as string
          if (previousMaster && previousMaster.recurrence) {
            await upsertRecurrenceSegment({
              googleCalendarId: calendarId,
              masterEventId: masterId,
              lineageRootId,
              segmentStart: currentSegment?.segmentStart ?? getDateTimeValue(previousMaster.start),
            })
            await deleteDownstreamData(calendarId, downstreamMasterIds)
            const deltaMs = getSeriesDeltaMs(splitPoint, patch, previousMaster)
            const isAllDay = !!previousMaster.start.date && !previousMaster.start.dateTime
            const untilStr = getSplitUntilString(splitPoint, isAllDay)
            const ruleChanged = recurrenceChanged(patch)

            // Truncate old master: strip UNTIL/COUNT, add new UNTIL, keep only pre-split EXDATEs
            const truncatedRecurrence = previousMaster.recurrence
              .filter(r => {
                if (!r.startsWith('EXDATE')) return true
                const dateStr = r.substring(r.indexOf(':') + 1).trim()
                return new Date(dateStr) < new Date(splitPoint)
              })
              .map(r => r.startsWith('RRULE:')
                ? r.replace(/;?UNTIL=[^;]+/, '').replace(/;?COUNT=\d+/, '') + `;UNTIL=${untilStr}`
                : r
              )
            await db.events.put({ ...previousMaster, recurrence: truncatedRecurrence, updatedAt: new Date().toISOString() })

            // Create temp tail master — use patch start/end if present, fall back to split point
            tempTailId = `temp-following-${Date.now()}`

            let tailStart = patch.start ?? (isAllDay ? { date: splitPoint } : { dateTime: splitPoint, timeZone: previousMaster.start.timeZone })
            let tailEnd: typeof tailStart
            if (patch.end) {
              tailEnd = patch.end
            } else if (isAllDay) {
              const durationDays = Math.max(1, Math.round(
                (new Date(previousMaster.end.date!).getTime() - new Date(previousMaster.start.date!).getTime()) / 86400000
              ))
              const startStr = tailStart.date ?? splitPoint
              const endDate = new Date(startStr)
              endDate.setDate(endDate.getDate() + durationDays)
              tailEnd = { date: endDate.toISOString().split('T')[0] }
            } else {
              const duration = new Date(previousMaster.end.dateTime!).getTime() - new Date(previousMaster.start.dateTime!).getTime()
              const startStr = tailStart.dateTime ?? splitPoint
              tailEnd = { dateTime: new Date(new Date(startStr).getTime() + duration).toISOString(), timeZone: previousMaster.end.timeZone }
            }
            const normalizedTail = normalizeOptimisticRange(previousMaster, tailStart, tailEnd)
            tailStart = normalizedTail.start
            tailEnd = normalizedTail.end

            // Clean RRULE + keep only post-split EXDATEs
            const tailRecurrence = patch.recurrence ?? buildOptimisticTailRecurrence(
              previousMaster.recurrence,
              splitPoint,
              previousMaster,
              tailStart,
            )

            await db.events.add({
              ...previousMaster,
              ...patch,
              googleEventId: tempTailId,
              start: tailStart,
              end: tailEnd,
              recurrence: tailRecurrence,
              recurringEventId: undefined,
              uuid: undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } as CalendarEvent)
            await upsertRecurrenceSegment({
              googleCalendarId: calendarId,
              masterEventId: tempTailId,
              lineageRootId,
              segmentStart: getDateTimeValue(tailStart),
            })

            for (const exc of previousExceptions) {
              const excStart = exc.originalStartTime?.dateTime ?? exc.originalStartTime?.date ?? ''
              if (isFutureOccurrence(excStart, splitPoint)) {
                if (isSplitPointOccurrence(excStart, splitPoint) || ruleChanged) {
                  await db.events.delete(exc.uuid!)
                  continue
                }
                const alignedOriginalStart = shiftDateTimeValue(exc.originalStartTime, deltaMs)
                const alignedRange = buildAlignedExceptionRange(
                  previousMaster,
                  alignedOriginalStart,
                  tailStart,
                  tailEnd,
                )
                await db.events.put({
                  ...exc,
                  recurringEventId: tempTailId,
                  originalStartTime: alignedOriginalStart,
                  instanceOriginalStart: alignedOriginalStart,
                  start: alignedRange.start,
                  end: alignedRange.end,
                  updatedAt: new Date().toISOString(),
                })
              }
            }

            for (const completion of previousCompletions) {
              if (!isFutureOccurrence(completion.instanceStart, splitPoint)) continue
              await db.completedEvents.delete(completion.id!)
              await db.completedEvents.put({
                googleCalendarId: completion.googleCalendarId,
                masterEventId: tempTailId,
                instanceStart: getDateTimeValue(shiftDateTimeValue(
                  completion.instanceStart.includes('T') ? { dateTime: completion.instanceStart } : { date: completion.instanceStart },
                  deltaMs,
                )) || completion.instanceStart,
              })
            }
          }
          break
        }

        case 'following-delete': {
          const splitPoint = (plan.payload as any).split_point as string
          if (previousMaster && previousMaster.recurrence) {
            await upsertRecurrenceSegment({
              googleCalendarId: calendarId,
              masterEventId: masterId,
              lineageRootId,
              segmentStart: currentSegment?.segmentStart ?? getDateTimeValue(previousMaster.start),
            })
            await deleteDownstreamData(calendarId, downstreamMasterIds)
            const untilStr = getSplitUntilString(splitPoint, !!previousMaster.start.date && !previousMaster.start.dateTime)

            const truncatedRecurrence = previousMaster.recurrence
              .filter(r => {
                if (!r.startsWith('EXDATE')) return true
                const dateStr = r.substring(r.indexOf(':') + 1).trim()
                return new Date(dateStr) < new Date(splitPoint)
              })
              .map(r => r.startsWith('RRULE:')
                ? r.replace(/;?UNTIL=[^;]+/, '').replace(/;?COUNT=\d+/, '') + `;UNTIL=${untilStr}`
                : r
              )
            await db.events.put({ ...previousMaster, recurrence: truncatedRecurrence, updatedAt: new Date().toISOString() })

            // Delete future exceptions
            for (const exc of previousExceptions) {
              const excStart = exc.originalStartTime?.dateTime ?? exc.originalStartTime?.date ?? ''
              if (isFutureOccurrence(excStart, splitPoint)) {
                await db.events.delete(exc.uuid!)
              }
            }

            for (const completion of previousCompletions) {
              if (!isFutureOccurrence(completion.instanceStart, splitPoint)) continue
              await db.completedEvents.delete(completion.id!)
            }
          }
          break
        }
      }

      return {
        previousLists,
        previousMaster,
        previousExceptions,
        previousCompletions,
        previousDownstreamMasters,
        previousDownstreamExceptions,
        previousDownstreamCompletions,
        previousSegments,
        tempTailId,
        lineageRootId,
      } satisfies MutationContext
    },
    onError: async (_, __, context) => {
      if (!context) return
      restoreLists(queryClient, context.previousLists)

      // Restore Dexie state
      await db.transaction('rw', db.events, db.completedEvents, db.recurrenceSegments, async () => {
        // Remove any temp events we created
        const temps = await db.events
          .filter((e) => e.googleEventId?.startsWith('temp-') ?? false)
          .toArray()
        for (const t of temps) {
          await db.events.delete(t.uuid!)
        }

        // Restore master
        if (context.previousMaster) {
          await db.events.put(context.previousMaster)
        }

        // Restore exceptions
        for (const exc of context.previousExceptions) {
          await db.events.put(exc)
        }
        for (const master of context.previousDownstreamMasters) {
          await db.events.put(master)
        }
        for (const exc of context.previousDownstreamExceptions) {
          await db.events.put(exc)
        }

        const completionTemps = await db.completedEvents
          .filter((completion) => completion.masterEventId === context.tempTailId || completion.masterEventId === context.previousMaster?.googleEventId)
          .toArray()
        for (const completion of completionTemps) {
          if (completion.id) await db.completedEvents.delete(completion.id)
        }
        for (const completion of context.previousCompletions) {
          await db.completedEvents.put(completion)
        }
        for (const completion of context.previousDownstreamCompletions) {
          await db.completedEvents.put(completion)
        }

        const rollbackCalendarId =
          context.previousMaster?.googleCalendarId
          ?? context.previousSegments[0]?.googleCalendarId
          ?? ''
        const currentSegments = rollbackCalendarId
          ? await db.recurrenceSegments
              .where('googleCalendarId')
              .equals(rollbackCalendarId)
              .toArray()
          : []
        for (const segment of currentSegments) {
          if (segment.id) await db.recurrenceSegments.delete(segment.id)
        }
        if (context.previousSegments.length) {
          await db.recurrenceSegments.bulkPut(context.previousSegments)
        }
      })

      toast.error('Failed to update event')
    },
    onSuccess: async (response, plan, context) => {
      console.log('[recurring] onSuccess', plan.command, response)
      if (!response) {
        console.warn('[recurring] no response from backend')
        return
      }

      await db.transaction('rw', db.events, db.completedEvents, db.recurrenceSegments, async () => {
        if (plan.command === 'following-edit' || plan.command === 'following-delete') {
          const result = response as FollowingResult
          const downstreamMasterIds = (((plan.payload as any).downstream_master_ids ?? []) as string[])
            .filter((value, index, values) => !!value && value !== plan.masterId && values.indexOf(value) === index)
          await deleteDownstreamData(plan.calendarId, downstreamMasterIds)
          console.log('[recurring] following result:', {
            truncated: result.truncated_master?.googleEventId,
            new: result.new_master?.googleEventId,
            tempTailId: context?.tempTailId,
          })

          if (result.truncated_master?.googleEventId) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([result.truncated_master.googleCalendarId, result.truncated_master.googleEventId])
              .first()
            console.log('[recurring] upserting truncated master, existing uuid:', existing?.uuid)
            await db.events.put({ ...result.truncated_master, uuid: existing?.uuid })
            await upsertRecurrenceSegment({
              googleCalendarId: result.truncated_master.googleCalendarId,
              masterEventId: result.truncated_master.googleEventId,
              lineageRootId: context?.lineageRootId ?? result.truncated_master.googleEventId,
              segmentStart: getDateTimeValue(context?.previousMaster?.start ?? result.truncated_master.start),
            })
          }

          if (result.new_master) {
            const newMasterId = result.new_master.googleEventId
            const tempTailId = context?.tempTailId

            if (tempTailId && newMasterId) {
              const tempTail = await db.events
                .where('[googleCalendarId+googleEventId]')
                .equals([plan.calendarId, tempTailId])
                .first()
              const existingReal = await db.events
                .where('[googleCalendarId+googleEventId]')
                .equals([result.new_master.googleCalendarId, newMasterId])
                .first()
              console.log('[recurring] tempTail found:', !!tempTail, 'existingReal found:', !!existingReal)

              const tempExceptions = await db.events.where('recurringEventId').equals(tempTailId).toArray()
              const reconciledUuid = existingReal?.uuid ?? tempTail?.uuid
              console.log('[recurring] putting new master with uuid:', reconciledUuid, 'recurrence:', result.new_master.recurrence)
              await db.events.put({ ...result.new_master, uuid: reconciledUuid })

              for (const exc of tempExceptions) {
                if (exc.uuid) await db.events.delete(exc.uuid)
              }

              if (tempTail?.uuid && tempTail.uuid !== reconciledUuid) {
                console.log('[recurring] deleting leftover temp tail uuid:', tempTail.uuid)
                await db.events.delete(tempTail.uuid)
              }

              const tempCompletions = await db.completedEvents
                .filter((completion) => completion.masterEventId === tempTailId)
                .toArray()
              for (const completion of tempCompletions) {
                await db.completedEvents.put({
                  ...completion,
                  id: completion.id,
                  masterEventId: newMasterId,
                })
              }
              const tempSegment = await db.recurrenceSegments
                .where('[googleCalendarId+masterEventId]')
                .equals([plan.calendarId, tempTailId])
                .first()
              if (tempSegment?.id) {
                await db.recurrenceSegments.delete(tempSegment.id)
              }
              await upsertRecurrenceSegment({
                googleCalendarId: result.new_master.googleCalendarId,
                masterEventId: newMasterId,
                lineageRootId: context?.lineageRootId ?? newMasterId,
                segmentStart: getDateTimeValue(result.new_master.start),
              })
            } else {
              console.log('[recurring] no tempTailId or newMasterId, direct upsert')
              const existing = await db.events
                .where('[googleCalendarId+googleEventId]')
                .equals([result.new_master.googleCalendarId, result.new_master.googleEventId!])
                .first()
              await db.events.put({ ...result.new_master, uuid: existing?.uuid })
              await upsertRecurrenceSegment({
                googleCalendarId: result.new_master.googleCalendarId,
                masterEventId: result.new_master.googleEventId!,
                lineageRootId: context?.lineageRootId ?? result.new_master.googleEventId!,
                segmentStart: getDateTimeValue(result.new_master.start),
              })
            }
          } else {
            console.log('[recurring] no new_master in response')
          }

          for (const deletedId of result.deleted_exception_ids ?? []) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([plan.calendarId, deletedId])
              .first()
            if (existing?.uuid) await db.events.delete(existing.uuid)
          }

          for (const exc of result.migrated_exceptions ?? []) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([exc.googleCalendarId, exc.googleEventId!])
              .first()
            let reusedUuid = existing?.uuid
            if (!reusedUuid && context?.tempTailId) {
              const tempMatch = await db.events
                .where('recurringEventId')
                .equals(context.tempTailId)
                .filter((event) => getDateTimeValue(event.originalStartTime) === getDateTimeValue(exc.originalStartTime))
                .first()
              reusedUuid = tempMatch?.uuid
            }
            await db.events.put({ ...exc, uuid: reusedUuid })
          }
        }

        if (plan.command === 'instance-edit' || plan.command === 'event-edit') {
          const event = response as CalendarEvent
          console.log('[recurring] upserting event:', event?.googleEventId)
          if (event?.googleEventId) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([event.googleCalendarId, event.googleEventId])
              .first()
            await db.events.put({ ...event, uuid: existing?.uuid })
          }
        }

        if (plan.command === 'all-edit') {
          const result = response as AllResult
          if (result.master?.googleEventId) {
            const existing = await db.events
              .where('[googleCalendarId+googleEventId]')
              .equals([result.master.googleCalendarId, result.master.googleEventId])
              .first()
            await db.events.put({ ...result.master, uuid: existing?.uuid })
            const currentSegment = await db.recurrenceSegments
              .where('[googleCalendarId+masterEventId]')
              .equals([result.master.googleCalendarId, result.master.googleEventId])
              .first()
            await upsertRecurrenceSegment({
              googleCalendarId: result.master.googleCalendarId,
              masterEventId: result.master.googleEventId,
              lineageRootId: currentSegment?.lineageRootId ?? context?.lineageRootId ?? result.master.googleEventId,
              segmentStart: getDateTimeValue(result.master.start),
            })
          }
          for (const exc of result.updated_exceptions) {
            if (exc.googleEventId) {
              const existing = await db.events
                .where('[googleCalendarId+googleEventId]')
                .equals([exc.googleCalendarId, exc.googleEventId])
                .first()
              await db.events.put({ ...exc, uuid: existing?.uuid })
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
        }

        if (plan.command === 'all-delete') {
          // Master + exceptions already deleted by backend, clean Dexie
          const masterInDexie = await db.events
            .where('[googleCalendarId+googleEventId]')
            .equals([plan.calendarId, plan.masterId])
            .first()
          if (masterInDexie) await db.events.delete(masterInDexie.uuid!)
          const excsInDexie = await db.events.where('recurringEventId').equals(plan.masterId).toArray()
          for (const exc of excsInDexie) {
            await db.events.delete(exc.uuid!)
          }
          const segment = await db.recurrenceSegments
            .where('[googleCalendarId+masterEventId]')
            .equals([plan.calendarId, plan.masterId])
            .first()
          if (segment?.id) {
            await db.recurrenceSegments.delete(segment.id)
          }
        }

        const temps = await db.events
          .filter((e) => e.googleEventId?.startsWith('temp-') ?? false)
          .toArray()
        console.log('[recurring] cleaning up', temps.length, 'temp events')
        for (const t of temps) {
          await db.events.delete(t.uuid!)
        }
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}
