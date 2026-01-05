import { useState, useRef, useEffect, useMemo, forwardRef } from 'react'
import { Settings, LogOut, User } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, defaultAnimateLayoutChanges, AnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTodoStore, useCalendarStore } from '../../stores'
import { useTodos, useTodoLists, useCreateTodo, useToggleTodo, useDeleteTodo, useUpdateTodo, useReorderTodos } from '../../hooks'
import { useAuth } from '../../contexts/AuthContext'
import { Todo, TodoList } from '../../types'

const CATEGORY_COLORS = ['#CDEDFD', '#D3D3FF', '#f67f9cff', '#FFFFC5', '#D4F4DD', '#B8E6E6', '#FFDAB3', '#E8D6C0']

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args
  if (isSorting || wasDragging) return false
  return defaultAnimateLayoutChanges(args)
}

interface TaskItemContentProps {
  task: Todo
  onToggleComplete: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
  style?: React.CSSProperties
  attributes?: React.HTMLAttributes<HTMLElement>
  listeners?: React.DOMAttributes<HTMLElement>
  isDragging?: boolean
}

const TaskItemContent = forwardRef<HTMLDivElement, TaskItemContentProps>(
  ({ task, onToggleComplete, categoryColor, isInCompletedList, style, attributes, listeners, isDragging }, ref) => {
    const [isChecking, setIsChecking] = useState(false)
    const checkboxRef = useRef<HTMLDivElement>(null)

    const handleCheckboxClick = () => {
      if (!task.completed || isInCompletedList) {
        setIsChecking(true)
        if (checkboxRef.current) {
          checkboxRef.current.classList.add('checking')
        }
        setTimeout(() => {
          if (checkboxRef.current) {
            checkboxRef.current.classList.remove('checking')
          }
          setIsChecking(false)
          onToggleComplete(task)
        }, 30)
      } else {
        onToggleComplete(task)
      }
    }

    return (
      <div
        ref={ref}
        style={style}
        className={`task-item flex items-center py-2.5 pr-4 mb-1.5 rounded-[20px] relative bg-white ${task.completed ? 'completed' : ''} ${isDragging ? 'opacity-40' : ''} ${style?.zIndex ? 'shadow-xl' : ''}`}
        data-id={task.id}
        data-task-id={task.id}
        data-task-title={task.title || ''}
        data-task-color={categoryColor || ''}
      >
        <div
          ref={checkboxRef}
          className={`task-checkbox w-[18px] h-[18px] border-2 border-[#8e8e93] rounded-md mr-3 flex justify-center items-center text-[#2c2c2e] transition-all duration-150 relative overflow-hidden cursor-pointer
            ${task.completed ? 'bg-[#D4F4DD] border-[#86EFAC]' : ''}
            ${isChecking ? 'bg-[#D4F4DD] border-[#86EFAC] checking' : ''}`}
          onClick={handleCheckboxClick}
        >
          {(task.completed || isChecking) ? <span className="text-green-600">✓</span> : <span></span>}
        </div>
        <div className="flex flex-row items-center gap-2 flex-1 px-3 overflow-hidden">
          <div className={`flex-1 p-0 overflow-hidden text-ellipsis whitespace-nowrap ${task.completed ? 'line-through text-[#8e8e93]' : ''}`}>
            {task.title}
          </div>
        </div>
        <div
          className="task-drag-handle cursor-grab active:cursor-grabbing touch-none text-gray-400"
          {...attributes}
          {...listeners}
        >
          <span>⋮⋮</span>
        </div>
      </div>
    )
  }
)

TaskItemContent.displayName = 'TaskItemContent'

interface TaskItemProps {
  task: Todo
  onToggleComplete: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
}

function TaskItem({ task, onToggleComplete, categoryColor, isInCompletedList }: TaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    animateLayoutChanges,
    data: {
      type: 'task',
      id: task.id,
      task,
    },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : undefined,
  }

  return (
    <TaskItemContent
      ref={setNodeRef}
      task={task}
      onToggleComplete={onToggleComplete}
      categoryColor={categoryColor}
      isInCompletedList={isInCompletedList}
      style={style}
      attributes={attributes}
      listeners={listeners}
      isDragging={isDragging}
    />
  )
}

interface CategoryGroupProps {
  category: TodoList
  tasks: Todo[]
  onToggleComplete: (task: Todo, isInCompletedList: boolean) => void
  onAddTaskToCategory: (text: string, categoryId: string) => void
}

function CategoryGroup({ category, tasks, onToggleComplete, onAddTaskToCategory }: CategoryGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(category.name === 'Completed')
  const [isEditingNewTask, setIsEditingNewTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const newTaskInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingNewTask && newTaskInputRef.current) {
      newTaskInputRef.current.focus()
    }
  }, [isEditingNewTask])

  const handleAddTask = () => {
    if (newTaskText.trim()) {
      onAddTaskToCategory(newTaskText, category.id)
      setNewTaskText('')
      setIsEditingNewTask(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTask()
    } else if (e.key === 'Escape') {
      setIsEditingNewTask(false)
      setNewTaskText('')
    }
  }

  const getCategoryIcon = () => {
    if (category.color) {
      return <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: category.color }}></span>
    }
    return '⬤'
  }

  return (
    <div className="category-group mb-3 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between relative">
        <div
          className="category-header flex items-center py-2.5 px-4 bg-transparent cursor-pointer rounded-2xl transition-colors duration-200 relative flex-grow hover:bg-black/5"
          role="button"
          tabIndex={0}
          onClick={() => setIsCollapsed(prev => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsCollapsed(prev => !prev)
            }
          }}
        >
          <span className="mr-3 text-base w-4 text-center flex items-center justify-center flex-shrink-0">{getCategoryIcon()}</span>
          <span className="flex-grow font-medium text-[15px]">{category.name}</span>
          <span className="bg-black/10 rounded-xl py-0.5 px-2 text-xs min-w-[28px] text-center mr-2">{tasks.length}</span>
          <span className={`text-[10px] transition-transform duration-200 ml-2 w-3 text-center flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>
            ▼
          </span>
        </div>
        {category.name !== 'Completed' ? (
          <button
            className="w-6 h-6 rounded-full bg-transparent border-none text-[#666] text-base flex items-center justify-center cursor-pointer p-0 mr-4 z-[2] hover:bg-black/5"
            onClick={(e) => {
              e.stopPropagation()
              setIsCollapsed(false)
              setNewTaskText('')
              setIsEditingNewTask(true)
            }}
          >
            +
          </button>
        ) : (
          <span className="w-6 h-6 mr-4" aria-hidden="true" />
        )}
      </div>

      {!isCollapsed && (
        <div className="pl-2">
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                categoryColor={category.color}
                onToggleComplete={(t) => onToggleComplete(t, category.name === 'Completed')}
                isInCompletedList={category.name === 'Completed'}
              />
            ))}
          </SortableContext>

          {isEditingNewTask && (
            <div className="task-item flex items-center py-2.5 pr-4 mb-1.5 rounded-[20px] relative bg-black/[0.02]">
              <div className="w-[18px] h-[18px] border-2 border-[#8e8e93] rounded-md mr-3 flex justify-center items-center">
                <span></span>
              </div>
              <div className="flex-1 px-3">
                <input
                  ref={newTaskInputRef}
                  type="text"
                  className="w-full border-none bg-transparent outline-none text-inherit font-inherit"
                  placeholder="Type a new task..."
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleAddTask}
                  autoFocus
                />
              </div>
              <div className="task-drag-handle cursor-grab text-gray-400">
                <span>⋮⋮</span>
              </div>
            </div>
          )}

          {tasks.length === 0 && !isEditingNewTask && (
            <div className="flex justify-center items-center py-[15px] px-4 text-[#8e8e93] text-[15px] italic">
              <p>No tasks in this category</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskInputProps {
  onAddTask: (text: string) => void
  activeCategory: string
  categoryIcon: React.ReactNode
  categoryCount?: number
  isEditable?: boolean
  showNewTaskInput?: boolean
  showAddButton?: boolean
  showCategoryHeader?: boolean
  placeholder?: string
  onCategoryRenamed?: (oldName: string, newName: string) => void
  categoryColor?: string
  onColorChange?: (color: string) => void
}

function TaskInput({
  onAddTask,
  activeCategory,
  categoryIcon,
  categoryCount,
  isEditable = false,
  showNewTaskInput = true,
  showCategoryHeader = true,
  placeholder = 'new meeting @ 2pm',
  categoryColor,
  onColorChange,
}: TaskInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [isEditingCategory, setIsEditingCategory] = useState(false)
  const [categoryNameEdit, setCategoryNameEdit] = useState(activeCategory)
  const [editingIcon, setEditingIcon] = useState<string | null>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const currentIcon = editingIcon ?? categoryColor

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      onAddTask(inputValue)
      setInputValue('')
    }
  }

  const toggleColorPicker = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowColorPicker(!showColorPicker)
  }

  const handleCategoryEdit = () => {
    setCategoryNameEdit(activeCategory)
    setIsEditingCategory(true)
    setEditingIcon(categoryColor || null)
    setTimeout(() => categoryInputRef.current?.focus(), 10)
  }

  const saveCategoryEdit = () => {
    setIsEditingCategory(false)
    setEditingIcon(null)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="my-3.5 mb-5">
      {showCategoryHeader && (
        <div className={`flex items-center justify-between px-2 pl-[7px] cursor-default bg-transparent ${activeCategory === 'All' ? 'pb-1' : 'pb-2'}`}>
          <div className="flex items-center gap-4 cursor-default">
            {isEditable ? (
              <div className="relative flex items-center" ref={colorPickerRef}>
                <button
                  type="button"
                  onClick={toggleColorPicker}
                  className="w-4 h-4 rounded-full border border-black/10 cursor-pointer inline-flex items-center justify-center shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
                  style={{ backgroundColor: currentIcon || '#3B82F6' }}
                />
                {showColorPicker && (
                  <div className="absolute top-[26px] left-[-2px] p-1.5 bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col gap-1 z-30">
                    {CATEGORY_COLORS.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={`w-4 h-4 rounded-full border cursor-pointer p-0 ${currentIcon === color ? 'border-black' : 'border-black/10'}`}
                        style={{ backgroundColor: color }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingIcon(color)
                          setShowColorPicker(false)
                          onColorChange?.(color)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              categoryIcon && <span className="mr-2.5 text-base flex items-center gap-1.5">{categoryIcon}</span>
            )}
            {isEditable && isEditingCategory ? (
              <input
                ref={categoryInputRef}
                type="text"
                value={categoryNameEdit}
                onChange={(e) => setCategoryNameEdit(e.target.value)}
                className="text-base font-semibold text-black border-none bg-transparent outline-none p-0 m-0 w-auto min-w-[20px] max-w-[200px]"
                onBlur={saveCategoryEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCategoryEdit()
                  if (e.key === 'Escape') {
                    setCategoryNameEdit(activeCategory)
                    setIsEditingCategory(false)
                    setEditingIcon(null)
                  }
                }}
              />
            ) : (
              <span className="text-base font-semibold text-black">{activeCategory}</span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {categoryCount !== undefined && <span className="text-sm text-gray-500 font-medium mr-2">{categoryCount}</span>}
            {isEditable && !isEditingCategory && (
              <button
                onClick={handleCategoryEdit}
                className="w-5 h-5 rounded-full bg-transparent border-none text-gray-500 text-lg flex items-center justify-center cursor-pointer p-2 -m-2 hover:bg-black/5 ml-2"
              >
                ✎
              </button>
            )}
          </div>
        </div>
      )}
      {showNewTaskInput && (
        <form
          ref={formRef}
          className={`flex items-center px-[18px] py-2.5 bg-[#f8f8fa] rounded-xl border border-gray-200 relative shadow-sm overflow-x-hidden ${activeCategory === 'All' ? 'mt-2.5 -mt-[22px] rounded-[13px] px-4 py-3 bg-[#f5f5f7]' : 'mt-2.5'}`}
          onSubmit={handleSubmit}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={placeholder}
            className="task-input-field flex-1 border-none bg-transparent py-1.5 pr-3 pl-[9px] text-[15px] outline-none text-black font-normal h-[26px] min-w-0 text-ellipsis whitespace-nowrap overflow-hidden placeholder:text-gray-400"
          />
          <span className="absolute right-3 text-xs text-black bg-gray-200 px-1.5 py-0.5 rounded font-medium">N</span>
        </form>
      )}
    </div>
  )
}

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const inboxList = useMemo(() => lists.find(l => l.name === 'Inbox'), [lists])
  const completedList = useMemo(() => lists.find(l => l.name === 'Completed'), [lists])
  const activeCategory = useMemo(() => {
    if (!selectedListId || selectedListId === 'all') return 'All'
    const list = lists.find(l => l.id === selectedListId)
    return list?.name || 'All'
  }, [selectedListId, lists])

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const activeTodo = useMemo(() => 
    allTodos.find(t => t.id === activeId), 
    [allTodos, activeId]
  )

  useEffect(() => {
    if (!showUserMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showUserMenu])

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

  const displayLists = useMemo(() => lists, [lists])

  const renderCategoryIcon = () => {
    if (activeCategory === 'All') return '★'
    const list = lists.find(l => l.name === activeCategory)
    if (list?.color) {
      return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: list.color }} />
    }
    return null
  }

  const isCustomCategory = useMemo(() => {
    return !['All', 'Today', 'Inbox', 'Completed'].includes(activeCategory)
  }, [activeCategory])

  const activeCategoryList = useMemo(() => {
    return lists.find(l => l.name === activeCategory)
  }, [lists, activeCategory])

  return (
    <aside className="sidebar min-w-[50px] h-full bg-white border-r border-gray-200 flex flex-col overflow-hidden relative shadow-sm pl-4 pr-2">
      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeCategory !== 'All' ? (
          <TaskInput
            key={activeCategory}
            onAddTask={handleAddTask}
            activeCategory={activeCategory}
            categoryIcon={renderCategoryIcon()}
            categoryCount={filteredTasks.length}
            isEditable={isCustomCategory}
            showNewTaskInput={true}
            showAddButton={true}
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
            showAddButton={false}
            placeholder="New Todo "
          />
        )}

        {/* Task List */}
        {activeCategory === 'All' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="task-list flex flex-col w-full font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif] min-h-[100px] task-list-all" data-view="all">
              {displayLists.map((list, index) => {
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
            <DragOverlay dropAnimation={null}>
              {activeTodo ? (
                <div className="shadow-2xl rounded-[20px]">
                  <TaskItemContent
                    task={activeTodo}
                    onToggleComplete={() => {}}
                    categoryColor={lists.find(l => l.id === activeTodo.listId)?.color}
                    isDragging={false}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
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
            <DragOverlay dropAnimation={null}>
              {activeTodo ? (
                <div className="shadow-2xl rounded-[20px]">
                  <TaskItemContent
                    task={activeTodo}
                    onToggleComplete={() => {}}
                    categoryColor={activeCategoryList?.color}
                    isDragging={false}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Bottom Profile Section */}
      {user && (
        <div className="mt-auto py-3 px-3 border-t border-gray-200">
          <div className="relative" ref={userMenuRef}>
            {showUserMenu && (
              <div
                className="absolute left-0 bottom-full mb-3 bg-white border border-gray-200 rounded-2xl shadow-[0_10px_50px_rgba(0,0,0,0.15)] overflow-hidden z-[100] modal-fade-in"
                style={{ width: '100%' }}
              >
                {/* Profile Header in Menu */}
                <div className="p-4 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50">
                  <div className="h-10 w-10 rounded-full overflow-hidden flex-shrink-0 shadow-sm border border-white">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
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

                {/* Menu Items */}
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
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name || 'User'}
                    className="h-full w-full object-cover"
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
