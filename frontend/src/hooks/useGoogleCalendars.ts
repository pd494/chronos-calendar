import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { googleApi, GoogleCalendar } from '../api'
import { googleKeys } from '../lib'

export function useGoogleAccounts() {
  return useQuery({
    queryKey: googleKeys.accounts(),
    queryFn: async () => {
      const response = await googleApi.getAccounts()
      return response.accounts
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useGoogleCalendars() {
  return useQuery({
    queryKey: googleKeys.calendars(),
    queryFn: async () => {
      const response = await googleApi.getCalendars()
      return response.calendars
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useCalendarSyncStatus(calendarId: string) {
  return useQuery({
    queryKey: googleKeys.syncStatus(calendarId),
    queryFn: () => googleApi.getCalendarStatus(calendarId),
    enabled: !!calendarId,
    staleTime: 60 * 1000,
  })
}

export function useSyncCalendar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ calendarId, forceFull = false }: { calendarId: string; forceFull?: boolean }) =>
      googleApi.syncCalendar(calendarId, forceFull),
    onSuccess: (_, { calendarId }) => {
      queryClient.invalidateQueries({ queryKey: googleKeys.syncStatus(calendarId) })
    },
  })
}

export function useSyncAllCalendars() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      googleAccountId,
      forceFull = false,
    }: {
      googleAccountId: string
      forceFull?: boolean
    }) => googleApi.syncAllCalendars(googleAccountId, forceFull),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: googleKeys.all })
    },
  })
}

export function useGroupedCalendars(calendars: GoogleCalendar[] | undefined) {
  return useMemo(() => {
    if (!calendars) return {}

    return calendars.reduce(
      (acc, cal) => {
        const key = cal.google_account_id
        if (!acc[key]) {
          acc[key] = {
            account: {
              id: cal.google_account_id,
              email: cal.account_email,
              name: cal.account_name,
              needs_reauth: cal.needs_reauth,
            },
            calendars: [],
          }
        }
        acc[key].calendars.push(cal)
        return acc
      },
      {} as Record<
        string,
        {
          account: { id: string; email: string; name: string; needs_reauth: boolean }
          calendars: GoogleCalendar[]
        }
      >
    )
  }, [calendars])
}
