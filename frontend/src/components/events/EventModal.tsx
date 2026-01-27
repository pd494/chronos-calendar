import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X, MapPin, Clock, Users, Bell, Repeat, Check } from 'lucide-react'
import { useCalendarStore, useCalendarsStore } from '../../stores'
import { eventFormSchema, EventFormData, getDefaultEventValues } from '../../schemas/event.schema'
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from '../../hooks'
import { useEventsContext } from '../../contexts/EventsContext'
import { EVENT_COLORS, EventColor } from '../../types'

function formatTimeFromISO(isoString: string | undefined): string {
  if (!isoString) return '09:00'
  const date = new Date(isoString)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

function formatDateFromISO(isoString: string | undefined, allDayDate: string | undefined): string {
  if (allDayDate) return allDayDate
  return toDateString(isoString ? new Date(isoString) : new Date())
}

function combineDateAndTime(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = new Date(year, month - 1, day, hours, minutes)
  return date.toISOString()
}

export function EventModal() {
  const { selectedEventId, selectEvent } = useCalendarStore()
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const { events } = useEventsContext()
  const calendarVisibility = useCalendarsStore((state) => state.visibility)
  const modalRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isAllDayLocal, setIsAllDayLocal] = useState(false)

  const isOpen = !!selectedEventId
  const isNew = selectedEventId?.startsWith('new-')

  const defaultCalendarId = useMemo(() => {
    const visibleIds = Object.entries(calendarVisibility)
      .filter(([, value]) => value.visible)
      .map(([id]) => id)
    const allIds = Object.keys(calendarVisibility)
    return visibleIds[0] || allIds[0] || events[0]?.calendarId || ''
  }, [calendarVisibility, events])

  const existingEvent = useMemo(() => {
    if (!selectedEventId) return undefined
    return events.find((event) => event.id === selectedEventId)
  }, [events, selectedEventId])

  const form = useForm<EventFormData>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: getDefaultEventValues(undefined, defaultCalendarId),
  })

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      setTimeout(() => titleInputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    if (isNew && selectedEventId) {
      const dateStr = selectedEventId.replace('new-', '')
      const defaults = getDefaultEventValues(new Date(Number(dateStr) || dateStr), defaultCalendarId)
      form.reset(defaults)
      setIsAllDayLocal(false)
    } else if (existingEvent) {
      const isAllDay = !!existingEvent.start?.date && !existingEvent.start?.dateTime
      setIsAllDayLocal(isAllDay)
      form.reset({
        summary: existingEvent.summary || '',
        description: existingEvent.description || '',
        location: existingEvent.location || '',
        start: existingEvent.start || { dateTime: new Date().toISOString() },
        end: existingEvent.end || { dateTime: new Date().toISOString() },
        color: (existingEvent.color as EventColor) || 'blue',
        visibility: 'default',
        transparency: 'opaque',
        calendarId: existingEvent.calendarId || defaultCalendarId,
      })
    }
  }, [selectedEventId, existingEvent, isNew, form, defaultCalendarId])

  const handleClose = useCallback(() => {
    setIsVisible(false)
    setShowDeleteConfirm(false)
    setTimeout(() => {
      selectEvent(null)
      form.reset()
    }, 200)
  }, [selectEvent, form])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleClose])

  const handleSubmit = form.handleSubmit(async (data: EventFormData) => {
    const calendarId = data.calendarId || defaultCalendarId
    if (!calendarId) return

    if (isNew) {
      await createEvent.mutateAsync({ calendarId, event: data })
    } else {
      await updateEvent.mutateAsync({
        calendarId: existingEvent?.calendarId || calendarId,
        eventId: selectedEventId!,
        event: data,
      })
    }
    handleClose()
  })

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDeleteClick = (e: MouseEvent) => {
    e.preventDefault()
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    if (!isNew && selectedEventId) {
      const calendarId = existingEvent?.calendarId || defaultCalendarId
      if (!calendarId) return
      await deleteEvent.mutateAsync({ calendarId, eventId: selectedEventId })
      setShowDeleteConfirm(false)
      handleClose()
    }
  }

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false)
  }

  if (!isOpen) return null

  const watchedColor = form.watch('color') as EventColor
  const colors = EVENT_COLORS[watchedColor || 'blue']
  const startValue = form.watch('start')
  const endValue = form.watch('end')

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
        className={`fixed z-[4000] bg-white transition-all duration-300 ease-[cubic-bezier(.215,.61,.355,1)] bottom-8 left-1/2 -translate-x-1/2 w-[520px] max-w-[calc(100vw-48px)] border border-gray-200 rounded-[22px] overflow-visible shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] ${
          isVisible ? 'opacity-100 scale-100 modal-fade-in' : 'opacity-0 scale-95 pointer-events-none'
        }`}
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
                <div className="flex items-center gap-2 text-sm text-gray-900">
                  {!isAllDayLocal ? (
                    <>
                      <Controller
                        name="start"
                        control={form.control}
                        render={({ field }) => (
                          <input
                            type="time"
                            value={formatTimeFromISO(field.value?.dateTime)}
                            onChange={(e) => {
                              const currentDate = formatDateFromISO(field.value?.dateTime, field.value?.date)
                              field.onChange({
                                ...field.value,
                                dateTime: combineDateAndTime(currentDate, e.target.value),
                                date: undefined,
                              })
                            }}
                            className="w-[70px] px-0 py-0.5 border-none focus:outline-none text-sm font-bold [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                          />
                        )}
                      />
                      <span className="text-gray-400 font-semibold">-</span>
                      <Controller
                        name="end"
                        control={form.control}
                        render={({ field }) => (
                          <input
                            type="time"
                            value={formatTimeFromISO(field.value?.dateTime)}
                            onChange={(e) => {
                              const currentDate = formatDateFromISO(field.value?.dateTime, field.value?.date)
                              field.onChange({
                                ...field.value,
                                dateTime: combineDateAndTime(currentDate, e.target.value),
                                date: undefined,
                              })
                            }}
                            className="w-[70px] px-0 py-0.5 border-none focus:outline-none text-sm font-bold [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                          />
                        )}
                      />
                    </>
                  ) : (
                    <span className="text-gray-500">All day</span>
                  )}
                  <label className="relative inline-flex items-center ml-auto cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllDayLocal}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setIsAllDayLocal(checked)
                        const startDate = formatDateFromISO(startValue?.dateTime, startValue?.date)
                        const endDate = formatDateFromISO(endValue?.dateTime, endValue?.date)
                        if (checked) {
                          form.setValue('start', { date: startDate }, { shouldDirty: true })
                          form.setValue('end', { date: endDate }, { shouldDirty: true })
                        } else {
                          form.setValue('start', { dateTime: combineDateAndTime(startDate, '09:00') }, { shouldDirty: true })
                          form.setValue('end', { dateTime: combineDateAndTime(endDate, '10:00') }, { shouldDirty: true })
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                    <span className="ml-2 text-xs text-gray-600">All day</span>
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-900">
                  <Controller
                    name="start"
                    control={form.control}
                    render={({ field }) => (
                      <input
                        type="date"
                        value={formatDateFromISO(field.value?.dateTime, field.value?.date)}
                        onChange={(e) => {
                          if (isAllDayLocal) {
                            field.onChange({ date: e.target.value })
                          } else {
                            const currentTime = formatTimeFromISO(field.value?.dateTime)
                            field.onChange({
                              dateTime: combineDateAndTime(e.target.value, currentTime),
                            })
                          }
                        }}
                        className="w-[100px] border-none focus:outline-none text-sm [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                      />
                    )}
                  />
                  <span className="text-gray-400 font-semibold">-</span>
                  <Controller
                    name="end"
                    control={form.control}
                    render={({ field }) => (
                      <input
                        type="date"
                        value={formatDateFromISO(field.value?.dateTime, field.value?.date)}
                        onChange={(e) => {
                          if (isAllDayLocal) {
                            field.onChange({ date: e.target.value })
                          } else {
                            const currentTime = formatTimeFromISO(field.value?.dateTime)
                            field.onChange({
                              dateTime: combineDateAndTime(e.target.value, currentTime),
                            })
                          }
                        }}
                        className="w-[100px] border-none focus:outline-none text-sm [&::-webkit-calendar-picker-indicator]:hidden bg-transparent text-gray-900"
                      />
                    )}
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
              <span className="text-sm font-medium text-orange-500">Busy</span>
            </div>
            {!isNew && !showDeleteConfirm && (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
              >
                Delete event
              </button>
            )}
            {!isNew && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Delete?</span>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  className="px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={handleDeleteCancel}
                  className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
