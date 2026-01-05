import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
  differenceInCalendarDays,
  parseISO,
} from 'date-fns'
import type { Week } from '../types'

export {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
  differenceInCalendarDays,
  parseISO,
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

export const formatTime = (date: Date, use24h: boolean = false): string => {
  return format(date, use24h ? 'HH:mm' : 'h:mm a')
}

export const formatMonthYear = (date: Date): string => {
  return format(date, 'MMMM yyyy')
}

export const getOrdinalSuffix = (day: number): string => {
  if (day > 3 && day < 21) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

export const weeksBetween = (start: Date, end: Date): number => {
  return Math.ceil(differenceInCalendarDays(end, start) / 7)
}
