import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CalendarVisibility {
  visible: boolean
}

interface CalendarsState {
  visibility: Record<string, CalendarVisibility>

  isVisible: (calendarId: string) => boolean
  toggleVisibility: (calendarId: string) => void
  getVisibleCalendarIds: () => string[]
  initializeCalendars: (calendarIds: string[]) => void
  removeStaleCalendars: (validCalendarIds: string[]) => void
}

export const useCalendarsStore = create<CalendarsState>()(
  persist(
    (set, get) => {
      function updateEntry(
        state: CalendarsState,
        calendarId: string,
        patch: Partial<CalendarVisibility>
      ): Pick<CalendarsState, 'visibility'> {
        return {
          visibility: {
            ...state.visibility,
            [calendarId]: { ...state.visibility[calendarId], ...patch },
          },
        }
      }

      return {
        visibility: {},

        isVisible: (calendarId) => {
          const entry = get().visibility[calendarId]
          return entry?.visible ?? true
        },

        toggleVisibility: (calendarId) =>
          set((state) =>
            updateEntry(state, calendarId, {
              visible: !(state.visibility[calendarId]?.visible ?? true),
            })
          ),

        getVisibleCalendarIds: () => {
          const { visibility } = get()
          return Object.entries(visibility)
            .filter(([, v]) => v.visible)
            .map(([id]) => id)
        },

        initializeCalendars: (calendarIds) =>
          set((state) => {
            const newVisibility = { ...state.visibility }
            for (const id of calendarIds) {
              if (!(id in newVisibility)) {
                newVisibility[id] = { visible: true }
              }
            }
            return { visibility: newVisibility }
          }),

        removeStaleCalendars: (validCalendarIds) =>
          set((state) => {
            const validSet = new Set(validCalendarIds)
            const newVisibility: Record<string, CalendarVisibility> = {}
            for (const [id, value] of Object.entries(state.visibility)) {
              if (validSet.has(id)) {
                newVisibility[id] = value
              }
            }
            return { visibility: newVisibility }
          }),
      }
    },
    {
      name: 'chronos-calendar-visibility',
      partialize: (state) => ({ visibility: state.visibility }),
    }
  )
)
