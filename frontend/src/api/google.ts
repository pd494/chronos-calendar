import { api } from './client'
import type { GoogleAccount, GoogleCalendar } from '../types'

interface SyncStatusResponse {
  lastSyncAt: string | null
}

export const googleApi = {
  getAccounts: () =>
    api.get<{ accounts: GoogleAccount[] }>('/calendar/accounts'),

  getCalendars: () =>
    api.get<{ calendars: GoogleCalendar[] }>('/calendar/calendars'),

  refreshCalendars: (googleAccountId: string) =>
    api.post<{ calendars: GoogleCalendar[] }>(
      `/calendar/accounts/${googleAccountId}/refresh-calendars`
    ),

  getSyncStatus: (calendarIds?: string[]) => {
    const params = calendarIds?.length ? { calendar_ids: calendarIds.join(',') } : undefined
    return api.get<SyncStatusResponse>('/calendar/sync-status', params)
  },
}
