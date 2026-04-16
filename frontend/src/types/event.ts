export type RecurrenceEditScope = "this" | "all" | "following";

export type EntityKind = "regular" | "master" | "exception" | "virtual" | "orphan-exception";

export interface CalendarEvent {
  uuid?: number;
  googleEventId?: string;
  googleCalendarId: string;
  googleAccountId?: string;
  completed: boolean;
  displayId?: string;
  entityKind?: EntityKind;
  seriesMasterId?: string;
  instanceOriginalStart?: EventDateTime;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventDateTime;
  attendees?: Attendee[];
  organizer?: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  colorId?: string;
  color?: string;
  status: "confirmed" | "tentative" | "cancelled";
  visibility: "default" | "public" | "private" | "confidential";
  transparency: "opaque" | "transparent";
  reminders?: {
    useDefault: boolean;
    overrides?: Reminder[];
  };
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: {
      name: string;
      iconUri?: string;
    };
    entryPoints?: {
      entryPointType: "video" | "phone" | "sip" | "more";
      uri: string;
      label?: string;
    }[];
  };
  createdAt: string;
  updatedAt: string;
  htmlLink?: string;
  iCalUID?: string;
}

export interface DisplayOccurrence extends CalendarEvent {
  displayId: string;
  entityKind: EntityKind;
  seriesMasterId?: string;
  instanceOriginalStart?: EventDateTime;
  isOrphan?: boolean;
  effectiveRecurrence?: string[];
}

type EventLike = CalendarEvent | DisplayOccurrence;

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface Attendee {
  email: string;
  displayName?: string;
  photoUrl?: string;
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted";
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
}

export interface Reminder {
  method: "email" | "popup";
  minutes: number;
}

export const EVENT_COLORS = {
  blue: {
    background: "#DBEAFE",
    border: "#3B82F6",
    text: "#2563EB",
    googleId: "1",
  },
  violet: {
    background: "#EDE9FE",
    border: "#8B5CF6",
    text: "#7C3AED",
    googleId: "3",
  },
  pink: {
    background: "#FCE7F3",
    border: "#EC4899",
    text: "#DB2777",
    googleId: "4",
  },
  yellow: {
    background: "#FEF3C7",
    border: "#FBBF24",
    text: "#D97706",
    googleId: "5",
  },
  green: {
    background: "#D1FAE5",
    border: "#10B981",
    text: "#059669",
    googleId: "10",
  },
  teal: {
    background: "#CCFBF1",
    border: "#14B8A6",
    text: "#0D9488",
    googleId: "7",
  },
  orange: {
    background: "#FFEDD5",
    border: "#F97316",
    text: "#EA580C",
    googleId: "6",
  },
  red: {
    background: "#FEE2E2",
    border: "#EF4444",
    text: "#DC2626",
    googleId: "11",
  },
} as const;

export type EventColor = keyof typeof EVENT_COLORS;

export const DEFAULT_EVENT_COLOR: EventColor = "blue";

export function getEventId(event: EventLike): string {
  return event.displayId ?? event.googleEventId ?? '';
}

export function isAllDayEvent(event: EventLike): boolean {
  return !!event.start.date && !event.start.dateTime;
}

export function getEventStart(event: EventLike): Date {
  if (event.start.dateTime) return new Date(event.start.dateTime);
  if (event.start.date) return new Date(event.start.date + "T00:00:00");
  return new Date(0);
}

export function getEventEnd(event: EventLike): Date {
  if (event.end?.dateTime) return new Date(event.end.dateTime);
  if (event.end?.date) return new Date(event.end.date + "T00:00:00");
  if (event.start.dateTime) return new Date(event.start.dateTime);
  if (event.start.date) return new Date(event.start.date + "T00:00:00");
  return new Date(0);
}

export function isRecurringEvent(event: EventLike): boolean {
  return !!(event.recurrence?.length || event.recurringEventId);
}

export interface EventCompletion {
  google_calendar_id: string;
  master_event_id: string;
  instance_start: string;
}

export function isPastEvent(event: EventLike): boolean {
  return getEventEnd(event) < new Date();
}

export function getSelfResponseStatus(
  event: EventLike,
): "needsAction" | "declined" | "tentative" | "accepted" | null {
  const selfAttendee = event.attendees?.find((a) => a.self);
  return selfAttendee?.responseStatus ?? null;
}
