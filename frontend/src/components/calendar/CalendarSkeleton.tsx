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
    <div className="flex flex-col h-full bg-white animate-pulse">
      <div className="flex mb-2 px-2">
        <div className="grid flex-1 grid-cols-7 gap-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((_, i) => (
            <div key={i} className="text-center py-1">
              <div className="h-4 w-8 bg-gray-200 rounded mx-auto" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-7 gap-px bg-gray-100">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="bg-white p-2">
            <div className="h-5 w-5 bg-gray-200 rounded-full mb-2" />
            <div className="space-y-1">
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white animate-pulse">
      <div className="flex border-b border-gray-200">
        <div className="w-16 flex-shrink-0 border-r border-gray-200 p-2">
          <div className="h-3 w-10 bg-gray-200 rounded" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 p-2 text-center">
            <div className="h-4 w-12 bg-gray-200 rounded mx-auto mb-1" />
            <div className="h-8 w-8 bg-gray-200 rounded-full mx-auto" />
          </div>
        ))}
      </div>
      <div className="flex-1 flex">
        <div className="w-16 flex-shrink-0 border-r border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 pr-2 flex items-start justify-end">
              <div className="h-3 w-8 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="border-r border-gray-100 last:border-r-0">
              {Array.from({ length: 12 }).map((_, j) => (
                <div key={j} className="h-14 border-b border-gray-100" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DaySkeleton() {
  return (
    <div className="flex flex-col h-full bg-white animate-pulse">
      <div className="flex border-b border-gray-200">
        <div className="w-16 flex-shrink-0 border-r border-gray-200 p-2">
          <div className="h-3 w-10 bg-gray-200 rounded" />
        </div>
        <div className="flex-1 py-3 text-center">
          <div className="h-4 w-20 bg-gray-200 rounded mx-auto mb-2" />
          <div className="h-10 w-10 bg-gray-200 rounded-full mx-auto" />
        </div>
      </div>
      <div className="flex-1 flex">
        <div className="w-16 flex-shrink-0 border-r border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 pr-2 flex items-start justify-end">
              <div className="h-3 w-8 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="flex-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-14 border-b border-gray-100" />
          ))}
        </div>
      </div>
    </div>
  )
}
