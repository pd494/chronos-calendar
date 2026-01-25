import { useQuery, useMutation } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { todosApi } from '../api/todos'
import { encrypt, decrypt } from '../lib/crypto'
import {
  db,
  upsertTodos,
  upsertTodo,
  upsertTodoLists,
  upsertTodoList,
  deleteTodoFromDb,
  deleteTodoListFromDb,
} from '../lib/db'
import { todoKeys } from '../lib/queryKeys'
import { useAuth } from '../contexts/AuthContext'
import type { Todo, TodoList, CreateTodoInput, UpdateTodoInput } from '../types'

async function decryptTodo(todo: Todo): Promise<Todo> {
  return { ...todo, title: await decrypt(todo.title) }
}

async function decryptTodos(todos: Todo[]): Promise<Todo[]> {
  return Promise.all(todos.map(t => decryptTodo(t)))
}

async function decryptList(list: TodoList): Promise<TodoList> {
  if (list.isSystem) return list
  return { ...list, name: await decrypt(list.name) }
}

async function decryptLists(lists: TodoList[]): Promise<TodoList[]> {
  return Promise.all(lists.map(l => decryptList(l)))
}

export function useTodos(listId?: string) {
  const { user } = useAuth()
  const syncedRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  const dexieTodos = useLiveQuery(
    async () => {
      if (listId) {
        return db.todos.where('listId').equals(listId).toArray()
      }
      return db.todos.toArray()
    },
    [listId],
    undefined
  )

  useEffect(() => {
    if (!user) return

    if (lastUserIdRef.current !== user.id) {
      syncedRef.current = false
      lastUserIdRef.current = user.id
    }

    if (syncedRef.current) return
    syncedRef.current = true

    const syncFromServer = async () => {
      try {
        const serverTodos = await todosApi.listTodos(listId)
        const decrypted = await decryptTodos(serverTodos)
        await upsertTodos(decrypted)
      } catch (error) {
        console.debug('Background sync failed, using cached data:', error)
      }
    }
    syncFromServer()
  }, [user, listId])

  return {
    data: dexieTodos ?? [],
    isLoading: dexieTodos === undefined,
    error: null,
  }
}

export function useTodo(id: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: async () => {
      const todo = await todosApi.getTodo(id)
      return user ? decryptTodo(todo) : todo
    },
    enabled: !!id && !!user,
  })
}

export function useCreateTodo() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (todo: CreateTodoInput) => {
      if (!user) throw new Error('Not authenticated')

      const existingTodos = await db.todos.toArray()
      const minOrder = existingTodos.reduce((min, t) => Math.min(min, t.order ?? 0), 0)

      const optimisticTodo: Todo = {
        id: crypto.randomUUID(),
        userId: user.id,
        title: todo.title,
        completed: false,
        listId: todo.listId,
        order: minOrder - 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await upsertTodo(optimisticTodo)

      try {
        const encryptedTodo = { ...todo, title: await encrypt(todo.title) }
        const serverTodo = await todosApi.createTodo(encryptedTodo)
        const decrypted = await decryptTodo(serverTodo)

        await db.transaction('rw', db.todos, async () => {
          await deleteTodoFromDb(optimisticTodo.id)
          await upsertTodo(decrypted)
        })
        return decrypted
      } catch (error) {
        await deleteTodoFromDb(optimisticTodo.id)
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to create todo')
    },
  })
}

export function useUpdateTodo() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ id, todo }: { id: string; todo: UpdateTodoInput }) => {
      if (!user) throw new Error('Not authenticated')

      const existing = await db.todos.get(id)
      if (existing) {
        await upsertTodo({ ...existing, ...todo, updatedAt: new Date().toISOString() })
      }

      try {
        const encryptedTodo = todo.title
          ? { ...todo, title: await encrypt(todo.title) }
          : todo
        const serverTodo = await todosApi.updateTodo(id, encryptedTodo)
        const decrypted = await decryptTodo(serverTodo)
        await upsertTodo(decrypted)
        return decrypted
      } catch (error) {
        if (existing) {
          await upsertTodo(existing)
        }
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to update todo')
    },
  })
}

export function useToggleTodo() {
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const existing = await db.todos.get(id)
      if (existing) {
        await upsertTodo({ ...existing, completed, updatedAt: new Date().toISOString() })
      }

      try {
        const serverTodo = await todosApi.updateTodo(id, { completed })
        const decrypted = await decryptTodo(serverTodo)
        await upsertTodo(decrypted)
        return decrypted
      } catch (error) {
        if (existing) {
          await upsertTodo(existing)
        }
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to update todo')
    },
  })
}

export function useDeleteTodo() {
  return useMutation({
    mutationFn: async (id: string) => {
      const existing = await db.todos.get(id)
      await deleteTodoFromDb(id)

      try {
        await todosApi.deleteTodo(id)
      } catch (error) {
        if (existing) {
          await upsertTodo(existing)
        }
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to delete todo')
    },
  })
}

export function useTodoLists() {
  const { user } = useAuth()
  const syncedRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  const dexieLists = useLiveQuery(
    async () => db.todoLists.toArray(),
    [],
    undefined
  )

  useEffect(() => {
    if (!user) return

    if (lastUserIdRef.current !== user.id) {
      syncedRef.current = false
      lastUserIdRef.current = user.id
    }

    if (syncedRef.current) return
    syncedRef.current = true

    const syncFromServer = async () => {
      try {
        const serverLists = await todosApi.listLists()
        const decrypted = await decryptLists(serverLists)
        await upsertTodoLists(decrypted)
      } catch {
        // Silent failure - we still have cached data
      }
    }
    syncFromServer()
  }, [user])

  return {
    data: dexieLists ?? [],
    isLoading: dexieLists === undefined,
    error: null,
  }
}

export function useCreateList() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (list: Partial<TodoList>) => {
      if (!user) throw new Error('Not authenticated')

      const existingLists = await db.todoLists.toArray()
      const minOrder = existingLists.reduce((min, l) => Math.min(min, l.order ?? 0), 0)

      const optimisticList: TodoList = {
        id: crypto.randomUUID(),
        userId: user.id,
        name: list.name || '',
        color: list.color || '#3b82f6',
        isSystem: false,
        order: minOrder - 1,
      }
      await upsertTodoList(optimisticList)

      try {
        const encryptedList = list.name
          ? { ...list, name: await encrypt(list.name) }
          : list
        const serverList = await todosApi.createList(encryptedList)
        const decrypted = await decryptList(serverList)

        await deleteTodoListFromDb(optimisticList.id)
        await upsertTodoList(decrypted)
        return decrypted
      } catch (error) {
        await deleteTodoListFromDb(optimisticList.id)
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to create list')
    },
  })
}

export function useUpdateList() {
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ id, list }: { id: string; list: Partial<TodoList> }) => {
      if (!user) throw new Error('Not authenticated')

      const existing = await db.todoLists.get(id)
      if (existing) {
        await upsertTodoList({ ...existing, ...list })
      }

      try {
        const encryptedList = list.name
          ? { ...list, name: await encrypt(list.name) }
          : list
        const serverList = await todosApi.updateList(id, encryptedList)
        const decrypted = await decryptList(serverList)
        await upsertTodoList(decrypted)
        return decrypted
      } catch (error) {
        if (existing) {
          await upsertTodoList(existing)
        }
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to update list')
    },
  })
}

export function useDeleteList() {
  return useMutation({
    mutationFn: async (id: string) => {
      const existing = await db.todoLists.get(id)
      await deleteTodoListFromDb(id)

      try {
        await todosApi.deleteList(id)
      } catch (error) {
        if (existing) {
          await upsertTodoList(existing)
        }
        throw error
      }
    },
    onError: () => {
      toast.error('Failed to delete list')
    },
  })
}

export function useReorderTodos() {
  const reorder = async (activeId: string, overId: string) => {
    const todos = await db.todos.toArray()
    const oldIndex = todos.findIndex(t => t.id === activeId)
    const newIndex = todos.findIndex(t => t.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const result = [...todos]
    const [removed] = result.splice(oldIndex, 1)
    result.splice(newIndex, 0, removed)

    const updatedResult = result.map((todo, index) => ({ ...todo, order: index }))
    await upsertTodos(updatedResult)

    const reorderedIds = updatedResult.map(t => t.id)
    todosApi.reorderTodos(reorderedIds).catch(async () => {
      await upsertTodos(todos)
    })
  }

  return { reorder }
}

export function useReorderLists() {
  const reorder = async (activeId: string, overId: string) => {
    const lists = await db.todoLists.toArray()
    const oldIndex = lists.findIndex(l => l.id === activeId)
    const newIndex = lists.findIndex(l => l.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const result = [...lists]
    const [removed] = result.splice(oldIndex, 1)
    result.splice(newIndex, 0, removed)

    const updatedResult = result.map((list, index) => ({ ...list, order: index }))
    await upsertTodoLists(updatedResult)

    const reorderedIds = updatedResult.map(l => l.id)
    todosApi.reorderLists(reorderedIds).catch(async () => {
      await upsertTodoLists(lists)
    })
  }

  return { reorder }
}
