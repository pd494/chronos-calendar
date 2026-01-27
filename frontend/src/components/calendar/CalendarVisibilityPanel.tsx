import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronRight, AlertCircle, Plus } from 'lucide-react'
import { useGoogleCalendars, useGroupedCalendars, useClickOutside } from '../../hooks'
import { useCalendarsStore } from '../../stores'
import type { GoogleCalendar } from '../../api'

interface CalendarVisibilityPanelProps {
  onAddAccount?: () => void
}

export function CalendarVisibilityPanel({ onAddAccount }: CalendarVisibilityPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)

  const { data: calendars, isLoading } = useGoogleCalendars()
  const groupedCalendars = useGroupedCalendars(calendars)
  const { isVisible, toggleVisibility } = useCalendarsStore()

  useEffect(() => {
    if (calendars && expandedAccounts.size === 0) {
      const accountIds = Object.keys(groupedCalendars)
      setExpandedAccounts(new Set(accountIds))
    }
  }, [calendars, groupedCalendars, expandedAccounts.size])

  const closePanel = useCallback(() => setIsOpen(false), [])
  useClickOutside(panelRef, closePanel, isOpen)

  const toggleAccountExpanded = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }

  const visibleCount = useMemo(() => {
    if (!calendars) return 0
    return calendars.filter((c) => isVisible(c.id)).length
  }, [calendars, isVisible])

  const previewColors = useMemo(() => {
    if (!calendars) return []
    return calendars
      .filter((c) => isVisible(c.id))
      .slice(0, 5)
      .map((c) => c.color || '#818cf8')
  }, [calendars, isVisible])

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="calendar-chip cursor-pointer"
      >
        <div className="flex -space-x-0.5">
          {previewColors.map((color, i) => (
            <div
              key={i}
              className="calendar-chip-dot border-2 border-white"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <span className="text-xs text-gray-600 font-medium">
          {visibleCount > 5 ? `+${visibleCount - 5}` : visibleCount}
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg border border-gray-200 shadow-lg z-50">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">My calendars</h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && (
              <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
            )}

            {!isLoading && Object.keys(groupedCalendars).length === 0 && (
              <div className="p-4 text-center text-sm text-gray-500">
                No calendars connected
              </div>
            )}

            {Object.entries(groupedCalendars).map(([accountId, { account, calendars: accountCalendars }]) => (
              <AccountSection
                key={accountId}
                account={account}
                calendars={accountCalendars}
                isExpanded={expandedAccounts.has(accountId)}
                onToggleExpand={() => toggleAccountExpanded(accountId)}
                isVisible={isVisible}
                onToggleVisibility={toggleVisibility}
              />
            ))}
          </div>

          {onAddAccount && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={onAddAccount}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
              >
                <Plus size={16} />
                Add Google Account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface AccountSectionProps {
  account: { id: string; email: string; name: string; needs_reauth: boolean }
  calendars: GoogleCalendar[]
  isExpanded: boolean
  onToggleExpand: () => void
  isVisible: (id: string) => boolean
  onToggleVisibility: (id: string) => void
}

function AccountSection({
  account,
  calendars,
  isExpanded,
  onToggleExpand,
  isVisible,
  onToggleVisibility,
}: AccountSectionProps) {
  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
        <span className="text-xs font-medium text-gray-700 truncate flex-1 text-left">
          {account.email}
        </span>
        {account.needs_reauth && (
          <AlertCircle size={14} className="text-amber-500" />
        )}
      </button>

      {isExpanded && (
        <div className="pb-1">
          {calendars.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              isVisible={isVisible(calendar.id)}
              onToggle={() => onToggleVisibility(calendar.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CalendarRowProps {
  calendar: GoogleCalendar
  isVisible: boolean
  onToggle: () => void
}

function CalendarRow({ calendar, isVisible, onToggle }: CalendarRowProps) {
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 pl-8 hover:bg-gray-50 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={isVisible}
        onChange={onToggle}
        className="sr-only"
      />
      <div
        className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          isVisible
            ? 'border-transparent'
            : 'border-gray-300 bg-white'
        }`}
        style={isVisible ? { backgroundColor: calendar.color || '#818cf8' } : undefined}
      >
        {isVisible && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span className="text-xs text-gray-700 truncate flex-1">{calendar.name}</span>
      {calendar.is_primary && (
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Primary</span>
      )}
    </label>
  )
}
