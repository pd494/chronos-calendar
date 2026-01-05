import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { todosApi } from '../api/todos'
import { encrypt, decrypt } from '../lib/crypto'
import { useAuth } from '../contexts/AuthContext'
import type { Todo, TodoList, CreateTodoInput, UpdateTodoInput } from '../types'

async function decryptTodo(todo: Todo, userId: string): Promise<Todo> {
  return { ...todo, title: await decrypt(todo.title, userId) }
}

async function decryptTodos(todos: Todo[], userId: string): Promise<Todo[]> {
  return Promise.all(todos.map(t => decryptTodo(t, userId)))
}

async function decryptList(list: TodoList, userId: string): Promise<TodoList> {
  return { ...list, name: await decrypt(list.name, userId) }
}

async function decryptLists(lists: TodoList[], userId: string): Promise<TodoList[]> {
  return Promise.all(lists.map(l => decryptList(l, userId)))
}

export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (listId?: string) => [...todoKeys.lists(), listId] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: string) => [...todoKeys.details(), id] as const,
}

export const listKeys = {
  all: ['todoLists'] as const,
}

export function useTodos(listId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: todoKeys.list(listId),
    queryFn: async () => {
      const todos = await todosApi.listTodos(listId)
      return user ? decryptTodos(todos, user.id) : todos
    },
    enabled: !!user,
  })
}

export function useTodo(id: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: async () => {
      const todo = await todosApi.getTodo(id)
      return user ? decryptTodo(todo, user.id) : todo
    },
    enabled: !!id && !!user,
  })
}

export function useCreateTodo() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (todo: CreateTodoInput) => {
      if (!user) throw new Error('Not authenticated')
      const encryptedTodo = { ...todo, title: await encrypt(todo.title, user.id) }
      return todosApi.createTodo(encryptedTodo)
    },
    onMutate: async (newTodo) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() })
      const previousTodos = queryClient.getQueryData<Todo[]>(todoKeys.lists())

      const minOrder = previousTodos?.reduce((min, t) => Math.min(min, t.order ?? 0), 0) ?? 0

      const optimisticTodo: Todo = {
        id: crypto.randomUUID(),
        userId: user?.id || '',
        title: newTodo.title,
        completed: false,
        listId: newTodo.listId,
        order: minOrder - 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) => old ? [optimisticTodo, ...old] : [optimisticTodo]
      )

      return { previousTodos }
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos)
      }
      toast.error('Failed to create todo')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() })
    },
  })
}

export function useUpdateTodo() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ id, todo }: { id: string; todo: UpdateTodoInput }) => {
      if (!user) throw new Error('Not authenticated')
      const encryptedTodo = todo.title
        ? { ...todo, title: await encrypt(todo.title, user.id) }
        : todo
      return todosApi.updateTodo(id, encryptedTodo)
    },
    onMutate: async ({ id, todo }) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() })
      const previousTodos = queryClient.getQueryData(todoKeys.lists())

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, ...todo } : t))
      )

      return { previousTodos }
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos)
      }
      toast.error('Failed to update todo')
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() })
      queryClient.invalidateQueries({ queryKey: todoKeys.detail(id) })
    },
  })
}

export function useToggleTodo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      todosApi.updateTodo(id, { completed }),
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() })

      const previousTodos = queryClient.getQueryData(todoKeys.lists())

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, completed } : t))
      )

      return { previousTodos }
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos)
      }
      toast.error('Failed to update todo')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() })
    },
  })
}

export function useDeleteTodo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => todosApi.deleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() })

      const previousTodos = queryClient.getQueryData(todoKeys.lists())

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) => old?.filter((t) => t.id !== id)
      )

      return { previousTodos }
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos)
      }
      toast.error('Failed to delete todo')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() })
    },
  })
}

export function useTodoLists() {
  const { user } = useAuth()
  return useQuery({
    queryKey: listKeys.all,
    queryFn: async () => {
      const lists = await todosApi.listLists()
      return user ? decryptLists(lists, user.id) : lists
    },
    enabled: !!user,
  })
}

export function useCreateList() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async (list: Partial<TodoList>) => {
      if (!user) throw new Error('Not authenticated')
      const encryptedList = list.name
        ? { ...list, name: await encrypt(list.name, user.id) }
        : list
      return todosApi.createList(encryptedList)
    },
    onMutate: async (newList) => {
      await queryClient.cancelQueries({ queryKey: listKeys.all })
      const previousLists = queryClient.getQueryData<TodoList[]>(listKeys.all)

      const minOrder = previousLists?.reduce((min, l) => Math.min(min, l.order ?? 0), 0) ?? 0

      const optimisticList: TodoList = {
        id: crypto.randomUUID(),
        userId: user?.id || '',
        name: newList.name || '',
        color: newList.color || '#3b82f6',
        isSystem: false,
        order: minOrder - 1,
      }

      queryClient.setQueryData(
        listKeys.all,
        (old: TodoList[] | undefined) => old ? [optimisticList, ...old] : [optimisticList]
      )

      return { previousLists }
    },
    onError: (_, __, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(listKeys.all, context.previousLists)
      }
      toast.error('Failed to create list')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all })
    },
  })
}

export function useUpdateList() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({ id, list }: { id: string; list: Partial<TodoList> }) => {
      if (!user) throw new Error('Not authenticated')
      const encryptedList = list.name
        ? { ...list, name: await encrypt(list.name, user.id) }
        : list
      return todosApi.updateList(id, encryptedList)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all })
    },
    onError: () => {
      toast.error('Failed to update list')
    },
  })
}

export function useDeleteList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => todosApi.deleteList(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all })
    },
    onError: () => {
      toast.error('Failed to delete list')
    },
  })
}

export function useReorderTodos() {
  const queryClient = useQueryClient()

  const reorder = (activeId: string, overId: string) => {
    queryClient.setQueriesData(
      { queryKey: todoKeys.lists() },
      (old: Todo[] | undefined) => {
        if (!old) return old
        const oldIndex = old.findIndex(t => t.id === activeId)
        const newIndex = old.findIndex(t => t.id === overId)
        if (oldIndex === -1 || newIndex === -1) return old

        const result = [...old]
        const [removed] = result.splice(oldIndex, 1)
        result.splice(newIndex, 0, removed)

        const updatedResult = result.map((todo, index) => ({ ...todo, order: index }))

        const reorderedIds = updatedResult.map(t => t.id)
        todosApi.reorderTodos(reorderedIds).catch(() => {
          queryClient.invalidateQueries({ queryKey: todoKeys.lists() })
        })

        return updatedResult
      }
    )
  }

  return { reorder }
}

export function useReorderLists() {
  const queryClient = useQueryClient()

  const reorder = (activeId: string, overId: string) => {
    queryClient.setQueryData(
      listKeys.all,
      (old: TodoList[] | undefined) => {
        if (!old) return old
        const oldIndex = old.findIndex(l => l.id === activeId)
        const newIndex = old.findIndex(l => l.id === overId)
        if (oldIndex === -1 || newIndex === -1) return old

        const result = [...old]
        const [removed] = result.splice(oldIndex, 1)
        result.splice(newIndex, 0, removed)

        const updatedResult = result.map((list, index) => ({ ...list, order: index }))

        const reorderedIds = updatedResult.map(l => l.id)
        todosApi.reorderLists(reorderedIds).catch(() => {
          queryClient.invalidateQueries({ queryKey: listKeys.all })
        })

        return updatedResult
      }
    )
  }

  return { reorder }
}
