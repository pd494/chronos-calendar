import { create } from 'zustand'

interface TodoState {
  // Selected list for filtering
  selectedListId: string

  // Selected todo for editing
  selectedTodoId: string | null

  // Actions
  setSelectedList: (id: string) => void
  selectTodo: (id: string | null) => void
}


export const useTodoStore = create<TodoState>((set) => ({
  selectedListId: 'all',
  selectedTodoId: null,

  setSelectedList: (id) => set({ selectedListId: id }),
  selectTodo: (id) => set({ selectedTodoId: id }),
}))
