import { useEffect, useRef, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X, MapPin, Clock, Users, Bell, Repeat, Check } from 'lucide-react'
import { useCalendarStore } from '../../stores'
import { eventFormSchema, EventFormData, getDefaultEventValues } from '../../schemas/event.schema'
import { useCreateEvent, useUpdateEvent, useDeleteEvent, useEvent } from '../../hooks'
import { EVENT_COLORS, EventColor } from '../../types'
import { format } from '../../lib/date'

export function EventModal() {
  const { selectedEventId, selectEvent } = useCalendarStore()
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const modalRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  const isOpen = !!selectedEventId
  const isNew = selectedEventId?.startsWith('new-')

  const { data: existingEvent } = useEvent('primary', selectedEventId || '')

  const form = useForm<EventFormData>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: getDefaultEventValues(),
  })

  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      selectEvent(null)
      form.reset()
    }, 200)
  }, [selectEvent, form])

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setTimeout(() => titleInputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    if (isNew && selectedEventId) {
      const dateStr = selectedEventId.replace('new-', '')
      form.reset(getDefaultEventValues(new Date(Number(dateStr) || dateStr)))
    } else if (existingEvent) {
      form.reset({
        summary: existingEvent.summary,
        description: existingEvent.description,
        location: existingEvent.location,
        start: existingEvent.start,
        end: existingEvent.end,
        color: (existingEvent.color as EventColor) || 'blue',
      })
    }
  }, [selectedEventId, existingEvent, isNew, form])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose])

  const handleSubmit = form.handleSubmit(async (data) => {
    if (isNew) {
      await createEvent.mutateAsync({ calendarId: 'primary', event: data as EventFormData })
    } else {
      await updateEvent.mutateAsync({
        calendarId: 'primary',
        eventId: selectedEventId!,
        event: data as EventFormData,
      })
    }
    handleClose()
  })

  const handleDelete = async () => {
    if (!isNew && selectedEventId) {
      await deleteEvent.mutateAsync({ calendarId: 'primary', eventId: selectedEventId })
      handleClose()
    }
  }

  if (!isOpen) return null

  const watchedColor = form.watch('color') as EventColor
  const colors = EVENT_COLORS[watchedColor || 'blue']
  const isAllDay = form.watch('start.date') && !form.watch('start.dateTime')

  const { ref: registerSummaryRef, ...summaryRegisterProps } = form.register('summary')
  const summaryRef = (e: HTMLInputElement | null) => {
    if (typeof registerSummaryRef === 'function') {
      registerSummaryRef(e)
    }
    if (e) {
      (titleInputRef as React.MutableRefObject<HTMLInputElement | null>).current = e
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-[3999] transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      <div
        ref={modalRef}
        className={`fixed z-[4000] bg-white shadow-xl transition-all duration-300 ease-[cubic-bezier(.215,.61,.355,1)] ${
          isVisible ? 'opacity-100 scale-100 modal-fade-in' : 'opacity-0 scale-95 pointer-events-none'
        }`}
        style={{
          bottom: '32px',
          left: '50%',
          transform: `translateX(-50%) ${isVisible ? 'scale(1)' : 'scale(0.95)'}`,
          width: '520px',
          maxWidth: 'calc(100vw - 48px)',
          border: '1px solid #e5e7eb',
          borderRadius: '22px',
          overflow: 'visible',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.tagName !== 'TEXTAREA') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          className="flex flex-col"
        >
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors z-10"
          >
            <X size={20} />
          </button>

          <div className="px-4 pt-[14px] pb-2">
            <div className="flex items-start gap-3">
              {!isNew && (
                <button
                  type="button"
                  className="w-[20px] h-[20px] flex items-center justify-center border-2 rounded-[6px] transition-colors mt-[8px] border-gray-300 text-transparent hover:border-green-500"
                >
                  <Check size={14} />
                </button>
              )}
              <div className="flex-1">
                <input
                  {...summaryRegisterProps}
                  ref={summaryRef}
                  placeholder="New event"
                  className="w-full px-0 py-1 text-xl font-semibold text-gray-900 border-none focus:outline-none focus:ring-0 placeholder-gray-400 bg-transparent"
                />
                <textarea
                  {...form.register('description')}
                  placeholder="Add description"
                  rows={1}
                  className="w-full px-0 text-sm text-gray-500 border-none focus:outline-none focus:ring-0 resize-none bg-transparent placeholder-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="border-b border-gray-100" />

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <Users className="text-gray-400 mt-1" size={20} />
              <input
                type="email"
                placeholder="Add guests"
                className="flex-1 px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400"
              />
              <button
                type="submit"
                disabled={!form.formState.isDirty}
                className={`px-4 py-1.5 text-sm rounded-md font-medium whitespace-nowrap ${
                  !form.formState.isDirty
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {isNew ? 'Create event' : 'Update event'}
              </button>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <MapPin className="text-gray-400 mt-1" size={20} />
              <input
                {...form.register('location')}
                placeholder="Add location"
                className="flex-1 px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400"
              />
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-start gap-[9px]">
              <div className="flex flex-col gap-3 pt-0.5">
                <Clock className="text-gray-400" size={20} />
              </div>
              <div className="flex-1 space-y-2">
                {!isAllDay ? (
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <input
                      type="time"
                      defaultValue="09:00"
                      className="px-0 py-0.5 border-none focus:outline-none text-sm font-bold [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                      style={{ width: '70px' }}
                    />
                    <span className="text-gray-400 font-semibold">→</span>
                    <input
                      type="time"
                      defaultValue="10:00"
                      className="px-0 py-0.5 border-none focus:outline-none text-sm font-bold [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                      style={{ width: '70px' }}
                    />
                    <label className="relative inline-flex items-center ml-auto cursor-pointer">
                      <input type="checkbox" className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                      <span className="ml-2 text-xs text-gray-600">All day</span>
                    </label>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <span className="text-gray-500">All day</span>
                    <label className="relative inline-flex items-center ml-auto cursor-pointer">
                      <input type="checkbox" checked className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                      <span className="ml-2 text-xs text-gray-600">All day</span>
                    </label>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-gray-900">
                  <input
                    type="date"
                    defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    className="border-none focus:outline-none text-sm [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                    style={{ width: '100px' }}
                  />
                  <span className="text-gray-400 font-semibold">→</span>
                  <input
                    type="date"
                    defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    className="border-none focus:outline-none text-sm [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                    style={{ width: '100px' }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Repeat className="text-gray-400" size={20} />
              <span className="text-sm text-gray-500">Does not repeat</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="w-5 h-5 rounded-full border-2 border-gray-200 transition-colors hover:scale-110"
                style={{ backgroundColor: colors.border }}
              />
              <Bell size={18} className="text-gray-400 cursor-pointer hover:text-gray-600" />
              <span className="text-sm font-medium text-orange-500">• Busy</span>
            </div>
            {!isNew && (
              <button
                type="button"
                onClick={handleDelete}
                className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
              >
                Delete event
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
