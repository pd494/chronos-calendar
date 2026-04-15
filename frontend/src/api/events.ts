import { api } from "./client";
import type { CalendarEvent, EventCompletion } from "../types";

export interface FollowingResult {
  truncated_master: CalendarEvent
  new_master?: CalendarEvent | null
  migrated_exceptions: CalendarEvent[]
  deleted_exception_ids: string[]
}

export interface AllResult {
  master: CalendarEvent
  updated_exceptions: CalendarEvent[]
  deleted_exception_ids: string[]
}

export const eventsApi = {
  create: (calendarId: string, event: Partial<CalendarEvent>) =>
    api.post<CalendarEvent>(`/calendar/${calendarId}/events`, event),

  update: (
    calendarId: string,
    eventId: string,
    event: Partial<CalendarEvent>,
  ) =>
    api.patch<CalendarEvent>(
      `/calendar/${calendarId}/events/${eventId}`,
      event,
    ),

  delete: (calendarId: string, eventId: string) =>
    api.delete<void>(`/calendar/${calendarId}/events/${eventId}`),

  thisEvent: (calendarId: string, masterId: string, body: { instance_start: string, action: 'edit' | 'delete', patch?: Partial<CalendarEvent> }) =>
    api.post<CalendarEvent>(`/calendar/${calendarId}/events/recurrence/${masterId}/this-event`, body),

  all: (calendarId: string, masterId: string, body: { action: 'edit' | 'delete', patch?: Partial<CalendarEvent> }) =>
    api.post<AllResult>(`/calendar/${calendarId}/events/recurrence/${masterId}/all`, body),

  following: (
    calendarId: string,
    masterId: string,
    body: {
      split_point: string
      action: 'edit' | 'delete'
      patch?: Partial<CalendarEvent>
      downstream_master_ids?: string[]
      lineage_root_id?: string
    },
  ) =>
    api.post<FollowingResult>(`/calendar/${calendarId}/events/recurrence/${masterId}/following`, body),

  toggleCompletion: (completion: EventCompletion & { completed: boolean }) =>
    api.post<{ completed: boolean }>("/calendar/complete-event", completion),
};
