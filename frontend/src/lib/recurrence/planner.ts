import type { RecurrenceRequestBody } from '../../api/events'
import type { CalendarEvent, DisplayOccurrence, RecurrenceEditScope } from '../../types'

type ThisPayload = Extract<RecurrenceRequestBody, { scope: 'this' }>
type AllPayload = Extract<RecurrenceRequestBody, { scope: 'all' }>
type FollowingPayload = Extract<RecurrenceRequestBody, { scope: 'following' }>

interface BasePlan {
  calendarId: string
  masterId: string
  endpoint: string
}

export type MutationPlan =
  | (BasePlan & { command: 'instance-edit'; eventId: string | undefined; payload: Extract<ThisPayload, { action: 'edit' }> })
  | (BasePlan & { command: 'instance-delete'; eventId: string | undefined; payload: Extract<ThisPayload, { action: 'delete' }> })
  | (BasePlan & { command: 'event-edit'; eventId: string; payload: Partial<CalendarEvent> })
  | (BasePlan & { command: 'event-delete'; eventId: string; payload: Record<string, never> })
  | (BasePlan & { command: 'all-edit'; eventId: string | undefined; payload: Extract<AllPayload, { action: 'edit' }> })
  | (BasePlan & { command: 'all-delete'; eventId: string | undefined; payload: Extract<AllPayload, { action: 'delete' }> })
  | (BasePlan & { command: 'following-edit'; eventId: string | undefined; payload: Extract<FollowingPayload, { action: 'edit' }> })
  | (BasePlan & { command: 'following-delete'; eventId: string | undefined; payload: Extract<FollowingPayload, { action: 'delete' }> })

interface MutationOptions {
  downstreamMasterIds?: string[]
}

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

export function planRecurringMutation(
  event: DisplayOccurrence,
  action: 'edit' | 'delete',
  scope: RecurrenceEditScope,
  patch: Partial<CalendarEvent>,
  options?: MutationOptions,
): MutationPlan {
  const calendarId = event.googleCalendarId
  const masterId = assertDefined(
    event.seriesMasterId ?? event.recurringEventId ?? event.googleEventId,
    'Recurring mutation requires a master id',
  )

  switch (scope) {
    case 'this': {
      if (event.entityKind !== 'virtual') {
        const eventId = assertDefined(event.googleEventId, 'This event mutation requires an event id')
        if (action === 'delete') {
          return {
            command: 'event-delete',
            calendarId,
            masterId,
            eventId,
            endpoint: `/calendar/${calendarId}/events/${eventId}`,
            payload: {},
          }
        }

        return {
          command: 'event-edit',
          calendarId,
          masterId,
          eventId,
          endpoint: `/calendar/${calendarId}/events/${eventId}`,
          payload: patch,
        }
      }

      const instanceStart = assertDefined(
        event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date,
        'Virtual recurrence mutation requires an instance start',
      )
      if (action === 'delete') {
        return {
          command: 'instance-delete',
          calendarId,
          masterId,
          eventId: event.googleEventId,
          endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/this-event`,
          payload: { scope, instance_start: instanceStart, action },
        }
      }

      return {
        command: 'instance-edit',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/this-event`,
        payload: { scope, instance_start: instanceStart, action, patch },
      }
    }

    case 'all':
      if (action === 'delete') {
        return {
          command: 'all-delete',
          calendarId,
          masterId,
          eventId: event.googleEventId,
          endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/all`,
          payload: { scope, action },
        }
      }

      return {
        command: 'all-edit',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/all`,
        payload: { scope, action, patch },
      }

    case 'following': {
      const splitPoint = assertDefined(
        event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date,
        'Following recurrence mutation requires a split point',
      )
      if (action === 'delete') {
        return {
          command: 'following-delete',
          calendarId,
          masterId,
          eventId: event.googleEventId,
          endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/following`,
          payload: {
            scope,
            split_point: splitPoint,
            action,
            downstream_master_ids: options?.downstreamMasterIds ?? [],
          },
        }
      }

      return {
        command: 'following-edit',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/following`,
        payload: {
          scope,
          split_point: splitPoint,
          action,
          patch,
          downstream_master_ids: options?.downstreamMasterIds ?? [],
        },
      }
    }
  }
}
