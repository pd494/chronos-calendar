import { Send, FileText } from 'lucide-react'
import { useCalendarStore } from '../../stores'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { DayView } from './DayView'

export function Calendar() {
  const { view } = useCalendarStore()

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      <div className="flex-1 overflow-hidden relative">
        {view === 'month' && <MonthView />}
        {view === 'week' && <WeekView />}
        {view === 'day' && <DayView />}
      </div>

      {/* Floating Search Bar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-30 pointer-events-none">
        <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-gray-200 rounded-2xl shadow-2xl flex items-center p-2.5 gap-3 group focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
          <div className="flex-1 flex items-center gap-3 px-2">
            <span className="text-sm font-medium text-gray-400">Ask your calendar...</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
              <FileText size={20} />
            </button>
            <button className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl transition-colors">
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
