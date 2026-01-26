import { CSSProperties } from 'react'
import { isSameMonth, isToday, format, isSameDay } from '../../lib/date'
import { useCalendarStore } from '../../stores'
import { useEvents } from '../../hooks'
import { EVENT_COLORS, EventColor, getEventStart } from '../../types'
import type { Week } from '../../types'

interface WeekRowProps {
  week: Week
  currentDate: Date
  style: CSSProperties
}

export function WeekRow({ week, currentDate, style }: WeekRowProps) {
  const { selectEvent, setView, setCurrentDate } = useCalendarStore()

  const { data: events = [] } = useEvents({
    calendarId: 'primary',
    timeMin: week.days[0].toISOString(),
    timeMax: week.days[6].toISOString(),
  })

  const handleDayDoubleClick = (date: Date) => {
    selectEvent(`new-${date.getTime()}`)
  }

  const handleDayNumberClick = (e: React.MouseEvent, date: Date) => {
    e.stopPropagation()
    setCurrentDate(date)
    setView('day')
  }

  const handleEventClick = (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation()
    selectEvent(eventId)
  }

  return (

<div style={style}>
      <div className="grid h-full w-full" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {week.days.map((day) => {
          const inCurrentMonth = isSameMonth(day, currentDate)
          const isTodayDate = isToday(day)
          const firstOfMonth = day.getDate() === 1
          const dayEvents = events.filter((event) => isSameDay(getEventStart(event), day))
          const visibleEvents = dayEvents.slice(0, 3)
          const remainingCount = dayEvents.length - visibleEvents.length

          return (
            <div
               key={day.toISOString()}
               onDoubleClick={() => handleDayDoubleClick(day)}
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

                <div className="mt-1 overflow-hidden flex-1 space-y-0.5">
                  {visibleEvents.map((event) => {
                    const colorKey = (event.color as EventColor) || 'blue'
                    const colors = EVENT_COLORS[colorKey]
                    const isAllDay = !!event.start.date
                    const startTime = !isAllDay ? format(getEventStart(event), 'h:mma').toLowerCase() : ''

                    return (
                      <div
                        key={event.id}
                        onClick={(e) => handleEventClick(e, event.id)}
                        className="relative text-xs flex items-center gap-1 px-1 py-0.5 transition-opacity duration-150 hover:opacity-80 hover:brightness-95 rounded-md"
                        style={{
                          maxWidth: '100%',
                          minWidth: 0,
                          cursor: 'pointer',
                          ...(isAllDay
                            ? {
                                backgroundColor: colors.background,
                                borderRadius: '5px',
                                paddingLeft: '0px',
                                paddingRight: '8px',
                              }
                            : { paddingLeft: '0px' }),
                        }}
                      >
                        <div className="flex items-center min-w-0 flex-1" style={{ gap: '5px' }}>
                          <div
                            className="w-[3px] min-h-[14px] rounded-full ml-0.5 flex-shrink-0"
                            style={{ backgroundColor: colors.border, height: 'calc(100% - 4px)' }}
                          />
                          <div
                            className="flex-1 truncate overflow-hidden text-ellipsis font-medium min-w-0"
                            style={{ color: colors.text }}
                          >
                            <span>{event.summary}</span>
                          </div>
                        </div>
                        {!isAllDay && (
                          <div
                            className="text-gray-600 flex-shrink-0 whitespace-nowrap text-right font-medium pl-1"
                            style={{ minWidth: '48px' }}
                          >
                            {startTime}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {remainingCount > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 pl-2"
                      style={{ marginLeft: '-4.5px' }}
                      onClick={(e) => handleDayNumberClick(e, day)}
                    >
                      {remainingCount} more
                    </button>
                  )}
                </div>
              </div>
            )
        })}
      </div>
    </div>
  )
}
