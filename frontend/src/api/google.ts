import { api, ApiError } from './client'
import type { GoogleAccount, GoogleCalendar, CalendarEvent } from '../types'
export { ApiError }

export function isSyncTokenExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 410
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && error.message === 'Failed to fetch'
}

export function isRetryableError(error: unknown): boolean {
  if (isNetworkError(error) || isRateLimited(error)) return true
  if (error instanceof ApiError && error.status >= 500) return true
  return false
}

export interface EventsResponse {
  events: CalendarEvent[]
  masters: CalendarEvent[]
  exceptions: CalendarEvent[]
}

export interface SyncStatusResponse {
  lastSyncAt: string | null
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
}
