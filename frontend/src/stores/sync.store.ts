import { create } from 'zustand'

type SyncStatus = 'idle' | 'syncing' | 'error'

interface SyncState {
  status: SyncStatus
  error: string | null
  syncingCalendarIds: string[]
  shouldStop: boolean

  startSync: (calendarIds?: string[]) => void
  completeSync: () => void
  stopSync: () => void
  setError: (error: string) => void
  clearError: () => void
  isSyncing: (calendarId?: string) => boolean
  resetStopFlag: () => void
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  status: 'idle',
  error: null,
  syncingCalendarIds: [],
  shouldStop: false,

  startSync: (calendarIds) =>
    set((state) => ({
      status: 'syncing',
      error: null,
      shouldStop: false,
      syncingCalendarIds: calendarIds
        ? [...new Set([...state.syncingCalendarIds, ...calendarIds])]
        : state.syncingCalendarIds,
    })),

  completeSync: () =>
    set({
      status: 'idle',
      syncingCalendarIds: [],
    }),

  stopSync: () =>
    set({
      status: 'idle',
      shouldStop: true,
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

  resetStopFlag: () => set({ shouldStop: false }),
}))
