export type CalendarView = 'month' | 'week' | 'day'

export interface Week {
  key: string
  days: Date[]
  weekNumber: number
}

export interface DayCell {
  date: Date
  isToday: boolean
  isCurrentMonth: boolean
  events: string[] 
}

export interface TimeSlot {
  hour: number
  minute: number
  label: string
}

export interface VisibleRange {
  start: Date
  end: Date
}

export interface CalendarSettings {
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0 = Sunday, 1 = Monday, etc.
  defaultView: CalendarView
  defaultEventDuration: number // minutes
  defaultReminder: number // minutes before event
  timeFormat: '12h' | '24h'
  showWeekNumbers: boolean
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  weekStartsOn: 0,
  defaultView: 'month',
  defaultEventDuration: 60,
  defaultReminder: 30,
  timeFormat: '12h',
  showWeekNumbers: false,
}
