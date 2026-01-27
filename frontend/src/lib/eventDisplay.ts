import {
  EVENT_COLORS,
  EventColor,
  DEFAULT_EVENT_COLOR,
  getSelfResponseStatus,
  isPastEvent,
  CalendarEvent,
} from '../types'

export interface EventColorPalette {
  background: string
  border: string
  text: string
  googleId?: string
}

export interface EventDisplayStyles {
  opacity: number
  titleColor: string
  textDecoration: 'line-through' | undefined
  showDashedBorder: boolean
  backgroundColor: string
  isDeclined: boolean
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/

function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex)
  const value = normalized.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return { r, g, b }
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function mixWithColor(hex: string, target: number, ratio: number): string {
  const { r, g, b } = hexToRgb(hex)
  const mix = (channel: number) => Math.round(channel + (target - channel) * ratio)
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function buildPaletteFromHex(hex: string): EventColorPalette {
  const base = normalizeHex(hex)
  const border = base
  const background = mixWithColor(base, 255, 0.82)
  const luminance = getLuminance(base)
  const text = luminance > 0.75 ? mixWithColor(base, 0, 0.45) : base
  return { background, border, text }
}

export function getEventColorPalette(event: CalendarEvent): EventColorPalette {
  if (event.color && event.color in EVENT_COLORS) {
    return EVENT_COLORS[event.color as EventColor]
  }

  if (event.colorId) {
    if (HEX_COLOR_PATTERN.test(event.colorId)) {
      return buildPaletteFromHex(event.colorId)
    }
    const matched = Object.entries(EVENT_COLORS).find(([, value]) => value.googleId === event.colorId)
    if (matched) {
      return matched[1]
    }
  }

  return EVENT_COLORS[DEFAULT_EVENT_COLOR]
}

export function getEventDisplayStyles(
  event: CalendarEvent,
  colors: EventColorPalette
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
