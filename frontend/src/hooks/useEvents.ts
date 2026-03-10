import { useMutation, useQueryClient } from '@tanstack/react-query'
import { eventsApi } from '../api/events'
import type { CalendarEvent } from '../types'
import { eventKeys } from '../lib'

export function useCreateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ calendarId, event }: { calendarId: string; event: Partial<CalendarEvent> }) =>
      eventsApi.create(calendarId, event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      calendarId,
      eventId,
      event,
    }: {
      calendarId: string
      eventId: string
      event: Partial<CalendarEvent>
    }) => eventsApi.update(calendarId, eventId, event),
    onSuccess: (_, { calendarId, eventId }) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(calendarId, eventId) })
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ calendarId, eventId }: { calendarId: string; eventId: string }) =>
      eventsApi.delete(calendarId, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}
