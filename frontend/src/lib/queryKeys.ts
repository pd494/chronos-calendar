export const googleKeys = {
  all: ['google'] as const,
  accounts: () => [...googleKeys.all, 'accounts'] as const,
  calendars: () => [...googleKeys.all, 'calendars'] as const,
  syncStatus: (calendarId?: string) =>
    calendarId
      ? ([...googleKeys.all, 'sync-status', calendarId] as const)
      : ([...googleKeys.all, 'sync-status'] as const),
}
