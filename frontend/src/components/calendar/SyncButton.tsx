import { RefreshCw } from 'lucide-react'
import { useEventsContext } from '../../contexts/EventsContext'

export function SyncButton() {
  const { isSyncing, sync } = useEventsContext()

  const handleSync = async () => {
    if (isSyncing) return
    try {
      await sync()
    } catch {
      // Error is already handled in the context
    }
  }

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
