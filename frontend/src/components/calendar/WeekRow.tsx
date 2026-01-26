import { CSSProperties } from 'react'
import { isSameMonth, isToday, format } from '../../lib/date'
import { useCalendarStore } from '../../stores'
import type { Week } from '../../types'

interface WeekRowProps {
  week: Week
  currentDate: Date
  style: CSSProperties
}

export function WeekRow({ week, currentDate, style }: WeekRowProps) {
  const { setView, setCurrentDate } = useCalendarStore()

  const handleDayNumberClick = (e: React.MouseEvent, date: Date) => {
    e.stopPropagation()
    setCurrentDate(date)
    setView('day')
  }

  return (
    <div style={style}>
      <div className="grid h-full w-full" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {week.days.map((day) => {
          const inCurrentMonth = isSameMonth(day, currentDate)
          const isTodayDate = isToday(day)
          const firstOfMonth = day.getDate() === 1

          return (
            <div
              key={day.toISOString()}
              className="month-day-cell bg-white border-r border-t border-gray-200/50 relative p-1 flex flex-col transition-colors duration-200"
            >
              <div className="flex justify-between items-start text-xs mb-1">
                {firstOfMonth && (
                  <span className="font-semibold text-blue-600">{format(day, 'MMM')}</span>
                )}
                <span className="flex-grow" />
                <div
                  onClick={(e) => handleDayNumberClick(e, day)}
                  className={`h-6 w-6 flex items-center justify-center rounded-full text-sm font-medium cursor-pointer transition-colors
                    ${isTodayDate ? 'bg-purple-200 text-purple-800' : 'text-gray-500'}
                    ${!isTodayDate ? 'hover:bg-gray-200' : ''}
                    ${!inCurrentMonth ? 'text-gray-400' : ''}`}
                >
                  {format(day, 'd')}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
