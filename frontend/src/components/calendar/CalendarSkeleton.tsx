import { EventSkeleton } from './EventSkeleton'

interface CalendarSkeletonProps {
  view: 'month' | 'week' | 'day'
}

export function CalendarSkeleton({ view }: CalendarSkeletonProps) {
  if (view === 'month') {
    return <MonthSkeleton />
  }
  if (view === 'week') {
    return <WeekSkeleton />
  }
  return <DaySkeleton />
}

function MonthSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex mb-0 flex-shrink-0 px-2">
        <div className="grid flex-1 grid-cols-7">
          {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => (
            <div key={d} className="text-center text-sm text-gray-500 font-medium py-1">
              {d}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-7 px-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="bg-white border-r border-t border-gray-200/50 p-1 flex flex-col">
            <div className="flex justify-end mb-1">
              <div className="h-6 w-6 bg-gray-200 rounded-full animate-pulse" />
            </div>
            <div className="mt-1 space-y-0.5">
              {i % 3 === 0 && <EventSkeleton showTime />}
              {i % 4 === 0 && <EventSkeleton showTime />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex border-b border-gray-200">
        <div className="w-16 flex-shrink-0 border-r border-gray-200 p-2">
          <div className="h-3 w-10 bg-gray-200 rounded animate-pulse" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 p-2 text-center">
            <div className="h-4 w-12 bg-gray-200 rounded mx-auto mb-1 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-16 flex-shrink-0 border-r border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 pr-2 flex items-start justify-end">
              <div className="h-3 w-8 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 relative">
          {Array.from({ length: 7 }).map((_, dayIndex) => (
            <div key={dayIndex} className="border-r border-gray-100 last:border-r-0 relative">
              {Array.from({ length: 12 }).map((_, hourIndex) => (
                <div key={hourIndex} className="h-14 border-b border-gray-100" />
              ))}
              {dayIndex % 2 === 0 && (
                <div
                  className="absolute left-0.5 right-1 bg-gray-200 rounded-lg animate-pulse"
                  style={{ top: `${(9 + dayIndex) * 56}px`, height: '52px' }}
                />
              )}
              {dayIndex % 3 === 1 && (
                <div
                  className="absolute left-0.5 right-1 bg-gray-200 rounded-lg animate-pulse"
                  style={{ top: `${(11 - dayIndex) * 56}px`, height: '84px' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DaySkeleton() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex border-b border-gray-200">
        <div className="w-16 flex-shrink-0 border-r border-gray-200 p-2">
          <div className="h-3 w-10 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="flex-1 py-3 text-center">
          <div className="h-4 w-20 bg-gray-200 rounded mx-auto mb-2 animate-pulse" />
          <div className="h-10 w-10 bg-gray-200 rounded-full mx-auto animate-pulse" />
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-16 flex-shrink-0 border-r border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 pr-2 flex items-start justify-end">
              <div className="h-3 w-8 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="flex-1 relative">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 border-b border-gray-100" />
          ))}
          <div
            className="absolute left-0.5 right-2 bg-gray-200 rounded-lg animate-pulse"
            style={{ top: '168px', height: '84px' }}
          />
          <div
            className="absolute left-0.5 right-2 bg-gray-200 rounded-lg animate-pulse"
            style={{ top: '336px', height: '52px' }}
          />
        </div>
      </div>
    </div>
  )
}
