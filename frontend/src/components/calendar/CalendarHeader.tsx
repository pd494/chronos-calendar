import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { useCalendarStore } from '../../stores'
import { useClickOutside } from '../../hooks/useClickOutside'
import { formatMonthYear } from '../../lib/date'
import { CalendarVisibilityPanel } from './CalendarVisibilityPanel'
import { SyncButton } from './SyncButton'
import type { CalendarView } from '../../types'

const views: { value: CalendarView; label: string; shortcut: string }[] = [
  { value: 'day', label: 'Day', shortcut: 'D' },
  { value: 'week', label: 'Week', shortcut: 'W' },
  { value: 'month', label: 'Month', shortcut: 'M' },
]

export function CalendarHeader() {
  const { view, setView, currentDate, navigateToToday, navigatePrevious, navigateNext } =
    useCalendarStore()
  const [showViewDropdown, setShowViewDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeDropdown = useCallback(() => setShowViewDropdown(false), [])
  useClickOutside(dropdownRef, closeDropdown, showViewDropdown)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key.toLowerCase() === 'd') setView('day')
      if (e.key.toLowerCase() === 'w') setView('week')
      if (e.key.toLowerCase() === 'm') setView('month')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [setView])

  return (
    <header className="flex items-center justify-between px-4 bg-white w-full" style={{ height: '48px' }}>
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-900" style={{ marginRight: '2px' }}>
          {formatMonthYear(currentDate)}
        </h1>

        <div className="flex items-center ml-2">
          <button
            onClick={navigatePrevious}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors flex items-center justify-center"
            style={{ height: '28px', width: '28px' }}
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <button
            onClick={navigateNext}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors flex items-center justify-center"
            style={{ height: '28px', width: '28px' }}
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>

        <button
          onClick={navigateToToday}
          className="today-button ml-2 hover:text-gray-700 transition-colors"
        >
          Today
        </button>
      </div>

      <div className="flex items-center gap-3">
        <SyncButton />
        <CalendarVisibilityPanel />

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowViewDropdown(!showViewDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
            style={{ height: '32px' }}
          >
            <span>{views.find(v => v.value === view)?.label}</span>
            <ChevronDown size={14} />
          </button>

          {showViewDropdown && (
            <div className="view-dropdown-menu">
              {views.map((v) => (
                <button
                  key={v.value}
                  onClick={() => { setView(v.value); setShowViewDropdown(false) }}
                  className={view === v.value ? 'active' : ''}
                >
                  <span>{v.label}</span>
                  <span className="keyboard-shortcut">{v.shortcut}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
