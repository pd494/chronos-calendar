import { create } from 'zustand'

type SyncStatus = 'idle' | 'syncing' | 'error'

interface SyncState {
  status: SyncStatus
  error: string | null
  syncingCalendarIds: string[]

  startSync: (calendarIds?: string[]) => void
  completeSync: () => void
  setError: (error: string) => void
  clearError: () => void
  isSyncing: (calendarId?: string) => boolean
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  status: 'idle',
  error: null,
  syncingCalendarIds: [],

  startSync: (calendarIds) =>
    set((state) => ({
      status: 'syncing',
      error: null,
      syncingCalendarIds: calendarIds
        ? [...new Set([...state.syncingCalendarIds, ...calendarIds])]
        : state.syncingCalendarIds,
    })),

  completeSync: () =>
    set({
      status: 'idle',
      syncingCalendarIds: [],
    }),

  setError: (error) =>
    set({
      status: 'error',
      error,
      syncingCalendarIds: [],
    }),

  clearError: () =>
    set({
      status: 'idle',
      error: null,
    }),

  isSyncing: (calendarId) => {
    const { status, syncingCalendarIds } = get()
    if (calendarId) {
      return syncingCalendarIds.includes(calendarId)
    }
    return status === 'syncing'
  },
}))
