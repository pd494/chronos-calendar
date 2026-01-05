import { api } from './client'
import type { Todo, TodoList, CreateTodoInput, UpdateTodoInput } from '../types'

export const todosApi = {
  listTodos: (listId?: string) =>
    api.get<Todo[]>('/todos', listId ? { listId } : undefined),

  getTodo: (id: string) =>
    api.get<Todo>(`/todos/${id}`),

  createTodo: (todo: CreateTodoInput) =>
    api.post<Todo>('/todos', todo),

  updateTodo: (id: string, todo: UpdateTodoInput) =>
    api.put<Todo>(`/todos/${id}`, todo),

  deleteTodo: (id: string) =>
    api.delete<void>(`/todos/${id}`),

  listLists: () =>
    api.get<TodoList[]>('/todos/todo-lists'),

  createList: (list: Partial<TodoList>) =>
    api.post<TodoList>('/todos/todo-lists', list),

  updateList: (id: string, list: Partial<TodoList>) =>
    api.put<TodoList>(`/todos/todo-lists/${id}`, list),

  deleteList: (id: string) =>
    api.delete<void>(`/todos/todo-lists/${id}`),

  reorderTodos: (todoIds: string[]) =>
    api.post<void>('/todos/reorder', { todoIds }),

  reorderLists: (categoryIds: string[]) =>
    api.post<void>('/todos/todo-lists/reorder', { categoryIds }),
}
