import { api } from "./client";
import type { CalendarEvent, EventCompletion } from "../types";

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

  toggleCompletion: (completion: EventCompletion & { completed: boolean }) =>
    api.post<{ completed: boolean }>("/calendar/complete-event", completion),
};
