import { api } from './client'
import type { CalendarEvent } from '../types'

export const eventsApi = {
  create: (calendarId: string, event: Partial<CalendarEvent>) =>
    api.post<CalendarEvent>(`/calendars/${calendarId}/events`, event),

  update: (calendarId: string, eventId: string, event: Partial<CalendarEvent>) =>
    api.put<CalendarEvent>(`/calendars/${calendarId}/events/${eventId}`, event),

  delete: (calendarId: string, eventId: string) =>
    api.delete<void>(`/calendars/${calendarId}/events/${eventId}`),
}
