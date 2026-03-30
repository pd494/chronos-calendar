import { api } from './client'
import type { GoogleAccount, GoogleCalendar, CalendarEvent, EventCompletion } from '../types'

interface EventsResponse {
  events: CalendarEvent[]
  masters: CalendarEvent[]
  exceptions: CalendarEvent[]
  completions: EventCompletion[]
}

interface SyncStatusResponse {
  lastSyncAt: string | null
}

export interface Contact {
  email: string
  displayName: string | null
  photoUrl?: string | null
}

export const googleApi = {
  getAccounts: () =>
    api.get<{ accounts: GoogleAccount[] }>('/calendar/accounts'),

  getCalendars: () =>
    api.get<{ calendars: GoogleCalendar[] }>('/calendar/calendars'),

  getEvents: (calendarIds?: string[]) => {
    const params = calendarIds?.length ? { calendar_ids: calendarIds.join(',') } : undefined
    return api.get<EventsResponse>('/calendar/events', params)
  },

  refreshCalendars: (googleAccountId: string) =>
    api.post<{ calendars: GoogleCalendar[] }>(
      `/calendar/accounts/${googleAccountId}/refresh-calendars`
    ),

  getSyncStatus: (calendarIds?: string[]) => {
    const params = calendarIds?.length ? { calendar_ids: calendarIds.join(',') } : undefined
    return api.get<SyncStatusResponse>('/calendar/sync-status', params)
  },

  getContactDirectory: () =>
    api.get<{ contacts: Contact[] }>('/calendar/contacts/directory'),

  searchWorkspace: (query: string) =>
    api.get<{ contacts: Contact[] }>('/calendar/contacts/workspace', { q: query }),

  getGroupMembers: (groupEmail: string) =>
    api.get<{ members: { email: string; role: string }[] }>('/calendar/contacts/group-members', { group_email: groupEmail }),
}
