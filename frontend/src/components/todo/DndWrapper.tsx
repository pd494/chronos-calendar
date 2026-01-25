import { ReactNode } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core'
import { TaskItemContent } from './TaskItem'
import type { Todo, TodoList } from '../../types'

export interface DndWrapperProps {
  children: ReactNode
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  activeTodo: Todo | undefined
  activeTodoList: TodoList | undefined
}

export function DndWrapper({ children, onDragStart, onDragEnd, activeTodo, activeTodoList }: DndWrapperProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeTodo ? (
          <div className="shadow-2xl rounded-[20px]">
            <TaskItemContent
              task={activeTodo}
              onToggleComplete={() => {}}
              categoryColor={activeTodoList?.color}
              isDragging={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
