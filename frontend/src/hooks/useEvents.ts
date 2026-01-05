import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { eventsApi, EventsQueryParams } from '../api/events'
import type { CalendarEvent } from '../types'

export const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  list: (params: EventsQueryParams) => [...eventKeys.lists(), params] as const,
  details: () => [...eventKeys.all, 'detail'] as const,
  detail: (calendarId: string, id: string) => [...eventKeys.details(), calendarId, id] as const,
}

export function useEvents(params: EventsQueryParams) {
  return useQuery({
    queryKey: eventKeys.list(params),
    queryFn: () => eventsApi.list(params),
  })
}

export function useEvent(calendarId: string, eventId: string) {
  return useQuery({
    queryKey: eventKeys.detail(calendarId, eventId),
    queryFn: () => eventsApi.get(calendarId, eventId),
    enabled: !!calendarId && !!eventId,
  })
}

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
