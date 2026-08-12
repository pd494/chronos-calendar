import Dexie, { type EntityTable } from "dexie";
import type {
  CalendarEvent,
  EventCompletion,
} from "../types";

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
  events!: EntityTable<CalendarEvent, "uuid">;
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
    this.version(7).stores({
      events:
        "++uuid, [googleCalendarId+googleEventId], googleCalendarId, googleAccountId, recurringEventId, [googleCalendarId+recurringEventId], recurrence",
      syncMeta: "++id, key",
      todos: "id, listId, userId, order",
      todoLists: "id, userId, order",
      completedEvents: "++id, [googleCalendarId+masterEventId+instanceStart], googleCalendarId",
      contacts: "++id, &email",
    });
  }
}

export const db = new ChronosDatabase();

export async function upsertEvents(events: CalendarEvent[]): Promise<void> {
  const keys = events.map(
    (e) => [e.googleCalendarId, e.googleEventId] as [string, string],
  );
  const existing = await db.events
    .where("[googleCalendarId+googleEventId]")
    .anyOf(keys)
    .toArray();
  const existingMap = new Map(
    existing.map((e) => [`${e.googleCalendarId}:${e.googleEventId}`, e]),
  );

  const eventsToWrite = events
    .map((event) => {
      const prev = existingMap.get(
        `${event.googleCalendarId}:${event.googleEventId}`,
      );
      if (!prev) return event;
      if (prev.updatedAt && prev.updatedAt >= (event.updatedAt ?? "")) return null;
      return { ...event, uuid: prev.uuid };
    })
    .filter((e): e is CalendarEvent => e !== null);

  if (eventsToWrite.length > 0) {
    await db.events.bulkPut(eventsToWrite);
  }
}

async function setSyncMeta(key: string, value: string): Promise<void> {
  const existing = await db.syncMeta.where("key").equals(key).first();
  const updatedAt = new Date().toISOString();
  await db.syncMeta.put({ id: existing?.id, key, value, updatedAt });
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
