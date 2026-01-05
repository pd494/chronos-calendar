// Aligned with Google Calendar API Event resource
// https://developers.google.com/calendar/api/v3/reference/events

export interface CalendarEvent {
  id: string
  calendarId: string

  // Core fields
  summary: string // Google uses 'summary' not 'title'
  description?: string
  location?: string

  // Time
  start: EventDateTime
  end: EventDateTime

  // Recurrence (RRULE format)
  recurrence?: string[]
  recurringEventId?: string // For instances of recurring events

  // Attendees
  attendees?: Attendee[]
  organizer?: {
    email: string
    displayName?: string
    self?: boolean
  }

  // Display
  colorId?: string // Google's color ID (1-11)
  color?: string // Our mapped color name

  // Status
  status: 'confirmed' | 'tentative' | 'cancelled'
  visibility: 'default' | 'public' | 'private' | 'confidential'
  transparency: 'opaque' | 'transparent' // busy vs free

  // Reminders
  reminders?: {
    useDefault: boolean
    overrides?: Reminder[]
  }

  // Conference (Google Meet)
  conferenceData?: {
    conferenceId?: string
    conferenceSolution?: {
      name: string
      iconUri?: string
    }
    entryPoints?: {
      entryPointType: 'video' | 'phone' | 'sip' | 'more'
      uri: string
      label?: string
    }[]
  }

  // Metadata
  created: string // ISO datetime
  updated: string // ISO datetime
  htmlLink?: string
  iCalUID?: string
}

export interface EventDateTime {
  dateTime?: string // RFC3339 timestamp for timed events
  date?: string // YYYY-MM-DD for all-day events
  timeZone?: string
}

export interface Attendee {
  email: string
  displayName?: string
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted'
  organizer?: boolean
  self?: boolean
  optional?: boolean
}

export interface Reminder {
  method: 'email' | 'popup'
  minutes: number
}

// Our UI-friendly color mapping
export const EVENT_COLORS = {
  blue: { background: '#CDEDFD', border: '#1761C7', text: '#1761C7', googleId: '1' },
  violet: { background: '#E8DBFC', border: '#8B5CF6', text: '#7C3AED', googleId: '3' },
  red: { background: '#FECACA', border: '#EF4444', text: '#DC2626', googleId: '11' },
  yellow: { background: '#FEF3C7', border: '#F59E0B', text: '#D97706', googleId: '5' },
  green: { background: '#D1FAE5', border: '#10B981', text: '#059669', googleId: '10' },
  teal: { background: '#CCFBF1', border: '#14B8A6', text: '#0D9488', googleId: '7' },
  orange: { background: '#FFEDD5', border: '#F97316', text: '#EA580C', googleId: '6' },
  pink: { background: '#FCE7F3', border: '#EC4899', text: '#DB2777', googleId: '4' },
  brown: { background: '#E7E5E4', border: '#78716C', text: '#57534E', googleId: '8' },
} as const

export type EventColor = keyof typeof EVENT_COLORS

export const DEFAULT_EVENT_COLOR: EventColor = 'blue'

// Helper to check if event is all-day
export const isAllDayEvent = (event: CalendarEvent): boolean => {
  return !!event.start.date && !event.start.dateTime
}

// Helper to get event start as Date object
export const getEventStart = (event: CalendarEvent): Date => {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime)
  }
  return new Date(event.start.date + 'T00:00:00')
}

// Helper to get event end as Date object
export const getEventEnd = (event: CalendarEvent): Date => {
  if (event.end.dateTime) {
    return new Date(event.end.dateTime)
  }
  return new Date(event.end.date + 'T00:00:00')
}
