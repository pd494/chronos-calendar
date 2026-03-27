import { z } from 'zod'

const attendeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  photoUrl: z.string().optional(),
  responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']),
  organizer: z.boolean().optional(),
  self: z.boolean().optional(),
  optional: z.boolean().optional(),
})

const reminderSchema = z.object({
  method: z.enum(['email', 'popup']),
  minutes: z.number().min(0).max(40320), // Max 4 weeks
})

const eventDateTimeSchema = z.object({
  dateTime: z.string().optional(), // RFC3339 for timed events
  date: z.string().optional(), // YYYY-MM-DD for all-day
  timeZone: z.string().optional(),
})

export const eventFormSchema = z.object({
  summary: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventDateTimeSchema,
  end: eventDateTimeSchema,
  attendees: z.array(attendeeSchema).optional(),
  colorId: z.string().optional(),
  color: z.string().optional(),
  visibility: z.enum(['default', 'public', 'private', 'confidential']),
  transparency: z.enum(['opaque', 'transparent']), // busy vs free
  recurrence: z.array(z.string()).optional(),
  reminders: z.object({
    useDefault: z.boolean(),
    overrides: z.array(reminderSchema).optional(),
  }).optional(),
  calendarId: z.string(),
})

export type EventFormData = z.infer<typeof eventFormSchema>

export function getDefaultEventValues(startDate?: Date, calendarId?: string): EventFormData {
  const now = startDate || new Date()
  const start = new Date(now)
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)

  const end = new Date(start)
  end.setHours(end.getHours() + 1)

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return {
    summary: '',
    description: '',
    location: '',
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    attendees: [],
    color: 'blue',
    visibility: 'default',
    transparency: 'opaque',
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
    recurrence: [],
    calendarId: calendarId || 'primary',
  }
}
