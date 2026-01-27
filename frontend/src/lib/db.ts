import Dexie, { type EntityTable } from 'dexie'
import type { Attendee, CalendarEvent, EventDateTime, Reminder, Todo, TodoList } from '../types'

export interface DexieEvent {
  id?: number
  googleEventId: string
  calendarId: string
  googleAccountId?: string
  summary: string
  encryptedSummary?: string
  description?: string
  encryptedDescription?: string
  location?: string
  encryptedLocation?: string
  start: EventDateTime
  end: EventDateTime
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: EventDateTime | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  visibility: 'default' | 'public' | 'private' | 'confidential'
  transparency: 'opaque' | 'transparent'
  colorId?: string
  color?: string
  attendees?: Attendee[]
  encryptedAttendees?: string
  organizer?: {
    email: string
    displayName?: string
    self?: boolean
  }
  reminders?: {
    useDefault: boolean
    overrides?: Reminder[]
  }
  conferenceData?: {
    conferenceId?: string
    conferenceSolution?: { name: string; iconUri?: string }
    entryPoints?: {
      entryPointType: 'video' | 'phone' | 'sip' | 'more'
      uri: string
      label?: string
    }[]
  }
  htmlLink?: string
  iCalUID?: string
  created?: string
  updated?: string
  pendingSupabaseSync?: boolean | 'failed'
  isEncrypted?: boolean
}

interface DexieSyncMeta {
  id?: number
  key: string
  value: string
  updatedAt: string
}

export interface DexieTodo {
  id: string
  userId: string
  title: string
  completed: boolean
  scheduledDate?: string
  listId: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface DexieTodoList {
  id: string
  userId: string
  name: string
  color: string
  icon?: string
  isSystem: boolean
  order: number
}

class ChronosDatabase extends Dexie {
  events!: EntityTable<DexieEvent, 'id'>
  syncMeta!: EntityTable<DexieSyncMeta, 'id'>
  todos!: EntityTable<DexieTodo, 'id'>
  todoLists!: EntityTable<DexieTodoList, 'id'>

  constructor() {
    super('chronos')
    this.version(1).stores({
      events: '++id, [calendarId+googleEventId], calendarId, recurringEventId, [calendarId+recurringEventId], recurrence',
      syncMeta: '++id, key',
    })
    this.version(2).stores({
      events:
        '++id, [calendarId+googleEventId], calendarId, recurringEventId, [calendarId+recurringEventId], recurrence, pendingSupabaseSync',
      syncMeta: '++id, key',
    })
    this.version(3).stores({
      events:
        '++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence, pendingSupabaseSync',
      syncMeta: '++id, key',
    })
    this.version(4).stores({
      events:
        '++id, [calendarId+googleEventId], calendarId, googleAccountId, recurringEventId, [calendarId+recurringEventId], recurrence, pendingSupabaseSync',
      syncMeta: '++id, key',
      todos: 'id, listId, userId, order',
      todoLists: 'id, userId, order',
    })
  }
}

export const db = new ChronosDatabase()

export async function upsertEvents(events: DexieEvent[]): Promise<void> {
  const eventsWithIds = await Promise.all(
    events.map(async (event) => {
      const existing = await db.events
        .where('[calendarId+googleEventId]')
        .equals([event.calendarId, event.googleEventId])
        .first()
      return existing ? { ...event, id: existing.id } : event
    })
  )
  await db.events.bulkPut(eventsWithIds)
}

async function setSyncMeta(key: string, value: string): Promise<void> {
  const existing = await db.syncMeta.where('key').equals(key).first()
  const updatedAt = new Date().toISOString()
  if (existing) {
    await db.syncMeta.update(existing.id!, { value, updatedAt })
  } else {
    await db.syncMeta.add({ key, value, updatedAt })
  }
}

async function getSyncMeta(key: string): Promise<string | undefined> {
  const record = await db.syncMeta.where('key').equals(key).first()
  return record?.value
}

export async function getLastSyncAt(): Promise<Date | null> {
  const value = await getSyncMeta('lastSyncAt')
  return value ? new Date(value) : null
}

export async function setLastSyncAt(date: Date): Promise<void> {
  await setSyncMeta('lastSyncAt', date.toISOString())
}

export function calendarEventToDexie(event: CalendarEvent): DexieEvent {
  return {
    googleEventId: event.id,
    calendarId: event.calendarId,
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
    color: event.color,
    attendees: event.attendees,
    organizer: event.organizer,
    reminders: event.reminders,
    conferenceData: event.conferenceData,
    htmlLink: event.htmlLink,
    iCalUID: event.iCalUID,
    created: event.created,
    updated: event.updated,
  }
}

export function dexieToCalendarEvent(event: DexieEvent): CalendarEvent {
  return {
    id: event.googleEventId,
    calendarId: event.calendarId,
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
  }
}

export async function upsertTodos(todos: Todo[]): Promise<void> {
  await db.todos.bulkPut(todos)
}

export async function upsertTodo(todo: Todo): Promise<void> {
  await db.todos.put(todo)
}

export async function deleteTodoFromDb(id: string): Promise<void> {
  await db.todos.delete(id)
}

export async function upsertTodoLists(lists: TodoList[]): Promise<void> {
  await db.todoLists.bulkPut(lists)
}

export async function upsertTodoList(list: TodoList): Promise<void> {
  await db.todoLists.put(list)
}

export async function deleteTodoListFromDb(id: string): Promise<void> {
  await db.todoLists.delete(id)
}

export async function clearEncryptedEvents(): Promise<boolean> {
  const hasEncrypted = await db.events
    .filter((e) => e.isEncrypted === true || e.summary === '[encrypted]')
    .count()

  if (hasEncrypted > 0) {
    await db.events.clear()
    await db.syncMeta.clear()
    return true
  }
  return false
}
