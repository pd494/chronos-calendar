import type { RecurrenceRequestBody } from '../../api/events'
import type { CalendarEvent, DisplayOccurrence, RecurrenceEditScope } from '../../types'

type CommandKind =
  | 'instance-edit'
  | 'instance-delete'
  | 'event-edit'
  | 'event-delete'
  | 'all-edit'
  | 'all-delete'
  | 'following-edit'
  | 'following-delete'

export interface MutationPlan {
  command: CommandKind
  calendarId: string
  masterId: string
  eventId: string | undefined
  endpoint: string
  payload: RecurrenceRequestBody | Partial<CalendarEvent>
}

interface MutationOptions {
  downstreamMasterIds?: string[]
  lineageRootId?: string
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
        return {
          command: action === 'edit' ? 'event-edit' : 'event-delete',
          calendarId,
          masterId,
          eventId,
          endpoint: `/calendar/${calendarId}/events/${eventId}`,
          payload: action === 'edit' ? patch : {},
        }
      }

      const instanceStart = assertDefined(
        event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date,
        'Virtual recurrence mutation requires an instance start',
      )

      return {
        command: action === 'edit' ? 'instance-edit' : 'instance-delete',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/this-event`,
        payload:
          action === 'edit'
            ? { scope, instance_start: instanceStart, action, patch }
            : { scope, instance_start: instanceStart, action },
      }
    }

    case 'all':
      return {
        command: action === 'edit' ? 'all-edit' : 'all-delete',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/all`,
        payload: action === 'edit' ? { scope, action, patch } : { scope, action },
      }

    case 'following': {
      const splitPoint = assertDefined(
        event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date,
        'Following recurrence mutation requires a split point',
      )

      return {
        command: action === 'edit' ? 'following-edit' : 'following-delete',
        calendarId,
        masterId,
        eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/following`,
        payload:
          action === 'edit'
            ? {
                scope,
                split_point: splitPoint,
                action,
                patch,
                downstream_master_ids: options?.downstreamMasterIds ?? [],
                lineage_root_id: options?.lineageRootId,
              }
            : {
                scope,
                split_point: splitPoint,
                action,
                downstream_master_ids: options?.downstreamMasterIds ?? [],
                lineage_root_id: options?.lineageRootId,
              },
      }
    }
  }
}
