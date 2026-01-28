import { useState, useRef, forwardRef } from 'react'
import { useSortable, AnimateLayoutChanges, defaultAnimateLayoutChanges } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Todo } from '../../types'

const animateLayoutChanges: AnimateLayoutChanges = (args) => {
  const { isSorting, wasDragging } = args
  if (isSorting || wasDragging) return false
  return defaultAnimateLayoutChanges(args)
}

export interface TaskItemContentProps {
  task: Todo
  onToggleComplete: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
  style?: React.CSSProperties
  attributes?: React.HTMLAttributes<HTMLElement>
  listeners?: React.DOMAttributes<HTMLElement>
  isDragging?: boolean
}

export const TaskItemContent = forwardRef<HTMLDivElement, TaskItemContentProps>(
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
          {(task.completed || isChecking) && <span className="text-green-600">✓</span>}
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

export interface TaskItemProps {
  task: Todo
  onToggleComplete: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
}

export function TaskItem({ task, onToggleComplete, categoryColor, isInCompletedList }: TaskItemProps) {
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
