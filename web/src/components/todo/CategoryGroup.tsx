import { useState, useRef, useEffect } from 'react'
import { TaskList } from './TaskItem'
import type { Todo, TodoList } from '../../types'

interface CategoryGroupProps {
  category: TodoList
  tasks: Todo[]
  onToggleComplete: (task: Todo, isInCompletedList: boolean) => void
  onDelete?: (task: Todo) => void
  onAddTaskToCategory: (text: string, categoryId: string) => void
  onReorderTasks?: (newOrder: string[]) => void
  onReorderTasksEnd?: () => void
}

export function CategoryGroup({
  category,
  tasks,
  onToggleComplete,
  onDelete,
  onAddTaskToCategory,
  onReorderTasks,
  onReorderTasksEnd,
}: CategoryGroupProps) {
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

  const categoryIcon = category.color
    ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} />
    : null

  const isInCompletedList = category.name === 'Completed'

  return (
    <div className="category-group mb-3 rounded-lg">
      <div className="flex items-center justify-between relative z-10">
        <div
          className="category-header flex items-center py-2.5 pl-2 pr-4 bg-transparent cursor-pointer rounded-2xl transition-colors duration-200 relative flex-grow hover:bg-black/5"
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
          <span className="mr-3 text-base w-[18px] text-center flex items-center justify-center flex-shrink-0">{categoryIcon}</span>
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
        <div className="pl-2 relative z-0">
          <TaskList
            tasks={tasks}
            categoryColor={category.color}
            onToggleComplete={(task) => onToggleComplete(task, isInCompletedList)}
            onDelete={onDelete}
            isInCompletedList={isInCompletedList}
            onReorder={onReorderTasks}
            onReorderEnd={onReorderTasksEnd}
          />

          {isEditingNewTask && (
            <div className="task-item flex items-center py-0.5 pr-4 mb-0.5 rounded-[20px] relative bg-black/[0.02]">
              <div className="w-[18px] h-[18px] border-2 border-[#8e8e93] rounded-md mr-3 flex justify-center items-center" />
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
