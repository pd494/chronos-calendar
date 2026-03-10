import { create } from 'zustand'

interface TodoState {
  selectedListId: string
  editingListId: string | null
  setSelectedList: (id: string) => void
  startEditingList: (id: string) => void
  clearEditingList: () => void
}


export const useTodoStore = create<TodoState>((set) => ({
  selectedListId: 'all',
  editingListId: null,

  setSelectedList: (id) => set({ selectedListId: id }),
  startEditingList: (id) => set({ editingListId: id }),
  clearEditingList: () => set({ editingListId: null }),
}))
