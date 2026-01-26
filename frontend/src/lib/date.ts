import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  isSameDay,
  isSameMonth,
  isToday,
} from 'date-fns'
import type { Week } from '../types'

export {
  format,
  startOfWeek,
  addDays,
  isSameDay,
  isSameMonth,
  isToday,
}

export const formatDateKey = (date: Date): string => {
  return format(date, 'yyyy-MM-dd')
}

export const generateWeeks = (
  bufferWeeks: number,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0
): Week[] => {
  const today = new Date()
  const centerWeekStart = startOfWeek(today, { weekStartsOn })
  const weeks: Week[] = []

  for (let i = -bufferWeeks; i <= bufferWeeks; i++) {
    const weekStart = addWeeks(centerWeekStart, i)
    const days: Date[] = []

    for (let d = 0; d < 7; d++) {
      days.push(addDays(weekStart, d))
    }

    weeks.push({
      key: formatDateKey(weekStart),
      days,
      weekNumber: i + bufferWeeks,
    })
  }

  return weeks
}

export function formatMonthYear(date: Date): string {
  return format(date, 'MMMM yyyy')
}
