export type CalendarView = 'month' | 'week' | 'day'

export interface Week {
  key: string
  days: Date[]
  weekNumber: number
}
