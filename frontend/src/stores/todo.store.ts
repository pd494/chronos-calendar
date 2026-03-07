import { create } from 'zustand'

interface TodoState {
  selectedListId: string
  selectedTodoId: string | null
  editingListId: string | null
  setSelectedList: (id: string) => void
  selectTodo: (id: string | null) => void
  startEditingList: (id: string) => void
  clearEditingList: () => void
}


export const useTodoStore = create<TodoState>((set) => ({
  selectedListId: 'all',
  selectedTodoId: null,
  editingListId: null,

  setSelectedList: (id) => set({ selectedListId: id }),
  selectTodo: (id) => set({ selectedTodoId: id }),
  startEditingList: (id) => set({ editingListId: id }),
  clearEditingList: () => set({ editingListId: null }),
}))
