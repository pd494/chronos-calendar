import { useMemo, useEffect, useRef } from 'react'
import { useCalendarStore } from '../../stores'
import { startOfWeek, addDays, format, isToday } from '../../lib/date'
import { HOUR_HEIGHT, DAY_START_HOUR, DAY_END_HOUR, useCurrentTime, TimeIndicator } from './TimeIndicator'

export function WeekView() {
  const { currentDate, setView, setCurrentDate } = useCalendarStore()
  const now = useCurrentTime()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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

                  {today && <TimeIndicator now={now} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
