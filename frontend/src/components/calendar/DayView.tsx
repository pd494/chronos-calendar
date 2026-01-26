import { useEffect, useRef } from 'react'
import { useCalendarStore } from '../../stores'
import { format, isToday } from '../../lib/date'
import { HOUR_HEIGHT, DAY_START_HOUR, DAY_END_HOUR, useCurrentTime, TimeIndicator } from './TimeIndicator'

export function DayView() {
  const { currentDate } = useCalendarStore()
  const today = isToday(currentDate)
  const now = useCurrentTime()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollContainerRef.current) {
      const currentHour = new Date().getHours()
      const scrollTarget = Math.max(0, (currentHour - 1) * HOUR_HEIGHT)
      scrollContainerRef.current.scrollTop = scrollTarget
    }
  }, [])

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i)

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 relative overflow-hidden bg-white">
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        <div className="w-16 flex-shrink-0 flex items-center justify-center border-r border-gray-200">
          <span className="text-[10px] font-medium text-gray-500">GMT-7</span>
        </div>
        <div className="flex-1 py-3 text-center">
          <div className={`text-xs font-medium uppercase tracking-wider ${today ? 'text-purple-600' : 'text-gray-500'}`}>
            {format(currentDate, 'EEEE')}
          </div>
          <div
            className={`
              mt-1 w-10 h-10 mx-auto flex items-center justify-center text-xl font-semibold rounded-full transition-colors
              ${today ? 'bg-purple-100 text-purple-700' : 'text-gray-900 hover:bg-gray-100'}
            `}
          >
            {format(currentDate, 'd')}
          </div>
        </div>
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

          <div className="flex-1 relative" data-day-column="true">
            {hours.map((hour) => (
              <div
                key={hour}
                className="border-b border-gray-100"
                style={{ height: `${HOUR_HEIGHT}px` }}
              />
            ))}

            {today && <TimeIndicator now={now} />}
          </div>
        </div>
      </div>
    </div>
  )
}
