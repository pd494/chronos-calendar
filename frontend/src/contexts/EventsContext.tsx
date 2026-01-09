import { createContext, useContext, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCalendarStore, useCalendarsStore } from '../stores'
import { useGoogleEvents } from '../hooks'
import { useGoogleCalendars, useGoogleAccounts } from '../hooks/useGoogleCalendars'
import { googleApi } from '../api/google'
import { googleKeys } from '../lib'
import type { CalendarEvent } from '../types'

interface EventsContextValue {
  events: CalendarEvent[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
}

interface EventsProviderProps {
  children: ReactNode
}

const EventsContext = createContext<EventsContextValue | undefined>(undefined)

export function EventsProvider({ children }: EventsProviderProps) {
  const queryClient = useQueryClient()
  const { currentDate } = useCalendarStore()
  const { getVisibleCalendarIds, initializeCalendars, removeStaleCalendars } = useCalendarsStore()
  const { data: accounts } = useGoogleAccounts()
  const { data: calendars } = useGoogleCalendars()
  const calendarsRefreshed = useRef(false)

  useEffect(() => {
    if (calendars?.length) {
      const calendarIds = calendars.map((c) => c.id)
      initializeCalendars(calendarIds)
      removeStaleCalendars(calendarIds)
    }
  }, [calendars, initializeCalendars, removeStaleCalendars])

  useEffect(() => {
    if (calendarsRefreshed.current) return
    if (!accounts?.length || calendars?.length) return

    calendarsRefreshed.current = true
    const refreshAll = async () => {
      for (const account of accounts) {
        await googleApi.refreshCalendars(account.id)
      }
      queryClient.invalidateQueries({ queryKey: googleKeys.calendars() })
    }
    refreshAll()
  }, [accounts, calendars, queryClient])

  const visibleCalendarIds = useMemo(() => {
    if (!calendars?.length) return []
    const calendarIdSet = new Set(calendars.map((c) => c.id))
    const visible = getVisibleCalendarIds().filter((id) => calendarIdSet.has(id))
    if (visible.length === 0) {
      return calendars.map((c) => c.id)
    }
    return visible
  }, [getVisibleCalendarIds, calendars])

  const { events, isLoading, isFetching, error } = useGoogleEvents(currentDate, visibleCalendarIds)

  const value = useMemo(
    () => ({ events, isLoading, isFetching, error: error as Error | null }),
    [events, isLoading, isFetching, error]
  )

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
}

export function useEventsContext() {
  const context = useContext(EventsContext)
  if (context === undefined) {
    throw new Error('useEventsContext must be used within EventsProvider')
  }
  return context
}
