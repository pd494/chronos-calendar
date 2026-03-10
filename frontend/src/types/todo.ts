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

export interface CreateTodoInput {
  title: string
  listId: string
  scheduledDate?: string
}

export interface CreateTodoListInput {
  name: string
  color: string
}

export interface UpdateTodoListInput {
  name?: string
  color?: string
}

export interface UpdateTodoInput {
  title?: string
  completed?: boolean
  scheduledDate?: string
  listId?: string
  order?: number
}
