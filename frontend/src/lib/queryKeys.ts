import type { EventsQueryParams } from '../api/events'

export const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  list: (params: EventsQueryParams | { start: string; end: string; calendarIds?: string }) =>
    [...eventKeys.lists(), params] as const,
  details: () => [...eventKeys.all, 'detail'] as const,
  detail: (calendarId: string, id: string) => [...eventKeys.details(), calendarId, id] as const,
  byMonth: (year: number, month: number, calendarIds?: string[]) =>
    [...eventKeys.all, 'month', year, month, calendarIds?.sort().join(',') ?? 'all'] as const,
}

export const googleKeys = {
  all: ['google'] as const,
  accounts: () => [...googleKeys.all, 'accounts'] as const,
  calendars: () => [...googleKeys.all, 'calendars'] as const,
  syncStatus: (calendarId?: string) =>
    calendarId
      ? ([...googleKeys.all, 'sync-status', calendarId] as const)
      : ([...googleKeys.all, 'sync-status'] as const),
}

export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (listId?: string) => [...todoKeys.lists(), listId] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: string) => [...todoKeys.details(), id] as const,
}

export const listKeys = {
  all: ['todoLists'] as const,
}
