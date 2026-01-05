export interface Todo {
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

export interface TodoList {
  id: string
  userId: string
  name: string
  color: string
  icon?: string
  isSystem: boolean
  order: number
}

export const SYSTEM_LISTS: TodoList[] = [
  { id: 'all', userId: '', name: 'All', color: '#6B7280', isSystem: true, order: 0 },
  { id: 'today', userId: '', name: 'Today', color: '#3B82F6', isSystem: true, order: 1 },
  { id: 'inbox', userId: '', name: 'Inbox', color: '#8B5CF6', isSystem: true, order: 2 },
]

export interface CreateTodoInput {
  title: string
  listId: string
  scheduledDate?: string
}

export interface UpdateTodoInput {
  title?: string
  completed?: boolean
  scheduledDate?: string
  listId?: string
  order?: number
}
