import { useState, useRef, useEffect, useMemo, useCallback, type SyntheticEvent } from 'react'
import { Settings, LogOut, User } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useTodoStore, useCalendarStore } from '../../stores'
import { useTodos, useTodoLists, useCreateTodo, useToggleTodo, useDeleteTodo, useUpdateTodo, useReorderTodos, useClickOutside } from '../../hooks'
import { useAuth } from '../../contexts/AuthContext'
import { TaskItem } from './TaskItem'
import { CategoryGroup } from './CategoryGroup'
import { TaskInput } from './TaskInput'
import { DndWrapper } from './DndWrapper'
import type { Todo } from '../../types'

export function TodoSidebar() {
  const { selectedListId } = useTodoStore()
  const { setShowSettings } = useCalendarStore()
  const { user, logout } = useAuth()
  const { data: allTodos = [] } = useTodos()
  const { data: lists = [] } = useTodoLists()
  const createTodo = useCreateTodo()
  const toggleTodo = useToggleTodo()
  const deleteTodo = useDeleteTodo()
  const updateTodo = useUpdateTodo()
  const { reorder } = useReorderTodos()

  const inboxList = useMemo(() => lists.find(l => l.name === 'Inbox'), [lists])
  const completedList = useMemo(() => lists.find(l => l.name === 'Completed'), [lists])
  const activeCategory = useMemo(() => {
    if (!selectedListId || selectedListId === 'all') return 'All'
    const list = lists.find(l => l.id === selectedListId)
    return list?.name || 'All'
  }, [selectedListId, lists])

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const handleAvatarError = (e: SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none'
    setAvatarError(true)
  }

  const activeTodo = useMemo(() =>
    allTodos.find(t => t.id === activeId),
    [allTodos, activeId]
  )

  const closeUserMenu = useCallback(() => setShowUserMenu(false), [])
  useClickOutside(userMenuRef, closeUserMenu, showUserMenu)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n') return
      const target = event.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const mainInput = document.querySelector('.task-input-field') as HTMLInputElement
      if (!mainInput) return
      event.preventDefault()
      mainInput.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleAddTask = async (text: string) => {
    const targetListId = !selectedListId || selectedListId === 'all' ? inboxList?.id : selectedListId
    if (!targetListId) return
    await createTodo.mutateAsync({ title: text, listId: targetListId })
  }

  const handleAddTaskToCategory = async (text: string, categoryId: string) => {
    await createTodo.mutateAsync({ title: text, listId: categoryId })
  }

  const handleToggleComplete = (todo: Todo, isInCompletedList: boolean = false) => {
    if (isInCompletedList) {
      deleteTodo.mutate(todo.id)
    } else if (!todo.completed && completedList) {
      toggleTodo.mutate({ id: todo.id, completed: true })
      updateTodo.mutate({ id: todo.id, todo: { listId: completedList.id } })
    } else {
      toggleTodo.mutate({ id: todo.id, completed: !todo.completed })
    }
  }

  const filteredTasks = useMemo(() => {
    const todos = !selectedListId || selectedListId === 'all'
      ? allTodos
      : allTodos.filter(t => t.listId === selectedListId)
    return [...todos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [allTodos, selectedListId])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    reorder(String(active.id), String(over.id))
  }

  const renderCategoryIcon = () => {
    if (activeCategory === 'All') return '★'
    const list = lists.find(l => l.name === activeCategory)
    if (list?.color) {
      return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: list.color }} />
    }
    return null
  }

  const isCustomCategory = !['All', 'Today', 'Inbox', 'Completed'].includes(activeCategory)

  const activeCategoryList = lists.find(l => l.name === activeCategory)

  return (
    <aside className="sidebar min-w-[50px] h-full bg-white border-r border-gray-200 flex flex-col overflow-hidden relative shadow-sm pl-4 pr-2">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeCategory !== 'All' ? (
          <TaskInput
            key={activeCategory}
            onAddTask={handleAddTask}
            activeCategory={activeCategory}
            categoryIcon={renderCategoryIcon()}
            categoryCount={filteredTasks.length}
            isEditable={isCustomCategory}
            showNewTaskInput
            categoryColor={activeCategoryList?.color}
          />
        ) : (
          <div className="flex items-center justify-between pt-4 pr-[18px] pb-2 pl-[3px] mb-2 relative">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5">{renderCategoryIcon()}</span>
              <span className="text-xl font-semibold text-black">All</span>
            </div>
          </div>
        )}

        {activeCategory === 'All' && (
          <TaskInput
            key="all-task-input"
            onAddTask={handleAddTask}
            activeCategory={activeCategory}
            categoryIcon={renderCategoryIcon()}
            showCategoryHeader={false}
            placeholder="New Todo "
          />
        )}

        {activeCategory === 'All' ? (
          <DndWrapper
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            activeTodo={activeTodo}
            activeTodoList={lists.find(l => l.id === activeTodo?.listId)}
          >
            <div className="task-list flex flex-col w-full font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] min-h-[100px] task-list-all" data-view="all">
              {lists.map((list, index) => {
                const listTodos = allTodos
                  .filter(t => t.listId === list.id)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                return (
                  <div key={list.id} className={index > 0 ? 'mt-[14.4px]' : ''}>
                    <CategoryGroup
                      category={list}
                      tasks={listTodos}
                      onToggleComplete={handleToggleComplete}
                      onAddTaskToCategory={handleAddTaskToCategory}
                    />
                  </div>
                )
              })}

              {allTodos.length === 0 && (
                <div className="flex justify-center items-center py-6 px-4 text-[#8e8e93] text-[15px] italic">
                  <p>No tasks</p>
                </div>
              )}
            </div>
          </DndWrapper>
        ) : (
          <DndWrapper
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            activeTodo={activeTodo}
            activeTodoList={activeCategoryList}
          >
            <SortableContext items={filteredTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="task-list flex flex-col w-full font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] min-h-[100px] pl-[4px]">
                {filteredTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggleComplete={(t) => handleToggleComplete(t, activeCategory === 'Completed')}
                    categoryColor={activeCategoryList?.color}
                    isInCompletedList={activeCategory === 'Completed'}
                  />
                ))}

                {filteredTasks.length === 0 && (
                  <div className="flex justify-center items-center py-6 px-4 text-[#8e8e93] text-[15px] italic">
                    <p>No tasks in this category</p>
                  </div>
                )}
              </div>
            </SortableContext>
          </DndWrapper>
        )}
      </div>

      {user && (
        <div className="mt-auto py-3 px-3 border-t border-gray-200">
          <div className="relative" ref={userMenuRef}>
            {showUserMenu && (
              <div
                className="absolute left-0 bottom-full mb-3 bg-white border border-gray-200 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.15)] overflow-hidden z-[100] modal-fade-in"
                style={{ width: '100%' }}
              >
                <div className="p-4 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50">
                  <div className="h-10 w-10 rounded-full overflow-hidden flex-shrink-0 shadow-sm border border-white">
                    {user.avatar_url && !avatarError ? (
                      <img
                        src={user.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={handleAvatarError}
                      />
                    ) : (
                      <div className="h-full w-full bg-gray-200 flex items-center justify-center text-gray-500">
                        <User size={18} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">
                      {user.name || 'User'}
                    </div>
                  </div>
                </div>

                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowSettings(true)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                  >
                    <Settings className="h-4 w-4 text-gray-500" />
                    <span className="font-medium">Settings</span>
                  </button>

                  <div className="h-px bg-gray-100 my-2 mx-4" />

                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false)
                      logout()
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="font-medium">Log out</span>
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowUserMenu((p) => !p)}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-gray-100 transition-all group text-left"
              title={user.name || 'Account'}
            >
              <div className="h-9 w-9 rounded-full overflow-hidden flex-shrink-0 shadow-sm border border-gray-100 group-hover:ring-2 group-hover:ring-gray-200 transition-all">
                {user.avatar_url && !avatarError ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name || 'User'}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={handleAvatarError}
                  />
                ) : (
                  <div className="h-full w-full bg-gray-200 flex items-center justify-center text-gray-500">
                    <User size={16} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900 truncate leading-tight">
                  {user.name || 'User'}
                </div>
              </div>
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
