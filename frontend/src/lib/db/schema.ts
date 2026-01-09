import type { CalendarEvent } from '../../types'

export const DB_NAME = 'chronos-calendar'
export const DB_VERSION = 1

export interface FetchStatus {
  key: string
  status: 'fetched' | 'fetching' | 'error'
  lastFetched: string
  errorCount?: number
  lastError?: string
  retryAfter?: string
}

export interface SyncTokenData {
  calendarId: string
  token: string
  lastSync: string
}

export interface CachedEvent extends CalendarEvent {
  startMonth: string
}

export const STORES = {
  EVENTS: 'events',
  FETCH_REGISTRY: 'fetchRegistry',
  SYNC_TOKENS: 'syncTokens',
  META: 'meta',
} as const

export function createCacheKey(calendarId: string, month: string): string {
  return `${calendarId}:${month}`
}

export function parseCacheKey(key: string): { calendarId: string; month: string } {
  const [calendarId, month] = key.split(':')
  return { calendarId, month }
}

export function getMonthFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthFromEvent(event: CalendarEvent): string {
  const startDate = event.start.dateTime
    ? new Date(event.start.dateTime)
    : new Date(event.start.date + 'T00:00:00')
  return getMonthFromDate(startDate)
}
