import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import type { Todo } from '../../types'

export interface TaskItemProps {
  task: Todo
  onToggleComplete: (task: Todo) => void
  onDelete?: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
  onDragEnd?: () => void
  dragControls?: ReturnType<typeof useDragControls>
}

export interface TaskListProps {
  tasks: Todo[]
  onToggleComplete: (task: Todo) => void
  onDelete?: (task: Todo) => void
  categoryColor?: string
  isInCompletedList?: boolean
  onReorder?: (newOrder: string[]) => void
  onReorderEnd?: () => void
}

function TaskItemBody({
  task,
  onToggleComplete,
  onDelete,
  categoryColor,
  isInCompletedList,
  dragControls,
}: TaskItemProps) {
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
      return
    }

    onToggleComplete(task)
  }

  return (
    <div
      className={`task-item flex items-center pr-4 rounded-[20px] relative bg-white ${
        isInCompletedList ? 'py-1.5 mb-1.5' : 'py-0.5 mb-0.5'
      }`}
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
      {isInCompletedList ? (
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-50"
            onClick={() => onDelete?.(task)}
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div
          className="task-drag-handle text-gray-400 cursor-grab active:cursor-grabbing p-2 -mr-2 touch-none select-none"
          onPointerDown={(event) => {
            event.preventDefault()
            dragControls.start(event)
          }}
        >
          <span>⋮⋮</span>
        </div>
      )}
    </div>
  )
}

export function TaskItem({
  onDragEnd,
  ...props
}: TaskItemProps) {
  const dragControls = useDragControls()

  return (
    <Reorder.Item
      value={props.task.id}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
    >
      <TaskItemBody {...props} dragControls={dragControls} />
    </Reorder.Item>
  )
}

export function TaskList({
  tasks,
  onToggleComplete,
  onDelete,
  categoryColor,
  isInCompletedList,
  onReorder,
  onReorderEnd,
}: TaskListProps) {
  const items = tasks.map((task) => (
    <TaskItem
      key={task.id}
      task={task}
      onToggleComplete={onToggleComplete}
      onDelete={onDelete}
      categoryColor={categoryColor}
      isInCompletedList={isInCompletedList}
      onDragEnd={onReorderEnd}
    />
  ))

  if (!onReorder || tasks.length === 0) {
    return <>{items}</>
  }

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={tasks.map((task) => task.id)}
      onReorder={onReorder}
      className="flex flex-col"
      style={{ overflowAnchor: 'none' }}
    >
      {items}
    </Reorder.Group>
  )
}
