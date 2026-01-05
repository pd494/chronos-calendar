import { create } from 'zustand'
import { addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from 'date-fns'
import type { CalendarView } from '../types'

interface CalendarState {
  // Current view state
  view: CalendarView
  currentDate: Date

  // Selected event for modal
  selectedEventId: string | null

  // Sidebar state
  sidebarOpen: boolean
  sidebarWidth: number

  // Settings modal
  showSettings: boolean

  // Actions
  setView: (view: CalendarView) => void
  setCurrentDate: (date: Date) => void
  selectEvent: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setShowSettings: (show: boolean) => void

  // Navigation
  navigateToToday: () => void
  navigatePrevious: () => void
  navigateNext: () => void
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  view: 'month',
  currentDate: new Date(),
  selectedEventId: null,
  sidebarOpen: true,
  sidebarWidth: 320,
  showSettings: false,

  setView: (view) => set({ view }),
  setCurrentDate: (date) => set({ currentDate: date }),
  selectEvent: (id) => set({ selectedEventId: id }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setShowSettings: (show) => set({ showSettings: show }),

  navigateToToday: () => set({ currentDate: new Date() }),

  navigatePrevious: () => {
    const { view, currentDate } = get()
    const newDate =
      view === 'month'
        ? subMonths(currentDate, 1)
        : view === 'week'
          ? subWeeks(currentDate, 1)
          : subDays(currentDate, 1)
    set({ currentDate: newDate })
  },

  navigateNext: () => {
    const { view, currentDate } = get()
    const newDate =
      view === 'month'
        ? addMonths(currentDate, 1)
        : view === 'week'
          ? addWeeks(currentDate, 1)
          : addDays(currentDate, 1)
    set({ currentDate: newDate })
  },
}))
