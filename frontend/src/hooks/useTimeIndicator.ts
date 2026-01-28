import { useEffect, useState, useRef, type RefObject } from 'react'
import { HOUR_HEIGHT, DAY_START_HOUR } from '../lib'

interface TimeIndicator {
  scrollContainerRef: RefObject<HTMLDivElement | null>
  getPosition: () => number
}

export function useTimeIndicator(): TimeIndicator {
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

  const getPosition = () => {
    const h = now.getHours()
    const m = now.getMinutes()
    return ((h - DAY_START_HOUR) * HOUR_HEIGHT) + (m / 60) * HOUR_HEIGHT
  }

  return { scrollContainerRef, getPosition }
}
