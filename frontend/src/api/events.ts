import { api } from "./client";
import type { CalendarEvent, EventCompletion } from "../types";

export type RecurrenceRequestBody =
  | {
      scope: "this";
      action: "delete";
      instance_start: string;
    }
  | {
      scope: "this";
      action: "edit";
      instance_start: string;
      patch: Partial<CalendarEvent>;
    }
  | {
      scope: "all";
      action: "delete";
    }
  | {
      scope: "all";
      action: "edit";
      patch: Partial<CalendarEvent>;
    }
  | {
      scope: "following";
      action: "delete";
      split_point: string;
      downstream_master_ids?: string[];
    }
  | {
      scope: "following";
      action: "edit";
      split_point: string;
      patch: Partial<CalendarEvent>;
      downstream_master_ids?: string[];
    };

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

function recurrencePayload<T extends RecurrenceRequestBody>(body: T): Omit<T, "scope"> {
  const payload = { ...body } as Omit<T, "scope"> & { scope?: T["scope"] };
  delete payload.scope;
  return payload;
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

  thisEvent: (calendarId: string, masterId: string, body: Extract<RecurrenceRequestBody, { scope: "this" }>) => {
    return api.post<CalendarEvent>(`/calendar/${calendarId}/events/recurrence/${masterId}/this-event`, recurrencePayload(body));
  },

  all: (calendarId: string, masterId: string, body: Extract<RecurrenceRequestBody, { scope: "all" }>) => {
    return api.post<AllResult>(`/calendar/${calendarId}/events/recurrence/${masterId}/all`, recurrencePayload(body));
  },

  following: (calendarId: string, masterId: string, body: Extract<RecurrenceRequestBody, { scope: "following" }>) => {
    return api.post<FollowingResult>(`/calendar/${calendarId}/events/recurrence/${masterId}/following`, recurrencePayload(body));
  },

  toggleCompletion: (completion: EventCompletion & { completed: boolean }) =>
    api.post<{ completed: boolean }>("/calendar/complete-event", completion),
};
