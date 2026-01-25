import { useMemo, useEffect, useState, useRef } from 'react'
import { Repeat } from 'lucide-react'
import { useCalendarStore } from '../../stores'
import {
  startOfWeek,
  addDays,
  format,
  isToday,
  isSameDay,
  getEventDisplayStyles,
  getEventColorPalette,
  HOUR_HEIGHT,
  DAY_START_HOUR,
  DAY_END_HOUR,
} from '../../lib'
import { useEventsContext } from '../../contexts/EventsContext'
import {
  getEventStart,
  getEventEnd,
  isAllDayEvent,
  isRecurringEvent,
} from '../../types'

export function WeekView() {
  const { currentDate, selectEvent, setView, setCurrentDate } = useCalendarStore()
  const { events: allEvents } = useEventsContext()
  const [now, setNow] = useState(new Date())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (scrollContainerRef.current) {
      const currentHour = new Date().getHours()
      const scrollTarget = Math.max(0, (currentHour - 1) * HOUR_HEIGHT)
      scrollContainerRef.current.scrollTop = scrollTarget
    }
  }, [])

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [currentDate])

  const hours = useMemo(() =>
    Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  )

  const { timedEvents, allDayEvents } = useMemo(() => {
    const weekStart = weekDays[0]
    const weekEnd = weekDays[6]
    const weekEvents = allEvents.filter((e) => {
      const eventStart = getEventStart(e)
      return eventStart >= weekStart && eventStart <= weekEnd
    })
    return {
      timedEvents: weekEvents.filter((e) => !isAllDayEvent(e)),
      allDayEvents: weekEvents.filter((e) => isAllDayEvent(e)),
    }
  }, [allEvents, weekDays])

  const getTimeIndicatorPosition = () => {
    const h = now.getHours()
    const m = now.getMinutes()
    return ((h - DAY_START_HOUR) * HOUR_HEIGHT) + (m / 60) * HOUR_HEIGHT
  }

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 relative overflow-hidden bg-white">
      <div className="flex w-full border-b border-gray-200 bg-white flex-shrink-0">
        <div className="w-16 text-center py-2 text-[10px] font-medium text-gray-500 border-r border-gray-200">
          GMT-7
        </div>
        {weekDays.map((day) => {
          const today = isToday(day)
          return (
            <div
              key={day.toISOString()}
              className={`flex-1 p-2 text-center cursor-pointer hover:bg-gray-50 transition-colors ${today ? 'font-semibold' : ''}`}
              onClick={() => { setCurrentDate(day); setView('day') }}
            >
              <div className={`text-sm ${today ? 'text-purple-600' : 'text-gray-700'}`}>
                {format(day, 'EEE')} {format(day, 'd')}
              </div>
            </div>
          )
        })}
      </div>

      {allDayEvents.length > 0 && (
        <div className="flex border-b border-gray-200 bg-gray-50/30 flex-shrink-0">
          <div className="w-16 flex-shrink-0 border-r border-gray-200 flex items-center justify-center">
            <span className="text-[10px] font-medium text-gray-500">All-day</span>
          </div>
          <div className="flex flex-1 p-1 gap-1 flex-wrap">
            {allDayEvents.map(event => {
              const colors = getEventColorPalette(event)
              return (
                <div
                  key={event.id}
                  onClick={() => selectEvent(event.id)}
                  className="px-2 py-1 text-xs font-medium rounded-md cursor-pointer hover:brightness-95 transition-all flex items-center gap-1"
                  style={{ backgroundColor: colors.background, color: colors.text }}
                >
                  <div
                    className="w-[3px] h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.border }}
                  />
                  {event.summary}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-auto custom-scrollbar relative">
        <div className="flex min-h-full">
          <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-white sticky left-0 z-10">
            {hours.map((hour) => (
              <div key={hour} className="pr-2 text-right" style={{ height: `${HOUR_HEIGHT}px` }}>
                <span className="text-[10px] font-medium text-gray-400 relative" style={{ top: '-6px' }}>
                  {hour === 0 ? '' : format(new Date().setHours(hour, 0), 'h a')}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-1 relative">
            {weekDays.map((day) => {
              const today = isToday(day)
              const dayEvents = timedEvents.filter(e => isSameDay(getEventStart(e), day))

              return (
                <div
                  key={day.toISOString()}
                  className="flex-1 border-r border-gray-100 last:border-r-0 relative"
                  data-week-column="true"
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="border-b border-gray-100"
                      style={{ height: `${HOUR_HEIGHT}px` }}
                    />
                  ))}

                  {dayEvents.map(event => {
                    const start = getEventStart(event)
                    const end = getEventEnd(event)
                    const startHours = start.getHours() + start.getMinutes() / 60
                    const duration = Math.max(0.5, (end.getTime() - start.getTime()) / (1000 * 60 * 60))
                    const colors = getEventColorPalette(event)
                    const top = (startHours - DAY_START_HOUR) * HOUR_HEIGHT
                    const height = Math.max(20, duration * HOUR_HEIGHT - 4)
                    const isRecurring = isRecurringEvent(event)
                    const styles = getEventDisplayStyles(event, colors)

                    return (
                      <div
                        key={event.id}
                        onClick={(e) => { e.stopPropagation(); selectEvent(event.id) }}
                        className={`absolute left-0.5 right-1 rounded-lg p-1 overflow-hidden cursor-pointer hover:brightness-95 transition-all group ${
                          styles.showDashedBorder ? 'border border-dashed border-slate-300' : ''
                        }`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          backgroundColor: styles.backgroundColor,
                          opacity: styles.opacity,
                          zIndex: 10,
                        }}
                      >
                        <div
                          className="absolute left-0.5 top-0.5 bottom-0.5 w-1 rounded-full"
                          style={{ backgroundColor: colors.border }}
                        />
                        <div className="ml-3">
                          <div className="flex items-center gap-1">
                            <div
                              className="text-[11px] font-medium leading-tight truncate flex-1"
                              style={{ color: styles.titleColor }}
                            >
                              <span style={{ textDecoration: styles.textDecoration }}>{event.summary}</span>
                            </div>
                            {isRecurring && <Repeat size={12} className="flex-shrink-0 text-gray-400" />}
                          </div>
                          <div className="text-[10px] font-medium opacity-70 text-gray-600">
                            {format(start, 'h:mm')} – {format(end, 'h:mm a')}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {today && (
                    <div
                      className="absolute right-0 z-20 pointer-events-none"
                      style={{ top: `${getTimeIndicatorPosition()}px`, left: '-64px' }}
                    >
                      <div className="relative flex items-center">
                        <div className="w-2 h-2 rounded-full bg-red-500 ml-[63px]" />
                        <div className="h-0.5 bg-red-500 flex-1" />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
