import { useState, useRef, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { Trash2, X, Pencil } from 'lucide-react'
import { Reorder } from 'motion/react'
import { useTodoStore } from '../../stores'
import { useTodoLists, useCreateList, useDeleteList, useReorderLists, useDeferredReorder } from '../../hooks'

const CATEGORY_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#FBBF24', '#10B981', '#14B8A6', '#F97316', '#EF4444']
const ALL_CATEGORY_COLOR = '#1a1a1a'
const DEFAULT_CATEGORY_COLOR = '#3B82F6'
const PROTECTED_CATEGORY_NAMES = new Set(['Today', 'Inbox', 'Completed'])

interface Category {
  id: string
  name: string
  color: string
}

interface CategoryTabProps {
  category: Category
  isActive: boolean
  onCategoryChange: (name: string) => void
  onContextMenu: (e: React.MouseEvent, category: Category) => void
  isHovered: boolean
  setIsHovered: (value: boolean) => void
}

function CategoryTab({
  category,
  isActive,
  onCategoryChange,
  onContextMenu,
  isHovered,
  setIsHovered,
}: CategoryTabProps) {
  const tabClass = `flex items-center gap-1 rounded-[7px] px-[8px] py-[6px] text-[12px] leading-[14px] font-medium whitespace-nowrap flex-shrink-0 cursor-default transition-colors ${
    isActive ? 'text-gray-900 font-semibold' : 'text-gray-500'
  } ${(isActive || isHovered) ? 'bg-gray-100' : 'hover:bg-black/5'}`

  return (
    <div
      data-category-id={category.id}
      className={tabClass}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => category.name && onCategoryChange(category.id)}
      onContextMenu={(e) => onContextMenu(e, category)}
    >
      <span className="w-[8px] h-[8px] mr-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: category.color }} />
      <span className={`text-[12px] font-normal text-black whitespace-nowrap overflow-hidden text-ellipsis ${isActive ? 'font-semibold' : ''}`}>
        {category.name}
      </span>
    </div>
  )
}

function ReorderableCategoryTab(props: CategoryTabProps & { value: string; onDragEnd?: () => void }) {
  const { value, onDragEnd, ...tabProps } = props
  return (
    <Reorder.Item value={value} as="div" className="flex-shrink-0" onDragEnd={onDragEnd}>
      <CategoryTab {...tabProps} />
    </Reorder.Item>
  )
}

export function CategoryTabs() {
  const { selectedListId, setSelectedList, startEditingList } = useTodoStore()
  const { data: customLists = [] } = useTodoLists()
  const createList = useCreateList()
  const deleteList = useDeleteList()
  const { reorder, persistReorder } = useReorderLists()

  const [isAddingCategory, setIsAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [selectedColor, setSelectedColor] = useState('#3B82F6')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ category: Category; x: number; y: number; width: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const categories: Category[] = useMemo(() => [
    { id: 'all', name: 'All', color: ALL_CATEGORY_COLOR },
    ...customLists.map((list) => ({ id: list.id, name: list.name, color: list.color || DEFAULT_CATEGORY_COLOR })),
  ], [customLists])

  const reorderableIds = useMemo(() => customLists.map(l => l.id), [customLists])

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

  const closeAddCategory = (resetColor: boolean) => {
    setIsAddingCategory(false)
    setNewCategoryName('')
    setShowColorPicker(false)
    if (resetColor) {
      setSelectedColor(DEFAULT_CATEGORY_COLOR)
    }
  }

  const reopenAddCategory = (name: string, color: string) => {
    setNewCategoryName(name)
    setSelectedColor(color)
    setIsAddingCategory(true)
  }

  const handleSaveCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) return
    const color = selectedColor

    closeAddCategory(false)
    try {
      await createList.mutateAsync({ name: trimmed, color })
      setSelectedColor(DEFAULT_CATEGORY_COLOR)
    } catch {
      reopenAddCategory(trimmed, color)
    }
  }

  const handleCancelAddCategory = () => {
    closeAddCategory(true)
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
    setContextMenu({
      category,
      x: rect.left + window.pageXOffset,
      y: rect.bottom + window.pageYOffset + 4,
      width: rect.width,
    })
  }

  const handleEditCategory = (category: Category) => {
    setContextMenu(null)
    setSelectedList(category.id)
    startEditingList(category.id)
  }

  const handleDeleteCategory = async (category: Category) => {
    if (!category?.id) return

    setContextMenu(null)
    if (selectedListId === category.id) setSelectedList('all')

    await deleteList.mutateAsync(category.id).catch(() => undefined)
  }

  const handleCategoryChange = (categoryId: string) => {
    setSelectedList(categoryId)
  }

  const { handleReorder, handleReorderEnd } = useDeferredReorder(reorder, persistReorder)

  const iconCircleSize = 'w-[10px] h-[10px] mr-1.5'
  const allCategory = categories[0]

  return (
    <div className="flex flex-col w-full overflow-visible relative h-full items-center bg-transparent pt-0.5 whitespace-nowrap">
      <div className={`flex items-center w-full max-w-full relative bg-transparent ${isAddingCategory ? 'pl-2 pr-1' : 'px-3'} py-2 h-full gap-1 flex-nowrap justify-start overflow-visible`}>
        <div
          className={`flex gap-2 flex-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap pr-2 scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${isAddingCategory ? 'hidden' : ''}`}
          style={{ overflowAnchor: 'none' }}
        >
          {allCategory && (
            <CategoryTab
              category={allCategory}
              isActive={selectedListId === allCategory.id || (!selectedListId && allCategory.id === 'all')}
              onCategoryChange={handleCategoryChange}
              onContextMenu={handleContextMenu}
              isHovered={hoveredId === allCategory.id}
              setIsHovered={(val) => setHoveredId(val ? allCategory.id : null)}
            />
          )}
          {reorderableIds.length > 0 && (
            <Reorder.Group
              as="div"
              axis="x"
              values={reorderableIds}
              onReorder={handleReorder}
              className="flex gap-2 flex-1 min-w-0 overflow-visible items-center"
            >
              {categories.slice(1).map(category => (
                <ReorderableCategoryTab
                  key={category.id}
                  value={category.id}
                  onDragEnd={handleReorderEnd}
                  category={category}
                  isActive={selectedListId === category.id || (!selectedListId && category.id === 'all')}
                  onCategoryChange={handleCategoryChange}
                  onContextMenu={handleContextMenu}
                  isHovered={hoveredId === category.id}
                  setIsHovered={(val) => setHoveredId(val ? category.id : null)}
                />
              ))}
            </Reorder.Group>
          )}
        </div>

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
              <button
                onClick={handleCancelAddCategory}
                className="w-6 h-6 rounded-full flex items-center justify-center bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 text-base leading-none"
                aria-label="Cancel"
                type="button"
              >
                <X size={14} />
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
          className="fixed bg-white/80 backdrop-blur-md border border-gray-200 rounded-xl shadow-[0_10px_50px_rgba(0,0,0,0.15)] py-1 z-[9999] modal-fade-in overflow-hidden flex flex-col items-stretch"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            width: `${contextMenu.width + 10}px`,
          }}
          ref={contextMenuRef}
        >
          <button
            onClick={() => handleEditCategory(contextMenu.category)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
          >
            <div className="flex items-center justify-center w-4">
              <Pencil className="h-3.5 w-3.5" />
            </div>
            <span className="font-medium">Edit</span>
          </button>
          <div className="h-px bg-gray-100/50 my-0.5 mx-2" />
          <button
            onClick={() => handleDeleteCategory(contextMenu.category)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
          >
            <div className="flex items-center justify-center w-4">
              <Trash2 className="h-3.5 w-3.5" />
            </div>
            <span className="font-medium">Delete</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
