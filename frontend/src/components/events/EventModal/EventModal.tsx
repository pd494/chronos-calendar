import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X, Pencil } from "lucide-react";
import { useCalendarStore, useCalendarsStore } from "../../../stores";
import {
  eventFormSchema,
  EventFormData,
  getDefaultEventValues,
} from "../../../schemas/event.schema";
import {
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  useToggleEventCompletion,
} from "../../../hooks";
import { useEventsContext } from "../../../contexts/EventsContext";
import { useGoogleCalendars } from "../../../hooks";
import { EVENT_COLORS, EventColor } from "../../../types";
import type { RecurrenceEditScope } from "../../../types";
import { getGoogleInstanceId, parseVirtualId } from "../../../lib";
import {
  formatDateFromISO,
  combineDateAndTime,
} from "./constants";
import { TitleSection } from "./TitleSection";
import { ParticipantsSection } from "./ParticipantsSection";
import { LocationSection } from "./LocationSection";
import { DateTimeSection } from "./DateTimeSection";
import { ColorPicker } from "./ColorPicker";
import { ReminderPicker } from "./ReminderPicker";
import { RsvpButton } from "./RsvpButton";
import { DeleteButton } from "./DeleteButton";
import { RecurrenceScopeDialog } from "./RecurrenceScopeDialog";

const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function EventModal() {
  const { selectedEventId, selectEvent } =
    useCalendarStore();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const toggleCompletion = useToggleEventCompletion();
  const { events } = useEventsContext();
  const calendarVisibility = useCalendarsStore((state) => state.visibility);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isAllDayLocal, setIsAllDayLocal] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isSwitchingState, setIsSwitchingState] = useState(false);
  const prevSelectedEventId = useRef<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [customReminderOpen, setCustomReminderOpen] = useState(false);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);

  const [optimisticCompleted, setOptimisticCompleted] = useState<boolean | null>(null);
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [scopeAction, setScopeAction] = useState<"edit" | "delete" | null>(null);
  const pendingFormDataRef = useRef<EventFormData | null>(null);

  const recurrenceRef = useRef<HTMLDivElement>(null);
  const reminderRef = useRef<HTMLDivElement>(null);
  const customReminderRef = useRef<HTMLDivElement>(null);
  const customRecurrenceRef = useRef<HTMLDivElement>(null);
  const recurrenceButtonRef = useRef<HTMLButtonElement>(null);
  const reminderButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setRecurrenceOpen(false);
    setReminderOpen(false);
    setColorOpen(false);
    setCustomReminderOpen(false);
    setCustomRecurrenceOpen(false);

    if (selectedEventId) {
      const isSwitching =
        prevSelectedEventId.current !== null &&
        prevSelectedEventId.current !== selectedEventId;

      setIsSwitchingState(isSwitching);
      setIsMounted(true);

      const timers: NodeJS.Timeout[] = [];

      if (isSwitching) {
        setIsVisible(false);
        timers.push(setTimeout(() => {
          setActiveEventId(selectedEventId);
          timers.push(setTimeout(() => {
            requestAnimationFrame(() => {
              setIsVisible(true);
            });
          }, 30));
        }, 170));
      } else {
        if (activeEventId === selectedEventId && isVisible) {
          prevSelectedEventId.current = selectedEventId;
          return;
        }

        setActiveEventId(selectedEventId);
        timers.push(setTimeout(() => {
          setIsVisible(true);
        }, 50));
      }

      prevSelectedEventId.current = selectedEventId;

      if (selectedEventId.startsWith("new-")) {
        timers.push(setTimeout(() => titleInputRef.current?.focus(), 150));
      }

      return () => {
        for (const t of timers) clearTimeout(t);
      };
    } else {
      setIsVisible(false);
      prevSelectedEventId.current = null;
      const timer = setTimeout(() => {
        setActiveEventId(null);
        setIsMounted(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selectedEventId]);

  const isOpen = !!activeEventId;
  const isNew = activeEventId?.startsWith("new-");

  const { data: calendars } = useGoogleCalendars();
  const defaultCalendarId = useMemo(() => {
    const visibleIds = new Set(
      Object.entries(calendarVisibility)
        .filter(([, value]) => value.visible)
        .map(([id]) => id),
    );
    const visiblePrimary = calendars?.find((c) => c.is_primary && visibleIds.has(c.id));
    if (visiblePrimary) return visiblePrimary.id;
    const firstVisible = [...visibleIds][0];
    if (firstVisible) return firstVisible;
    const primary = calendars?.find((c) => c.is_primary);
    if (primary) return primary.id;
    return Object.keys(calendarVisibility)[0] || events[0]?.calendarId || "";
  }, [calendars, calendarVisibility, events]);

  const existingEvent = useMemo(() => {
    if (!activeEventId) return undefined;
    return events.find((event) => event.id === activeEventId);
  }, [events, activeEventId]);

  const form = useForm<EventFormData>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: getDefaultEventValues(undefined, defaultCalendarId),
  });

  const [
    watchedDescription,
    watchedSummary,
    watchedAttendeesRaw,
    watchedRecurrence,
    watchedReminders,
    watchedLocationRaw,
    watchedColorRaw,
    startValue,
    endValue,
  ] = useWatch({
    control: form.control,
    name: [
      "description",
      "summary",
      "attendees",
      "recurrence",
      "reminders",
      "location",
      "color",
      "start",
      "end",
    ],
  });
  const watchedAttendees = watchedAttendeesRaw ?? [];
  const watchedLocation = (watchedLocationRaw ?? "").trim();
  const watchedColor = (watchedColorRaw || "blue") as EventColor;
  const colors = EVENT_COLORS[watchedColor];
  const isFormChanged = form.formState.isDirty;

  const locationLink = useMemo(() => {
    const conf = existingEvent?.conferenceData as
      | { hangoutLink?: string; entryPoints?: { entryPointType: string; uri: string }[] }
      | undefined;
    const meetingLink =
      conf?.hangoutLink ??
      conf?.entryPoints?.find((ep) => ep.entryPointType === "video" && ep.uri)?.uri ??
      "";
    let isLocationUrl = false;
    if (watchedLocation) {
      try {
        isLocationUrl = ["http:", "https:"].includes(new URL(watchedLocation).protocol);
      } catch {}
    }
    if (meetingLink || isLocationUrl) {
      return { type: "meeting" as const, href: meetingLink || watchedLocation };
    }
    if (watchedLocation && !isLocationUrl) {
      return { type: "maps" as const, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(watchedLocation)}` };
    }
    return null;
  }, [watchedLocation, existingEvent?.conferenceData]);

  const selfRsvpStatus = useMemo(() => {
    return existingEvent?.attendees?.find((a) => a.self)?.responseStatus ?? "needsAction";
  }, [existingEvent?.attendees]);

  const attendeeSummary = useMemo(() => {
    const going = watchedAttendees.filter((a) => a.responseStatus === "accepted").length;
    const declined = watchedAttendees.filter((a) => a.responseStatus === "declined").length;
    const awaiting = watchedAttendees.filter(
      (a) => a.responseStatus !== "accepted" && a.responseStatus !== "declined",
    ).length;
    return [
      going > 0 && `${going} going`,
      declined > 0 && `${declined} declined`,
      awaiting > 0 && `${awaiting} awaiting`,
    ].filter(Boolean).join(", ");
  }, [watchedAttendees]);

  useEffect(() => {
    if (isNew && activeEventId) {
      const isNewAllDay = activeEventId.startsWith("new-allday-");
      const rawDateStr = activeEventId.replace("new-allday-", "").replace("new-", "");
      const date = new Date(Number(rawDateStr) || rawDateStr);
      const defaults = getDefaultEventValues(date, defaultCalendarId);
      if (isNewAllDay) {
        const dateStr = rawDateStr.includes('-')
          ? rawDateStr
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        defaults.start = { date: dateStr };
        defaults.end = { date: dateStr };
      }
      form.reset(defaults);
      setIsAllDayLocal(isNewAllDay);
    } else if (existingEvent) {
      const isAllDay =
        !!existingEvent.start?.date && !existingEvent.start?.dateTime;
      setIsAllDayLocal(isAllDay);
      form.reset({
        summary: existingEvent.summary || "",
        description: existingEvent.description || "",
        location: existingEvent.location || "",
        start: existingEvent.start,
        end: existingEvent.end,
        color: (existingEvent.color as EventColor) || "blue",
        visibility: "default",
        transparency: "opaque",
        calendarId: existingEvent.calendarId || defaultCalendarId,
        recurrence: existingEvent.recurrence ?? [],
        reminders: existingEvent.reminders ?? {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 30 }],
        },
        attendees: existingEvent.attendees ?? [],
      });
    }
  }, [activeEventId, existingEvent, isNew, form, defaultCalendarId]);

  useEffect(() => {
    setIsEditing(isNew ?? false);
    setOptimisticCompleted(null);
    setScopeAction(null);
    pendingFormDataRef.current = null;
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }, [activeEventId, isNew]);

  const handleAllDayToggle = useCallback((checked: boolean) => {
    setIsAllDayLocal(checked);
    const startDate = formatDateFromISO(startValue?.dateTime, startValue?.date);
    const endDate = formatDateFromISO(endValue?.dateTime, endValue?.date);
    if (checked) {
      form.setValue("start", { date: startDate }, { shouldDirty: true });
      form.setValue("end", { date: endDate }, { shouldDirty: true });
    } else {
      form.setValue(
        "start",
        { dateTime: combineDateAndTime(startDate, "09:00"), timeZone: LOCAL_TIMEZONE },
        { shouldDirty: true },
      );
      form.setValue(
        "end",
        { dateTime: combineDateAndTime(endDate, "10:00"), timeZone: LOCAL_TIMEZONE },
        { shouldDirty: true },
      );
    }
  }, [form, startValue, endValue]);

  const isRecurringInstance = !!(
    existingEvent?.isVirtual ||
    existingEvent?.recurringEventId ||
    existingEvent?.recurrence?.length
  );

  const masterId = existingEvent?.originalMasterId || existingEvent?.recurringEventId || existingEvent?.id || "";

  const resolveEventIdForScope = useCallback((scope: RecurrenceEditScope): string => {
    if (scope === "this") {
      if (existingEvent?.isVirtual && activeEventId) {
        const parsed = parseVirtualId(activeEventId);
        if (parsed) {
          const instanceDate = new Date(parsed.instanceTimestamp);
          const isAllDay = !!existingEvent.start.date && !existingEvent.start.dateTime;
          return getGoogleInstanceId(parsed.masterId, instanceDate, isAllDay);
        }
      }
      return existingEvent?.id || activeEventId || "";
    }
    return masterId;
  }, [existingEvent, activeEventId, masterId]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
    setScopeAction(null);
    pendingFormDataRef.current = null;
    selectEvent(null);
    form.reset();
  }, [selectEvent, form]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (modalRef.current?.contains(target)) return;
      if (
        recurrenceRef.current?.contains(target) ||
        recurrenceButtonRef.current?.contains(target)
      )
        return;
      if (
        reminderRef.current?.contains(target) ||
        reminderButtonRef.current?.contains(target)
      )
        return;
      if (customReminderRef.current?.contains(target)) return;
      if (customRecurrenceRef.current?.contains(target)) return;
      if (target.closest("[data-participants-section]")) return;
      if (target.closest("[data-calendar-event]")) return;
      if (target.closest("[data-suggestions-portal]")) return;

      if (customReminderOpen) {
        setCustomReminderOpen(false);
        return;
      }
      if (customRecurrenceOpen) {
        setCustomRecurrenceOpen(false);
        return;
      }

      setRecurrenceOpen(false);
      setReminderOpen(false);
      setColorOpen(false);
      handleClose();
    };
    if (isOpen) document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen, handleClose, customReminderOpen, customRecurrenceOpen]);

  const prepareEventData = useCallback((data: EventFormData) => {
    const { color, ...eventData } = data;
    if (eventData.start?.dateTime && !eventData.start.timeZone) {
      eventData.start = { ...eventData.start, timeZone: LOCAL_TIMEZONE };
    }
    if (eventData.end?.dateTime && !eventData.end.timeZone) {
      eventData.end = { ...eventData.end, timeZone: LOCAL_TIMEZONE };
    }
    if (form.formState.dirtyFields.color && color && color in EVENT_COLORS) {
      eventData.colorId = EVENT_COLORS[color as EventColor].googleId;
    }
    return eventData;
  }, [form.formState.dirtyFields.color]);

  const submitWithScope = useCallback((scope: RecurrenceEditScope, data: EventFormData) => {
    const calendarId = existingEvent?.calendarId || data.calendarId || defaultCalendarId;
    if (!calendarId) return;
    const eventData = prepareEventData(data);
    const eventId = resolveEventIdForScope(scope);
    updateEvent.mutate({
      calendarId,
      eventId,
      event: eventData,
      currentEvent: existingEvent,
    });
    handleClose();
  }, [existingEvent, defaultCalendarId, prepareEventData, updateEvent, resolveEventIdForScope, handleClose]);

  const handleSubmit = form.handleSubmit((data: EventFormData) => {
    const calendarId = data.calendarId || defaultCalendarId;
    if (!calendarId) return;

    if (isNew) {
      const calendar = calendars?.find((c) => c.id === calendarId);
      const eventData = prepareEventData(data);
      createEvent.mutate({ calendarId, event: eventData, calendarColor: calendar?.color });
      handleClose();
      return;
    }

    if (isRecurringInstance) {
      pendingFormDataRef.current = data;
      setScopeAction("edit");
      return;
    }

    const eventData = prepareEventData(data);
    updateEvent.mutate({
      calendarId: existingEvent?.calendarId || calendarId,
      eventId: activeEventId!,
      event: eventData,
      currentEvent: existingEvent,
    });
    handleClose();
  });

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isRecurringInstance) {
      setScopeAction("delete");
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const deleteWithScope = useCallback((scope: RecurrenceEditScope) => {
    const calendarId = existingEvent?.calendarId || defaultCalendarId;
    if (!calendarId) return;
    const eventId = resolveEventIdForScope(scope);
    deleteEvent.mutate({ calendarId, eventId });
    handleClose();
  }, [existingEvent, defaultCalendarId, deleteEvent, resolveEventIdForScope, handleClose]);

  const handleDeleteConfirm = () => {
    if (!isNew && activeEventId) {
      const calendarId = existingEvent?.calendarId || defaultCalendarId;
      if (!calendarId) return;
      deleteEvent.mutate({ calendarId, eventId: activeEventId });
      setShowDeleteConfirm(false);
      handleClose();
    }
  };

  const handleScopeSelect = useCallback((scope: RecurrenceEditScope) => {
    if (scopeAction === "edit" && pendingFormDataRef.current) {
      submitWithScope(scope, pendingFormDataRef.current);
    } else if (scopeAction === "delete") {
      deleteWithScope(scope);
    }
    setScopeAction(null);
    pendingFormDataRef.current = null;
  }, [scopeAction, submitWithScope, deleteWithScope]);

  const handleScopeCancel = useCallback(() => {
    setScopeAction(null);
    pendingFormDataRef.current = null;
  }, []);

  if (!isMounted) return null;

  return ReactDOM.createPortal(
    <div
      ref={modalRef}
      data-event-modal
      className={`fixed z-[4000] bg-white bottom-8 left-1/2 -translate-x-1/2 w-[520px] max-w-[calc(100vw-48px)] border border-gray-200 rounded-[22px] overflow-visible shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] origin-bottom transition-[opacity,transform] ${isSwitchingState ? "duration-[160ms]" : "duration-[240ms]"} ease-out ${
        isVisible
          ? "opacity-100 translate-y-0"
          : `opacity-0 ${!isSwitchingState && selectedEventId ? "translate-y-4" : "translate-y-0"} pointer-events-none`
      }`}
    >
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if ((e.metaKey || e.ctrlKey) && (isEditing || isNew)) {
              e.preventDefault();
              handleSubmit();
            } else if (
              e.target instanceof HTMLElement &&
              e.target.tagName !== "TEXTAREA"
            ) {
              e.preventDefault();
              handleSubmit();
            }
          }
        }}
        className="flex flex-col relative"
      >
        {isNew ? (
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors z-10"
          >
            <X size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (isEditing) {
                form.reset();
                setIsEditing(false);
              } else {
                setIsEditing(true);
              }
            }}
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors z-10"
          >
            {isEditing ? <X size={20} /> : <Pencil size={18} />}
          </button>
        )}

        <TitleSection
          form={form}
          isEditing={isEditing}
          isNew={isNew}
          existingEvent={existingEvent}
          optimisticCompleted={optimisticCompleted}
          setOptimisticCompleted={setOptimisticCompleted}
          completionTimerRef={completionTimerRef}
          toggleCompletion={toggleCompletion}
          watchedDescription={watchedDescription}
          watchedSummary={watchedSummary}
          activeEventId={activeEventId}
          titleInputRef={titleInputRef}
          descriptionInputRef={descriptionInputRef}
        />

        <div className="border-b border-gray-100" />

        <ParticipantsSection
          modalRef={modalRef}
          form={form}
          isEditing={isEditing}
          isNew={isNew}
          existingEvent={existingEvent}
          watchedAttendees={watchedAttendees}
          attendeeSummary={attendeeSummary}
          isFormChanged={isFormChanged}
        />

        <LocationSection
          form={form}
          isEditing={isEditing}
          isNew={isNew}
          locationLink={locationLink}
        />

        <DateTimeSection
          form={form}
          isEditing={isEditing}
          isNew={isNew}
          isAllDayLocal={isAllDayLocal}
          handleAllDayToggle={handleAllDayToggle}
          startValue={startValue}
          endValue={endValue}
          recurrenceOpen={recurrenceOpen}
          onRecurrenceToggle={() => {
            setColorOpen(false);
            setReminderOpen(false);
            setRecurrenceOpen((o) => !o);
            setCustomRecurrenceOpen(false);
          }}
          customRecurrenceOpen={customRecurrenceOpen}
          onCustomRecurrenceOpenChange={setCustomRecurrenceOpen}
          watchedRecurrence={watchedRecurrence}
          recurrenceButtonRef={recurrenceButtonRef}
          recurrenceRef={recurrenceRef}
          customRecurrenceRef={customRecurrenceRef}
        />

        {scopeAction ? (
          <div className="px-2 py-1">
            <RecurrenceScopeDialog
              action={scopeAction}
              onSelect={handleScopeSelect}
              onCancel={handleScopeCancel}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-5" style={!isEditing && !isNew ? { pointerEvents: "none", opacity: 0.5 } : undefined}>
              <ColorPicker
                form={form}
                isOpen={colorOpen}
                onToggle={() => {
                  setRecurrenceOpen(false);
                  setReminderOpen(false);
                  setColorOpen((o) => !o);
                }}
                watchedColor={watchedColor}
                colors={colors}
              />
              <ReminderPicker
                form={form}
                isOpen={reminderOpen}
                onToggle={() => {
                  setColorOpen(false);
                  setRecurrenceOpen(false);
                  setReminderOpen((o) => !o);
                  setCustomReminderOpen(false);
                }}
                onClose={() => setReminderOpen(false)}
                customOpen={customReminderOpen}
                onCustomOpenChange={setCustomReminderOpen}
                watchedReminders={watchedReminders}
                reminderButtonRef={reminderButtonRef}
                reminderRef={reminderRef}
                customReminderRef={customReminderRef}
              />
            </div>
            {!isNew && (
              <div className="flex items-center gap-2">
                <RsvpButton
                  isOpen={rsvpOpen}
                  onToggle={() => setRsvpOpen((o) => !o)}
                  selfRsvpStatus={selfRsvpStatus}
                />
                <DeleteButton
                  showConfirm={showDeleteConfirm}
                  onDeleteClick={handleDeleteClick}
                  onConfirm={handleDeleteConfirm}
                  onCancel={() => setShowDeleteConfirm(false)}
                />
              </div>
            )}
          </div>
        )}
      </form>
    </div>,
    document.body,
  );
}
