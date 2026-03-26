import Dexie, { type EntityTable } from "dexie";
import type {
  Attendee,
  CalendarEvent,
  EventCompletion,
  EventDateTime,
  Reminder,
} from "../types";

export interface DexieEvent {
  id?: number;
  googleEventId: string;
  calendarId: string;
  googleAccountId?: string;
  completed?: boolean;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventDateTime | null;
  status: "confirmed" | "tentative" | "cancelled";
  visibility: "default" | "public" | "private" | "confidential";
  transparency: "opaque" | "transparent";
  colorId?: string;
  color?: string;
  attendees?: Attendee[];
  organizer?: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  reminders?: {
    useDefault: boolean;
    overrides?: Reminder[];
  };
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: { name: string; iconUri?: string };
    entryPoints?: {
      entryPointType: "video" | "phone" | "sip" | "more";
      uri: string;
      label?: string;
    }[];
  };
  htmlLink?: string;
  iCalUID?: string;
  created?: string;
  updated?: string;
}

interface DexieSyncMeta {
  id?: number;
  key: string;
  value: string;
  updatedAt: string;
}

interface DexieTodo {
  id: string;
  userId: string;
  title: string;
  completed: boolean;
  scheduledDate?: string;
  listId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface DexieCompletion {
  id?: number;
  googleCalendarId: string;
  masterEventId: string;
  instanceStart: string;
}

interface DexieTodoList {
  id: string;
  userId: string;
  name: string;
  color: string;
  icon?: string;
  isSystem: boolean;
  order: number;
}

export interface DexieContact {
  id?: number;
  email: string;
  displayName: string;
  photoUrl?: string;
}

class ChronosDatabase extends Dexie {
  events!: EntityTable<DexieEvent, "id">;
  syncMeta!: EntityTable<DexieSyncMeta, "id">;
  todos!: EntityTable<DexieTodo, "id">;
  todoLists!: EntityTable<DexieTodoList, "id">;
  completedEvents!: EntityTable<DexieCompletion, "id">;
  contacts!: EntityTable<DexieContact, "id">;

  constructor() {
    super("chronos");
    this.version(1).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
    });
    this.version(2).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
    });
    this.version(3).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
    });
    this.version(4).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
      todos: "id, listId, userId, order",
      todoLists: "id, userId, order",
    });
    this.version(5).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
      todos: "id, listId, userId, order",
      todoLists: "id, userId, order",
      completedEvents: "++id, [googleCalendarId+masterEventId+instanceStart], googleCalendarId",
    });
    this.version(6).stores({
      events:
        "++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
      todos: "id, listId, userId, order",
      todoLists: "id, userId, order",
      completedEvents: "++id, [googleCalendarId+masterEventId+instanceStart], googleCalendarId",
      contacts: "++id, &email",
    });
  }
}

export const db = new ChronosDatabase();

export async function upsertEvents(events: DexieEvent[]): Promise<void> {
  const keys = events.map(
    (e) => [e.calendarId, e.googleEventId] as [string, string],
  );
  const existing = await db.events
    .where("[calendarId+googleEventId]")
    .anyOf(keys)
    .toArray();
  const existingMap = new Map(
    existing.map((e) => [`${e.calendarId}:${e.googleEventId}`, e]),
  );

  const eventsToWrite = events
    .map((event) => {
      const prev = existingMap.get(
        `${event.calendarId}:${event.googleEventId}`,
      );
      if (!prev) return event;
      if (prev.updated && prev.updated >= (event.updated ?? "")) return null;
      return { ...event, id: prev.id };
    })
    .filter((e): e is DexieEvent => e !== null);

  if (eventsToWrite.length > 0) {
    await db.events.bulkPut(eventsToWrite);
  }
}

async function setSyncMeta(key: string, value: string): Promise<void> {
  const existing = await db.syncMeta.where("key").equals(key).first();
  const updatedAt = new Date().toISOString();
  if (existing) {
    await db.syncMeta.update(existing.id!, { value, updatedAt });
  } else {
    await db.syncMeta.add({ key, value, updatedAt });
  }
}

async function getSyncMeta(key: string): Promise<string | undefined> {
  const record = await db.syncMeta.where("key").equals(key).first();
  return record?.value;
}

export async function getLastSyncAt(): Promise<Date | null> {
  const value = await getSyncMeta("lastSyncAt");
  return value ? new Date(value) : null;
}

export async function setLastSyncAt(date: Date): Promise<void> {
  await setSyncMeta("lastSyncAt", date.toISOString());
}

export type Event = Omit<DexieEvent, "id" | "calendarId" | "created" | "updated" | "completed" | "color"> & {
  googleCalendarId: string;
  createdAt?: string;
  updatedAt?: string;
};

export function calendarEventToDexie(event: Event): DexieEvent {
  return {
    googleEventId: event.googleEventId,
    calendarId: event.googleCalendarId,
    googleAccountId: event.googleAccountId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    recurrence: event.recurrence?.length ? event.recurrence : undefined,
    recurringEventId: event.recurringEventId,
    originalStartTime: event.originalStartTime || null,
    status: event.status,
    visibility: event.visibility,
    transparency: event.transparency,
    colorId: event.colorId,
    attendees: event.attendees,
    organizer: event.organizer,
    reminders: event.reminders,
    conferenceData: event.conferenceData,
    htmlLink: event.htmlLink,
    iCalUID: event.iCalUID,
    created: event.createdAt,
    updated: event.updatedAt,
  };
}

export function dexieToCalendarEvent(event: DexieEvent): CalendarEvent {
  return {
    id: event.googleEventId,
    calendarId: event.calendarId,
    completed: event.completed ?? false,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    recurrence: event.recurrence?.length ? event.recurrence : undefined,
    recurringEventId: event.recurringEventId,
    originalStartTime: event.originalStartTime || undefined,
    status: event.status,
    visibility: event.visibility,
    transparency: event.transparency,
    colorId: event.colorId,
    color: event.color,
    attendees: event.attendees,
    organizer: event.organizer,
    reminders: event.reminders,
    conferenceData: event.conferenceData,
    htmlLink: event.htmlLink,
    iCalUID: event.iCalUID,
    created: event.created || new Date().toISOString(),
    updated: event.updated || new Date().toISOString(),
  };
}

export function completionToDexie(c: EventCompletion): DexieCompletion {
  return {
    googleCalendarId: c.google_calendar_id,
    masterEventId: c.master_event_id,
    instanceStart: c.instance_start,
  };
}

export function dexieToCompletion(c: DexieCompletion): EventCompletion {
  return {
    google_calendar_id: c.googleCalendarId,
    master_event_id: c.masterEventId,
    instance_start: c.instanceStart,
  };
}
