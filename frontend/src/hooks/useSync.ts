import { useMutation, useQueryClient } from '@tanstack/react-query'
import { googleApi } from '../api/google'
import { useSyncStore } from '../stores'
import { eventKeys } from '../lib'

export function useSync() {
  const queryClient = useQueryClient()
  const { startSync, completeSync, setError, clearError } = useSyncStore()

  const syncCalendar = useMutation({
    mutationFn: async (calendarId: string) => {
      startSync([calendarId])
      clearError()
      return googleApi.syncCalendar(calendarId)
    },
    onSuccess: () => {
      completeSync()
      queryClient.invalidateQueries({ queryKey: eventKeys.all })
    },
    onError: (error: Error) => {
      setError(error.message)
    },
  })

  const fetchRange = useMutation({
    mutationFn: async ({
      calendarId,
      startDate,
      endDate,
    }: {
      calendarId: string
      startDate: string
      endDate: string
    }) => googleApi.fetchRange(calendarId, startDate, endDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.all })
    },
  })

  return {
    syncCalendar: syncCalendar.mutate,
    fetchRange: fetchRange.mutate,
    isSyncing: syncCalendar.isPending,
  }
}
