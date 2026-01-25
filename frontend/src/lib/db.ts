import Dexie, { type EntityTable } from 'dexie'
import type { CalendarEvent, Todo, TodoList } from '../types'

export interface DexieEventAttendee {
  email: string
  displayName?: string
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted'
  organizer?: boolean
  self?: boolean
  optional?: boolean
}

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
  start: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: {
    dateTime?: string
    date?: string
    timeZone?: string
  } | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  visibility: 'default' | 'public' | 'private' | 'confidential'
  transparency: 'opaque' | 'transparent'
  colorId?: string
  attendees?: DexieEventAttendee[]
  encryptedAttendees?: string
  organizer?: {
    email: string
    displayName?: string
    self?: boolean
  }
  reminders?: {
    useDefault: boolean
    overrides?: { method: 'email' | 'popup'; minutes: number }[]
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

export interface DexieSyncMeta {
  id?: number
  key: string
  value: string
  updatedAt: string
}

export interface DexieTodo {
  id: string
  odexieId?: number
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
  dexieId?: number
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

export async function clearDatabase() {
  await db.events.clear()
  await db.syncMeta.clear()
  await db.todos.clear()
  await db.todoLists.clear()
}

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

export async function getEventsForCalendar(calendarId: string): Promise<DexieEvent[]> {
  return db.events.where('calendarId').equals(calendarId).toArray()
}

export async function getEventsForCalendars(calendarIds: string[]): Promise<DexieEvent[]> {
  return db.events.where('calendarId').anyOf(calendarIds).toArray()
}

export async function getMasterEvents(calendarIds: string[]): Promise<DexieEvent[]> {
  const events = await db.events.where('calendarId').anyOf(calendarIds).toArray()
  return events.filter((e) => e.recurrence && e.recurrence.length > 0 && !e.recurringEventId)
}

export async function getExceptionsForMaster(
  calendarId: string,
  masterId: string
): Promise<DexieEvent[]> {
  return db.events
    .where('[calendarId+recurringEventId]')
    .equals([calendarId, masterId])
    .toArray()
}

export async function setSyncMeta(key: string, value: string) {
  const existing = await db.syncMeta.where('key').equals(key).first()
  const updatedAt = new Date().toISOString()
  if (existing) {
    await db.syncMeta.update(existing.id!, { value, updatedAt })
  } else {
    await db.syncMeta.add({ key, value, updatedAt })
  }
}

export async function getSyncMeta(key: string): Promise<string | undefined> {
  const record = await db.syncMeta.where('key').equals(key).first()
  return record?.value
}

export async function getLastSyncAt(): Promise<Date | null> {
  const value = await getSyncMeta('lastSyncAt')
  return value ? new Date(value) : null
}

export async function setLastSyncAt(date: Date) {
  await setSyncMeta('lastSyncAt', date.toISOString())
}

export async function getPendingSupabaseSyncEvents(): Promise<DexieEvent[]> {
  return db.events.where('pendingSupabaseSync').equals(true).toArray()
}

export async function getFailedSupabaseSyncEvents(): Promise<DexieEvent[]> {
  return db.events.filter((e) => e.pendingSupabaseSync === 'failed').toArray()
}

export async function getPendingSupabaseSyncCount(): Promise<number> {
  return db.events.where('pendingSupabaseSync').equals(true).count()
}

export async function getRawEventsForSync(): Promise<DexieEvent[]> {
  return db.events.where('pendingSupabaseSync').equals(true).toArray()
}

export function calendarEventToDexie(event: CalendarEvent): DexieEvent {
  const recurrence = event.recurrence && event.recurrence.length > 0 ? event.recurrence : undefined
  return {
    googleEventId: event.id,
    calendarId: event.calendarId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    recurrence,
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
    created: event.created,
    updated: event.updated,
    pendingSupabaseSync: true,
  }
}

export function dexieToCalendarEvent(event: DexieEvent): CalendarEvent {
  const recurrence = event.recurrence && event.recurrence.length > 0 ? event.recurrence : undefined
  return {
    id: event.googleEventId,
    calendarId: event.calendarId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    recurrence,
    recurringEventId: event.recurringEventId,
    originalStartTime: event.originalStartTime || undefined,
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
    created: event.created || new Date().toISOString(),
    updated: event.updated || new Date().toISOString(),
  }
}

export async function getTodos(): Promise<Todo[]> {
  return db.todos.toArray()
}

export async function getTodosByList(listId: string): Promise<Todo[]> {
  return db.todos.where('listId').equals(listId).toArray()
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

export async function getTodoLists(): Promise<TodoList[]> {
  return db.todoLists.toArray()
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
  const firstEvent = await db.events.toCollection().first()
  if (firstEvent?.isEncrypted || firstEvent?.summary === '[encrypted]') {
    await db.events.clear()
    await db.syncMeta.clear()
    return true
  }
  return false
}
