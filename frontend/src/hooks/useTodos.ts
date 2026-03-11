import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { todosApi } from "../api/todos";
import { useAuth } from "../contexts/AuthContext";
import { listKeys, todoKeys } from "../lib/queryKeys";
import type {
  Todo,
  TodoList,
  CreateTodoInput,
  CreateTodoListInput,
  UpdateTodoInput,
  UpdateTodoListInput,
} from "../types";

export function useTodos(listId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: todoKeys.list(listId),
    queryFn: () => todosApi.listTodos(listId),
    enabled: !!user,
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (todo: CreateTodoInput) => {
      if (!user) throw new Error("Not authenticated");
      return todosApi.createTodo(todo);
    },
    onMutate: async (newTodo) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

      const allCachedTodos = queryClient.getQueriesData<Todo[]>({
        queryKey: todoKeys.lists(),
      });
      let minOrder = 0;
      for (const [, data] of allCachedTodos) {
        if (data) {
          const listMin = data.reduce(
            (min, t) => Math.min(min, t.order ?? 0),
            0,
          );
          minOrder = Math.min(minOrder, listMin);
        }
      }

      const optimisticTodo: Todo = {
        id: crypto.randomUUID(),
        userId: user?.id || "",
        title: newTodo.title,
        completed: false,
        listId: newTodo.listId,
        order: minOrder - 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      queryClient.setQueriesData<Todo[]>(
        { queryKey: todoKeys.lists() },
        (old) => {
          if (!old) return [optimisticTodo];
          return [
            optimisticTodo,
            ...old.filter((t) => t.id !== optimisticTodo.id),
          ];
        },
      );

      return { previousTodos: allCachedTodos };
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        for (const [queryKey, data] of context.previousTodos) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      toast.error("Failed to create todo");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: ({ id, todo }: { id: string; todo: UpdateTodoInput }) => {
      if (!user) throw new Error("Not authenticated");
      return todosApi.updateTodo(id, todo);
    },
    onMutate: async ({ id, todo }) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });
      const previousTodos = queryClient.getQueryData(todoKeys.lists());

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, ...todo } : t)),
      );

      return { previousTodos };
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos);
      }
      toast.error("Failed to update todo");
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: todoKeys.detail(id) });
    },
  });
}

export function useToggleTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      todosApi.updateTodo(id, { completed }),
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

      const previousTodos = queryClient.getQueryData(todoKeys.lists());

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) =>
          old?.map((t) => (t.id === id ? { ...t, completed } : t)),
      );

      return { previousTodos };
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos);
      }
      toast.error("Failed to update todo");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: listKeys.all });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => todosApi.deleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

      const previousTodos = queryClient.getQueryData(todoKeys.lists());

      queryClient.setQueriesData(
        { queryKey: todoKeys.lists() },
        (old: Todo[] | undefined) => old?.filter((t) => t.id !== id),
      );

      return { previousTodos };
    },
    onError: (_, __, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(todoKeys.lists(), context.previousTodos);
      }
      toast.error("Failed to delete todo");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: listKeys.all });
    },
  });
}

export function useTodoLists() {
  const { user } = useAuth();
  return useQuery({
    queryKey: listKeys.all,
    queryFn: () => todosApi.listLists(),
    enabled: !!user,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (list: CreateTodoListInput) => {
      if (!user) throw new Error("Not authenticated");
      return todosApi.createList(list);
    },
    onMutate: async (newList) => {
      await queryClient.cancelQueries({ queryKey: listKeys.all });
      const previousLists = queryClient.getQueryData<TodoList[]>(listKeys.all);

      const minOrder =
        previousLists?.reduce((min, l) => Math.min(min, l.order ?? 0), 0) ?? 0;

      const optimisticList: TodoList = {
        id: crypto.randomUUID(),
        userId: user?.id || "",
        name: newList.name || "",
        color: newList.color || "#3b82f6",
        isSystem: false,
        order: minOrder - 1,
      };

      queryClient.setQueryData(listKeys.all, (old: TodoList[] | undefined) =>
        old ? [optimisticList, ...old] : [optimisticList],
      );

      return { previousLists };
    },
    onError: (_, __, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(listKeys.all, context.previousLists);
      }
      toast.error("Failed to create list");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all });
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

export function useUpdateList() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: ({ id, list }: { id: string; list: UpdateTodoListInput }) => {
      if (!user) throw new Error("Not authenticated");
      return todosApi.updateList(id, list);
    },
    onMutate: async ({ id, list }) => {
      await queryClient.cancelQueries({ queryKey: listKeys.all });
      const previousLists = queryClient.getQueryData<TodoList[]>(listKeys.all);

      queryClient.setQueryData(listKeys.all, (old: TodoList[] | undefined) =>
        old?.map((l) => (l.id === id ? { ...l, ...list } : l)),
      );

      return { previousLists };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(listKeys.all, context.previousLists);
      }
      toast.error("Failed to update list");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all });
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => todosApi.deleteList(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: listKeys.all });
      const previousLists = queryClient.getQueryData<TodoList[]>(listKeys.all);

      queryClient.setQueryData(listKeys.all, (old: TodoList[] | undefined) =>
        old?.filter((l) => l.id !== id),
      );

      return { previousLists };
    },
    onError: (_error, _id, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(listKeys.all, context.previousLists);
      }
      toast.error("Failed to delete list");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKeys.all });
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    },
  });
}

export function useReorderTodos() {
  const queryClient = useQueryClient();

  const reorder = (newOrder: string[]) => {
    queryClient.setQueriesData(
      { queryKey: todoKeys.lists() },
      (old: Todo[] | undefined) => {
        if (!old || newOrder.length === 0) return old;
        const firstTodo = old.find((t) => t.id === newOrder[0]);
        const listId = firstTodo?.listId;
        if (!listId) return old;
        const orderMap = new Map(newOrder.map((id, i) => [id, i]));
        const updatedResult = old.map((t) => {
          if (t.listId !== listId) return t;
          const idx = orderMap.get(t.id);
          return idx !== undefined ? { ...t, order: idx } : t;
        });
        return updatedResult;
      },
    );
  };

  const persistReorder = async (newOrder: string[]) => {
    if (newOrder.length === 0) return;
    try {
      await todosApi.reorderTodos(newOrder);
    } catch {
      queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    }
  };

  return { reorder, persistReorder };
}

export function useReorderLists() {
  const queryClient = useQueryClient();

  const reorder = (newOrder: string[]) => {
    queryClient.setQueryData(listKeys.all, (old: TodoList[] | undefined) => {
      if (!old) return old;
      const orderMap = new Map(newOrder.map((id, i) => [id, i]));
      const reordered = [...old].sort((a, b) => {
        const aOrder = orderMap.get(a.id) ?? 9999;
        const bOrder = orderMap.get(b.id) ?? 9999;
        return aOrder - bOrder;
      });
      const updatedResult = reordered.map((list, index) => ({
        ...list,
        order: index,
      }));
      return updatedResult;
    });
  };

  const persistReorder = async (newOrder: string[]) => {
    if (newOrder.length === 0) return;
    try {
      await todosApi.reorderLists(newOrder);
    } catch {
      queryClient.invalidateQueries({ queryKey: listKeys.all });
    }
  };

  return { reorder, persistReorder };
}
