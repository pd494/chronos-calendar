import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { googleApi } from '../api'
import { googleKeys } from '../lib/queryKeys'
import type { GoogleCalendar } from '../types'

interface CalendarGroup {
  account: { id: string; email: string; name: string; needs_reauth: boolean }
  calendars: GoogleCalendar[]
}

export function useGoogleAccounts() {
  return useQuery({
    queryKey: googleKeys.accounts(),
    queryFn: () => googleApi.getAccounts().then((r) => r.accounts),
    staleTime: 5 * 60 * 1000,
  })
}

export function useGoogleCalendars() {
  return useQuery({
    queryKey: googleKeys.calendars(),
    queryFn: () => googleApi.getCalendars().then((r) => r.calendars),
    staleTime: 5 * 60 * 1000,
  })
}

export function useGroupedCalendars(calendars: GoogleCalendar[] | undefined) {
  return useMemo(() => {
    if (!calendars) return {}

    return calendars.reduce<Record<string, CalendarGroup>>((acc, cal) => {
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
    }, {})
  }, [calendars])
}
