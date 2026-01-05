import { useState, useRef, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, Modifier } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { useTodoStore } from '../../stores'
import { useTodoLists, useCreateList, useDeleteList, useReorderLists } from '../../hooks'

const restrictToHorizontalAxis: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return { ...transform, y: 0 }
  }

  const minX = containerNodeRect.left - draggingNodeRect.left
  const maxX = containerNodeRect.right - draggingNodeRect.right

  return {
    ...transform,
    x: Math.min(Math.max(transform.x, minX), maxX),
    y: 0,
  }
}

const CATEGORY_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#FBBF24', '#10B981', '#14B8A6', '#F97316', '#EF4444']
const ALL_CATEGORY_COLOR = '#1a1a1a'
const PROTECTED_CATEGORY_NAMES = new Set(['Today', 'Inbox', 'Completed'])

interface Category {
  id: string
  name: string
  color: string
  count?: number
}

interface SortableCategoryTabProps {
  category: Category
  isActive: boolean
  onCategoryChange: (name: string) => void
  onContextMenu: (e: React.MouseEvent, category: Category) => void
  isHovered: boolean
  setIsHovered: (value: boolean) => void
  inHeader?: boolean
}

function SortableCategoryTab({
  category,
  isActive,
  onCategoryChange,
  onContextMenu,
  isHovered,
  setIsHovered,
  inHeader = true,
}: SortableCategoryTabProps) {
  const isDraggable = category.id !== 'all'
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: !isDraggable })

  const style = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  }

  const headerTabShell = 'flex items-center gap-1 rounded-[7px] font-medium whitespace-nowrap flex-shrink-0 cursor-default transition-colors'
  const headerTabSizing = inHeader ? 'px-[8px] text-[12px] leading-[14px]' : 'h-[26px] px-2.5 text-xs'
  const nameTextSize = inHeader ? 'text-[12px]' : 'text-[15px]'
  const iconCircleSize = inHeader ? 'w-[8px] h-[8px] mr-1.5' : 'w-2 h-2 mr-2'
  const countSize = inHeader ? 'text-[11px]' : 'text-xs'

  const tabClass = `${headerTabShell} ${headerTabSizing} ${inHeader ? ((isActive || isHovered) ? 'py-[6px]' : 'py-[2px]') : ''} ${isActive ? 'text-gray-900 font-semibold' : 'text-gray-500'
    } ${inHeader && (isActive || isHovered) ? 'bg-gray-100' : (!isActive ? 'hover:bg-black/5' : '')}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-category-id={category.id}
      className={tabClass}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => category.name && onCategoryChange(category.id)}
      onContextMenu={(e) => onContextMenu(e, category)}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
    >
      <span className={`rounded-full flex-shrink-0 ${iconCircleSize}`} style={{ backgroundColor: category.color }} />
      <span className={`${nameTextSize} font-normal text-black whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'font-semibold' : ''}`}>
        {category.name}
      </span>
      {category.count !== undefined && (
        <span className={`${countSize} text-gray-400 ml-1`}>{category.count}</span>
      )}
    </div>
  )
}

export function CategoryTabs() {
  const { selectedListId, setSelectedList } = useTodoStore()
  const { data: customLists = [] } = useTodoLists()
  const createList = useCreateList()
  const deleteList = useDeleteList()
  const { reorder } = useReorderLists()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const [isAddingCategory, setIsAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [selectedColor, setSelectedColor] = useState('#3B82F6')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ category: Category; x: number; y: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const categories: Category[] = useMemo(() => [
    { id: 'all', name: 'All', color: ALL_CATEGORY_COLOR },
    ...customLists.map(l => ({ id: l.id, name: l.name, color: l.color || '#3B82F6' })),
  ], [customLists])

  useEffect(() => {
    if (isAddingCategory && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAddingCategory])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleStartAddCategory = () => {
    setIsAddingCategory(true)
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  const handleSaveCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) return
    await createList.mutateAsync({ name: trimmed, color: selectedColor })
    setNewCategoryName('')
    setSelectedColor('#3B82F6')
    setIsAddingCategory(false)
  }

  const handleCancelAddCategory = () => {
    setIsAddingCategory(false)
    setNewCategoryName('')
    setSelectedColor('#3B82F6')
    setShowColorPicker(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveCategory()
    else if (e.key === 'Escape') handleCancelAddCategory()
  }

  const toggleColorPicker = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowColorPicker(!showColorPicker)
  }

  const handleColorSelect = (color: string) => {
    setSelectedColor(color)
    setShowColorPicker(false)
  }

  const handleContextMenu = (e: React.MouseEvent, category: Category) => {
    e.preventDefault()
    if (category.id === 'all' || PROTECTED_CATEGORY_NAMES.has(category.name)) return
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({ category, x: rect.left + window.pageXOffset, y: rect.bottom + window.pageYOffset + 4 })
  }

  const handleDeleteCategory = async (category: Category) => {
    if (!category?.id) return
    await deleteList.mutateAsync(category.id)
    if (selectedListId === category.id) setSelectedList('all')
    setContextMenu(null)
  }

  const handleCategoryChange = (categoryId: string) => {
    setSelectedList(categoryId)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id))
    }
  }

  const categoryIds = useMemo(() => categories.map(c => c.id), [categories])

  const inHeader = true
  const iconCircleSize = 'w-[10px] h-[10px] mr-1.5'

  return (
    <div className="flex flex-col w-full overflow-visible relative h-full items-center bg-transparent pt-0.5 whitespace-nowrap">
      <div className={`flex items-center w-full max-w-full relative bg-transparent ${isAddingCategory ? 'pl-2 pr-1' : 'px-3'} py-2 h-full gap-1 flex-nowrap justify-start overflow-visible`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToHorizontalAxis]}>
          <SortableContext items={categoryIds} strategy={horizontalListSortingStrategy}>
            <div
              className={`flex gap-2 flex-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap pr-2 scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${isAddingCategory ? 'hidden' : ''}`}
              ref={listRef}
            >
              {categories.map(category => (
                <SortableCategoryTab
                  key={category.id}
                  category={category}
                  isActive={selectedListId === category.id || (!selectedListId && category.id === 'all')}
                  onCategoryChange={handleCategoryChange}
                  onContextMenu={handleContextMenu}
                  isHovered={hoveredId === category.id}
                  setIsHovered={(val) => setHoveredId(val ? category.id : null)}
                  inHeader={inHeader}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {isAddingCategory ? (
          <div className={`flex items-center gap-2 px-2 h-8 flex-1 min-w-0 w-full max-w-full rounded-md z-[15] animate-[slideIn_0.2s_ease-out] border border-[#e5e5ea] bg-white`}>
            <div className="relative flex items-center ml-[7px]" ref={colorPickerRef}>
              <button
                type="button"
                onClick={toggleColorPicker}
                className={`rounded-full flex-shrink-0 border border-black/10 cursor-pointer p-0 block ${iconCircleSize}`}
                style={{ backgroundColor: selectedColor, borderRadius: '50%', aspectRatio: '1 / 1', lineHeight: 0 }}
                aria-label="Pick category color"
              />
              {showColorPicker && ReactDOM.createPortal(
                <div
                  className="fixed p-1.5 bg-white border border-gray-200 rounded-lg shadow-lg flex flex-col gap-1 z-[9999] modal-fade-in"
                  style={{
                    top: colorPickerRef.current ? colorPickerRef.current.getBoundingClientRect().bottom + 4 : 0,
                    left: colorPickerRef.current ? (() => {
                      const rect = colorPickerRef.current.getBoundingClientRect()
                      const circleCenterX = rect.left + (rect.width / 2)
                      const dropdownWidth = 30
                      return circleCenterX - (dropdownWidth / 2)
                    })() : 0,
                  }}
                >
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      type="button"
                      key={color}
                      className={`w-4 h-4 rounded-full border cursor-pointer p-0 ${selectedColor === color ? 'border-black' : 'border-black/10'}`}
                      style={{ backgroundColor: color }}
                      onClick={(e) => { e.stopPropagation(); handleColorSelect(color) }}
                    />
                  ))}
                </div>,
                document.body
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="New category"
              className="flex-1 min-w-0 border-none bg-transparent outline-none text-sm text-black placeholder:text-gray-400"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={handleSaveCategory}
                disabled={!newCategoryName.trim()}
                className="w-6 h-6 rounded-full flex items-center justify-center bg-white text-green-700 border border-green-200 hover:bg-green-50 disabled:opacity-40 disabled:hover:bg-white text-base leading-none font-semibold"
                aria-label="Create category"
                type="button"
              >
                ✓
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartAddCategory}
            data-category-id="add-category"
            className={`flex items-center justify-center w-6 h-6 rounded-full text-gray-500 text-lg font-semibold hover:bg-black/5 flex-shrink-0 bg-transparent`}
          >
            <span style={{ position: 'relative', top: '-1.8px' }}>+</span>
          </button>
        )}
      </div>

      {contextMenu && ReactDOM.createPortal(
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-[9999] modal-fade-in"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          ref={contextMenuRef}
        >
          <button
            onClick={() => handleDeleteCategory(contextMenu.category)}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete "{contextMenu.category.name}"
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
