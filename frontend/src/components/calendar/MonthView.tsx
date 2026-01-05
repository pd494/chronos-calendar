import { useRef, useMemo, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCalendarStore } from '../../stores'
import { generateWeeks, isSameMonth } from '../../lib/date'
import { WeekRow } from './WeekRow'

const BUFFER_WEEKS = 520
const WEEKS_PER_PAGE = 6

export function MonthView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { currentDate, setCurrentDate } = useCalendarStore()
  const [pageHeight, setPageHeight] = useState(720)

  const weeks = useMemo(() => generateWeeks(BUFFER_WEEKS), [])
  const todayIndex = BUFFER_WEEKS
  const rowHeight = (pageHeight / WEEKS_PER_PAGE) + 10

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        const containerHeight = containerRef.current.clientHeight
        setPageHeight(containerHeight)
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [])

  const virtualizer = useVirtualizer({
    count: weeks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  useEffect(() => {
    virtualizer.scrollToIndex(todayIndex, { align: 'start' })
  }, [])

  const visibleItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const midItem = visibleItems[Math.floor(visibleItems.length / 2)]
    if (midItem) {
      const midWeek = weeks[midItem.index]
      const middleDay = midWeek.days[3]
      if (!isSameMonth(middleDay, currentDate)) {
        setCurrentDate(middleDay)
      }
    }
  }, [visibleItems[0]?.index])

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 overflow-hidden bg-white">
      <div className="flex mb-0 flex-shrink-0 px-2">
        <div className="grid flex-1 grid-cols-7">
          {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => (
            <div key={d} className="text-center text-sm text-gray-500 font-medium py-1">
              {d}
            </div>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative bg-white scrollbar-hide overflow-y-scroll overflow-x-hidden px-2"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {visibleItems.map((virtualRow) => {
            const week = weeks[virtualRow.index]
            return (
              <WeekRow
                key={week.key}
                week={week}
                currentDate={currentDate}
                rowHeight={rowHeight}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              />
            )
          })}
        </div>
        </div>
    </div>
  )
}
