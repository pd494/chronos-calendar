import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { todosApi } from '../api/todos'
import { useAuth } from '../contexts/AuthContext'
import type { Todo, TodoList, CreateTodoInput, UpdateTodoInput } from '../types'

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
    queryFn: () => todosApi.listTodos(listId),
    enabled: !!user,
  })
}

export function useTodo(id: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: () => todosApi.getTodo(id),
    enabled: !!id && !!user,
  })
}

export function useCreateTodo() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (todo: CreateTodoInput) => {
      if (!user) throw new Error('Not authenticated')
      return todosApi.createTodo(todo)
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
    mutationFn: ({ id, todo }: { id: string; todo: UpdateTodoInput }) => {
      if (!user) throw new Error('Not authenticated')
      return todosApi.updateTodo(id, todo)
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
    queryFn: () => todosApi.listLists(),
    enabled: !!user,
  })
}

export function useCreateList() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (list: Partial<TodoList>) => {
      if (!user) throw new Error('Not authenticated')
      return todosApi.createList(list)
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
    mutationFn: ({ id, list }: { id: string; list: Partial<TodoList> }) => {
      if (!user) throw new Error('Not authenticated')
      return todosApi.updateList(id, list)
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
