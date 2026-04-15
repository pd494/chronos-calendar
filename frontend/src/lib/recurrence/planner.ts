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
  payload: object
}

interface MutationOptions {
  downstreamMasterIds?: string[]
  lineageRootId?: string
}

export function planRecurringMutation(
  event: DisplayOccurrence,
  action: 'edit' | 'delete',
  scope: RecurrenceEditScope,
  patch: Partial<CalendarEvent>,
  options?: MutationOptions,
): MutationPlan {
  
  const calendarId = event.googleCalendarId
  const masterId = event.seriesMasterId ?? event.recurringEventId ?? event.googleEventId ?? ''
  const payload = action === 'delete' ? {} : patch

  if (scope === 'this') {
    
    if (event.entityKind === 'virtual') {
      const instanceStart =  event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date

      return {
        command: action === 'edit' ? 'instance-edit' : 'instance-delete',
        calendarId, masterId, eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/this-event`,
        payload: {
          instance_start: instanceStart,
          action,
          patch,
        },
      }
    }

    else {
      return {
        command: action === 'edit' ? 'event-edit' : 'event-delete',
        calendarId, masterId, eventId: event.googleEventId,
        endpoint: `/calendar/${calendarId}/events/${event.googleEventId}`,
        payload,
      }
   }
  }

  else if (scope === 'all') {
    return {
      command: action === 'edit' ? 'all-edit' : 'all-delete',
      calendarId, masterId, eventId: event.googleEventId,
      endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/all`,
      payload: { action, patch: action === 'edit' ? patch : undefined },
    }
  }
  else {
    const splitPoint = event.instanceOriginalStart?.dateTime ?? event.instanceOriginalStart?.date ?? ''
    return {
      command: action === 'edit' ? 'following-edit' : 'following-delete',
      calendarId, masterId, eventId: event.googleEventId,
      endpoint: `/calendar/${calendarId}/events/recurrence/${masterId}/following`,
      payload: {
        split_point: splitPoint,
        action,
        patch: action === 'edit' ? patch : undefined,
        downstream_master_ids: options?.downstreamMasterIds ?? [],
        lineage_root_id: options?.lineageRootId,
      },
    }
  }
}
