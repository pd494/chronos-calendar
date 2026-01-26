import { useEffect, useState } from 'react'

export const HOUR_HEIGHT = 55
export const DAY_START_HOUR = 0
export const DAY_END_HOUR = 23

export function useCurrentTime() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  return now
}

export function getTimeIndicatorPosition(now: Date) {
  const h = now.getHours()
  const m = now.getMinutes()
  return ((h - DAY_START_HOUR) * HOUR_HEIGHT) + (m / 60) * HOUR_HEIGHT
}

interface TimeIndicatorProps {
  now: Date
}

export function TimeIndicator({ now }: TimeIndicatorProps) {
  return (
    <div
      className="absolute right-0 z-20 pointer-events-none"
      style={{ top: `${getTimeIndicatorPosition(now)}px`, left: '-64px' }}
    >
      <div className="relative flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 ml-[63px]" />
        <div className="h-0.5 bg-red-500 flex-1" />
      </div>
    </div>
  )
}
