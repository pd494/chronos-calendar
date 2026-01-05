import { useState, useEffect } from 'react'
import { X, User, Settings, Calendar, Palette, Video, Bell } from 'lucide-react'
import { useCalendarStore } from '../../stores'

type SettingsSection = 'profile' | 'general' | 'calendars' | 'events' | 'appearance' | 'meetings'

const NAV_SECTIONS = {
  user: [
    { id: 'profile' as const, label: 'Profile', Icon: User },
  ],
  app: [
    { id: 'general' as const, label: 'General', Icon: Settings },
    { id: 'calendars' as const, label: 'Calendars', Icon: Calendar },
    { id: 'events' as const, label: 'Events', Icon: Bell },
    { id: 'appearance' as const, label: 'Appearance', Icon: Palette },
    { id: 'meetings' as const, label: 'Meetings', Icon: Video },
  ],
}

export function SettingsModal() {
  const { setShowSettings } = useCalendarStore()
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile')
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(() => setShowSettings(false), 200)
  }

  const renderNavButton = (section: { id: SettingsSection; label: string; Icon: React.ComponentType<{ size?: number | string }> }, isActive: boolean) => {
    const { Icon } = section
    return (
      <button
        key={section.id}
        onClick={() => setActiveSection(section.id)}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
          isActive ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Icon size={16} />
        <span>{section.label}</span>
      </button>
    )
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <div className="space-y-0">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Profile</h2>
              <p className="text-[13px] text-gray-500">Manage your profile and connected accounts.</p>
            </div>
            <div className="flex items-center gap-4 py-4">
              <div className="h-12 w-12 rounded-full bg-purple-600 text-white flex items-center justify-center text-lg font-medium">
                U
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-gray-900 truncate">User</div>
                <div className="text-[12px] text-gray-500 truncate">user@example.com</div>
              </div>
            </div>
          </div>
        )
      case 'general':
        return (
          <div className="space-y-0">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">General</h2>
              <p className="text-[13px] text-gray-500">Configure your calendar preferences.</p>
            </div>
            <SettingRow label="Use device timezone" description="Automatically use your device's timezone">
              <ToggleSwitch checked={true} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Start of week" description="Choose which day your week starts">
              <span className="text-[13px] font-medium text-gray-900">Sunday</span>
            </SettingRow>
            <SettingRow label="Default view" description="The default calendar view when you open the app">
              <span className="text-[13px] font-medium text-gray-900">Month</span>
            </SettingRow>
          </div>
        )
      case 'appearance':
        return (
          <div className="space-y-0">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Appearance</h2>
              <p className="text-[13px] text-gray-500">Customize how your calendar looks.</p>
            </div>
            <SettingRow label="Show week numbers" description="Display week numbers in the calendar.">
              <ToggleSwitch checked={false} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Hide weekends" description="Hide Saturday and Sunday in week view.">
              <ToggleSwitch checked={false} onChange={() => {}} />
            </SettingRow>
          </div>
        )
      default:
        return (
          <div className="space-y-0">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1 capitalize">{activeSection}</h2>
              <p className="text-[13px] text-gray-500">Coming soon.</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div
        className={`relative w-[min(94vw,1100px)] h-[min(90vh,760px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.35)] transition-transform duration-300 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className="h-full flex bg-white">
          {/* Sidebar Navigation */}
          <div className="w-60 bg-white flex flex-col border-r border-gray-100">
            <div className="flex-1 overflow-y-auto py-6 px-3">
              <div className="mb-5">
                <div className="px-3 mb-1.5 text-[11px] font-medium text-gray-400 tracking-wide uppercase">
                  User Settings
                </div>
                <nav className="space-y-0.5">
                  {NAV_SECTIONS.user.map((section) => renderNavButton(section, activeSection === section.id))}
                </nav>
              </div>
              <nav className="space-y-0.5">
                {NAV_SECTIONS.app.map((section) => renderNavButton(section, activeSection === section.id))}
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="flex justify-end p-4">
              <button
                onClick={handleClose}
                className="flex flex-col items-center text-gray-300 hover:text-gray-500 transition-colors"
              >
                <X size={16} />
                <span className="text-[10px] mt-0.5 uppercase tracking-wide">esc</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-12 pb-8">
              <div className="max-w-xl mx-auto">
                {renderContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-t border-gray-100">
      <div>
        <div className="text-[13px] font-medium text-gray-900">{label}</div>
        <div className="text-[12px] text-gray-500 mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-purple-600' : 'bg-gray-200'}`}
    >
      <div
        className={`absolute top-[2px] w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
