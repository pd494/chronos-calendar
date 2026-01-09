import { api } from './client'
import type { GoogleAccount, GoogleCalendar, SyncStatus, SyncResult } from '../types'

export type { GoogleAccount, GoogleCalendar, SyncStatus, SyncResult }

export const googleApi = {
  getAccounts: () =>
    api.get<{ accounts: GoogleAccount[] }>('/google/accounts'),

  getCalendars: () =>
    api.get<{ calendars: GoogleCalendar[] }>('/google/calendars'),

  getCalendarStatus: (calendarId: string) =>
    api.get<SyncStatus>(`/google/calendars/${calendarId}/status`),

  syncCalendar: (calendarId: string, forceFull = false) =>
    api.post<SyncResult>(
      `/google/calendars/${calendarId}/sync`,
      undefined,
      forceFull ? { force_full: 'true' } : undefined
    ),

  syncAllCalendars: (googleAccountId: string, forceFull = false) =>
    api.post<{ calendars: (SyncResult & { calendar_id: string })[] }>(
      `/google/accounts/${googleAccountId}/sync-all`,
      undefined,
      forceFull ? { force_full: 'true' } : undefined
    ),

  fetchRange: (calendarId: string, timeMin: string, timeMax: string) =>
    api.post<SyncResult>(`/google/calendars/${calendarId}/fetch-range`, {
      time_min: timeMin,
      time_max: timeMax,
    }),

  batchFetchRange: (calendarIds: string[], timeMin: string, timeMax: string) =>
    api.post<{ results: Record<string, SyncResult> }>('/google/batch-fetch-range', {
      calendar_ids: calendarIds,
      time_min: timeMin,
      time_max: timeMax,
    }),

  refreshCalendars: (googleAccountId: string) =>
    api.post<{ calendars: GoogleCalendar[] }>(
      `/google/accounts/${googleAccountId}/refresh-calendars`
    ),

  getSyncedMonths: () =>
    api.get<{ synced_months: Record<string, string[]> }>('/google/synced-months'),
}
