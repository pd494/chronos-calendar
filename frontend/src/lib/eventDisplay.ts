import {
  EVENT_COLORS,
  EventColor,
  getSelfResponseStatus,
  isPastEvent,
  CalendarEvent,
} from '../types'

export interface EventDisplayStyles {
  opacity: number
  titleColor: string
  textDecoration: 'line-through' | undefined
  showDashedBorder: boolean
  backgroundColor: string
  isDeclined: boolean
}

export function getEventDisplayStyles(
  event: CalendarEvent,
  colors: typeof EVENT_COLORS[EventColor]
): EventDisplayStyles {
  const responseStatus = getSelfResponseStatus(event)
  const isDeclined = responseStatus === 'declined'
  const isTentative = responseStatus === 'tentative'
  const isPending = responseStatus === 'needsAction'
  const isPast = isPastEvent(event)

  let opacity = 1
  if (isDeclined) opacity = 0.55
  else if (isPast) opacity = 0.7

  let titleColor: string = colors.text
  let textDecoration: 'line-through' | undefined = undefined
  if (isDeclined) {
    titleColor = 'rgba(71, 85, 105, 0.6)'
    textDecoration = 'line-through'
  } else if (isPending || isTentative) {
    titleColor = '#475569'
  }

  const showDashedBorder = isPending || isTentative
  const backgroundColor = showDashedBorder ? 'rgba(248, 250, 252, 0.9)' : colors.background

  return { opacity, titleColor, textDecoration, showDashedBorder, backgroundColor, isDeclined }
}

export const HOUR_HEIGHT = 55
export const DAY_START_HOUR = 0
export const DAY_END_HOUR = 23
