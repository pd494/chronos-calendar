interface EventSkeletonProps {
  showTime?: boolean
}

export function EventSkeleton({ showTime = false }: EventSkeletonProps) {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5 rounded-md animate-pulse">
      <div className="flex items-center min-w-0 flex-1" style={{ gap: '5px' }}>
        <div className="w-[3px] min-h-[14px] rounded-full ml-0.5 flex-shrink-0 bg-gray-200" />
        <div className="flex-1 h-3 bg-gray-200 rounded" />
      </div>
      {showTime && (
        <div className="h-3 w-10 bg-gray-200 rounded flex-shrink-0" />
      )}
    </div>
  )
}
