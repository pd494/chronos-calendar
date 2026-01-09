import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncStore, useCalendarsStore } from '../../stores'
import { useGoogleCalendars, useSyncCalendar, googleKeys } from '../../hooks'
import { eventKeys } from '../../lib'

export function SyncButton() {
  const queryClient = useQueryClient()
  const { data: calendars } = useGoogleCalendars()
  const { status, startSync, completeSync, setError } = useSyncStore()
  const { getVisibleCalendarIds } = useCalendarsStore()
  const syncMutation = useSyncCalendar()

  const handleSync = async () => {
    if (status === 'syncing' || !calendars?.length) return

    const visibleIds = getVisibleCalendarIds()
    const calendarsToSync = calendars.filter((c) =>
      visibleIds.length ? visibleIds.includes(c.id) : true
    )

    if (!calendarsToSync.length) return

    startSync(calendarsToSync.map((c) => c.id))

    try {
      await Promise.all(
        calendarsToSync.map((cal) =>
          syncMutation.mutateAsync({ calendarId: cal.id })
        )
      )
      completeSync()
      queryClient.invalidateQueries({ queryKey: eventKeys.all })
      queryClient.invalidateQueries({ queryKey: googleKeys.all })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    }
  }

  const isSyncing = status === 'syncing'

  return (
    <button
      onClick={handleSync}
      disabled={isSyncing}
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded transition-colors disabled:opacity-50"
      title="Sync calendars"
    >
      <RefreshCw
        size={14}
        className={isSyncing ? 'animate-spin' : ''}
      />
      <span className="hidden sm:inline">
        {isSyncing ? 'Syncing...' : 'Sync'}
      </span>
    </button>
  )
}
