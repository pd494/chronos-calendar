import { api } from './client'
import type { CalendarEvent } from '../types'

export interface EventsQueryParams {
  calendarId?: string
  timeMin?: string
  timeMax?: string
}

export const eventsApi = {
  list: (params: EventsQueryParams) =>
    api.get<CalendarEvent[]>('/events', params as Record<string, string>),

  get: (calendarId: string, eventId: string) =>
    api.get<CalendarEvent>(`/calendars/${calendarId}/events/${eventId}`),

  create: (calendarId: string, event: Partial<CalendarEvent>) =>
    api.post<CalendarEvent>(`/calendars/${calendarId}/events`, event),

  update: (calendarId: string, eventId: string, event: Partial<CalendarEvent>) =>
    api.put<CalendarEvent>(`/calendars/${calendarId}/events/${eventId}`, event),

  delete: (calendarId: string, eventId: string) =>
    api.delete<void>(`/calendars/${calendarId}/events/${eventId}`),
}
