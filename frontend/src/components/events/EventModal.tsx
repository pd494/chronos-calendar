import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  X,
  MapPin,
  Clock,
  Calendar,
  Users,
  Bell,
  Repeat,
  Check,
  Video,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCalendarStore, useCalendarsStore } from "../../stores";
import {
  eventFormSchema,
  EventFormData,
  getDefaultEventValues,
} from "../../schemas/event.schema";
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from "../../hooks";
import { useEventsContext } from "../../contexts/EventsContext";
import { EVENT_COLORS, EventColor } from "../../types";

function formatTimeFromISO(isoString: string | undefined): string {
  if (!isoString) return "09:00";
  const date = new Date(isoString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function formatDateFromISO(
  isoString: string | undefined,
  allDayDate: string | undefined,
): string {
  if (allDayDate) return allDayDate;
  return toDateString(isoString ? new Date(isoString) : new Date());
}

function combineDateAndTime(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  return date.toISOString();
}

const MODAL_WIDTH = 520;
const MODAL_HEIGHT = 500;
const GAP = 4;

const RECURRENCE_OPTIONS = [
  { label: "Never", value: "" },
  { label: "Daily", value: "RRULE:FREQ=DAILY" },
  { label: "Weekly", value: "RRULE:FREQ=WEEKLY" },
  { label: "Monthly", value: "RRULE:FREQ=MONTHLY" },
  { label: "Yearly", value: "RRULE:FREQ=YEARLY" },
] as const;

const REMINDER_OPTIONS = [
  { label: "None", minutes: null },
  { label: "At time of event", minutes: 0 },
  { label: "5 minutes before", minutes: 5 },
  { label: "15 minutes before", minutes: 15 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 1440 },
  { label: "2 days before", minutes: 2880 },
  { label: "1 week before", minutes: 10080 },
] as const;

const COLOR_OPTIONS = Object.entries(EVENT_COLORS) as [
  EventColor,
  (typeof EVENT_COLORS)[EventColor],
][];

const RSVP_OPTIONS = [
  { label: "Maybe", value: "tentative" as const },
  { label: "Decline", value: "declined" as const },
  { label: "Accept", value: "accepted" as const },
];

const DESCRIPTION_LINE_HEIGHT = 24;
const MAX_DESCRIPTION_PREVIEW_HEIGHT = 52;

const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

function linkifyText(text: string): (string | { url: string })[] {
  if (!text.trim()) return [];
  return text.split(URL_REGEX).map((part) => {
    if (!part) return part;
    if (part.match(/^https?:\/\//))
      return { url: part.replace(/[.,;:!?)]+$/, "") };
    if (part.match(/^www\./))
      return { url: `https://${part.replace(/[.,;:!?)]+$/, "")}` };
    return part;
  });
}

function getRecurrenceLabel(recurrence: string[] | undefined): string {
  if (!recurrence?.length) return "Never";
  const rrule = recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rrule) return "Never";
  const exactOpt = RECURRENCE_OPTIONS.find((o) => o.value === rrule);
  if (exactOpt) return exactOpt.label;
  return "Custom";
}

type ModalSide = "left" | "right" | "above" | "below";
type ReminderMethod = "email" | "popup";
type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
type ReminderUnit = "minutes" | "hours" | "days" | "weeks" | "on_date";
type ReminderRelation = "before" | "after";

const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
];
const REMINDER_UNITS: readonly ReminderUnit[] = [
  "minutes",
  "hours",
  "days",
  "weeks",
  "on_date",
];
const REMINDER_RELATIONS: readonly ReminderRelation[] = ["before", "after"];
const RECURRENCE_FREQUENCY_SET = new Set<string>(RECURRENCE_FREQUENCIES);
const REMINDER_UNIT_SET = new Set<string>(REMINDER_UNITS);
const REMINDER_RELATION_SET = new Set<string>(REMINDER_RELATIONS);

function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return RECURRENCE_FREQUENCY_SET.has(value);
}

function isReminderUnit(value: string): value is ReminderUnit {
  return REMINDER_UNIT_SET.has(value);
}

function isReminderRelation(value: string): value is ReminderRelation {
  return REMINDER_RELATION_SET.has(value);
}

function getReminderCount(
  reminders:
    | {
        useDefault?: boolean;
        overrides?: { method: string; minutes: number }[];
      }
    | undefined,
): number {
  if (reminders?.useDefault || !reminders?.overrides?.length) return 0;
  return reminders.overrides.length;
}

const PARTICIPANT_COLORS = [
  "#1761C7",
  "#FF3B30",
  "#34C759",
  "#FF9500",
  "#AF52DE",
  "#FFD60A",
  "#00C7BE",
  "#FF2D55",
];

function getParticipantColor(email: string): string {
  const index =
    email.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[index];
}

function getInitials(email: string): string {
  const name = email.split("@")[0];
  return name.charAt(0).toUpperCase();
}

function normalizeEventFormData(data: EventFormData) {
  return {
    ...data,
    reminders: {
      useDefault: data.reminders?.useDefault ?? false,
      overrides: [...(data.reminders?.overrides ?? [])].sort(
        (a, b) => a.minutes - b.minutes,
      ),
    },
    recurrence: [...(data.recurrence ?? [])],
    attendees: [...(data.attendees ?? [])],
  };
}

export function EventModal() {
  const { selectedEventId, selectedEventAnchor, selectEvent } =
    useCalendarStore();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const { events } = useEventsContext();
  const calendarVisibility = useCalendarsStore((state) => state.visibility);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionOverlayRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false);
  const [isDescriptionFocused, setIsDescriptionFocused] = useState(false);
  const [isAllDayLocal, setIsAllDayLocal] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const prevSelectedEventId = useRef<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [customReminderOpen, setCustomReminderOpen] = useState(false);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);
  const [customRecurrenceFreq, setCustomRecurrenceFreq] =
    useState<RecurrenceFrequency>("WEEKLY");
  const [customRecurrenceInterval, setCustomRecurrenceInterval] = useState("1");
  const [customRecurrenceByDay, setCustomRecurrenceByDay] = useState<string[]>(
    [],
  );

  const customRecurrenceRef = useRef<HTMLDivElement>(null);
  const [customReminderMethod, setCustomReminderMethod] =
    useState<ReminderMethod>("popup");
  const [customReminderValue, setCustomReminderValue] = useState("15");
  const [customReminderUnit, setCustomReminderUnit] =
    useState<ReminderUnit>("minutes");
  const [customReminderRelation, setCustomReminderRelation] =
    useState<ReminderRelation>("before");
  const [customReminderDate, setCustomReminderDate] = useState("");
  const [customReminderTime, setCustomReminderTime] = useState("09:00");
  const [customReminderError, setCustomReminderError] = useState<string | null>(
    null,
  );

  const [isTransitioning, setIsTransitioning] = useState(true);
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [rsvpOpen, setRsvpOpen] = useState(false);

  useEffect(() => {
    setRecurrenceOpen(false);
    setReminderOpen(false);
    setColorOpen(false);
    setCustomReminderOpen(false);
    setCustomRecurrenceOpen(false);

    if (!!selectedEventId) {
      const isSwitching =
        prevSelectedEventId.current !== null &&
        prevSelectedEventId.current !== selectedEventId;

      setIsMounted(true);
      setIsVisible(false);

      if (isSwitching) {
        setIsTransitioning(false);
        setActiveEventId(selectedEventId);
      }

      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isSwitching) {
            setIsTransitioning(true);
          }
          if (!isSwitching) setActiveEventId(selectedEventId);
          setIsVisible(true);
        });
      });
      prevSelectedEventId.current = selectedEventId;

      let focusTimer: NodeJS.Timeout;
      if (selectedEventId.startsWith("new-")) {
        focusTimer = setTimeout(() => titleInputRef.current?.focus(), 100);
      }

      return () => {
        cancelAnimationFrame(frame);
        if (focusTimer) clearTimeout(focusTimer);
      };
    } else {
      setIsVisible(false);
      prevSelectedEventId.current = null;
      const timer = setTimeout(() => {
        setActiveEventId(null);
        setIsMounted(false);
        setPosition(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selectedEventId]);

  const isOpen = !!activeEventId;
  const isNew = activeEventId?.startsWith("new-");

  const defaultCalendarId = useMemo(() => {
    const visibleIds = Object.entries(calendarVisibility)
      .filter(([, value]) => value.visible)
      .map(([id]) => id);
    const allIds = Object.keys(calendarVisibility);
    return visibleIds[0] || allIds[0] || events[0]?.calendarId || "";
  }, [calendarVisibility, events]);

  const existingEvent = useMemo(() => {
    if (!activeEventId) return undefined;
    return events.find((event) => event.id === activeEventId);
  }, [events, activeEventId]);

  const form = useForm<EventFormData>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: getDefaultEventValues(undefined, defaultCalendarId),
  });

  useEffect(() => {
    if (isNew && activeEventId) {
      const dateStr = activeEventId.replace("new-", "");
      const defaults = getDefaultEventValues(
        new Date(Number(dateStr) || dateStr),
        defaultCalendarId,
      );
      form.reset(defaults);
      setIsAllDayLocal(false);
    } else if (existingEvent) {
      const isAllDay =
        !!existingEvent.start?.date && !existingEvent.start?.dateTime;
      setIsAllDayLocal(isAllDay);
      form.reset({
        summary: existingEvent.summary || "",
        description: existingEvent.description || "",
        location: existingEvent.location || "",
        start: existingEvent.start || { dateTime: new Date().toISOString() },
        end: existingEvent.end || { dateTime: new Date().toISOString() },
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
    setIsDescriptionExpanded(false);
    setParticipantEmail("");
    setParticipantsExpanded(false);
    setRsvpOpen(false);
  }, [activeEventId]);

  useLayoutEffect(() => {
    const textarea = descriptionInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const fullHeight = textarea.scrollHeight;
    const canExpand = fullHeight > MAX_DESCRIPTION_PREVIEW_HEIGHT + 4;
    setDescriptionOverflowing(canExpand);
    if (isDescriptionExpanded) {
      textarea.style.overflowY = "auto";
      textarea.style.maxHeight = "320px";
      textarea.style.height = `${fullHeight}px`;
    } else {
      textarea.style.overflowY = "hidden";
      textarea.style.maxHeight = "none";
      textarea.style.height = `${Math.min(fullHeight, MAX_DESCRIPTION_PREVIEW_HEIGHT)}px`;
      textarea.scrollTop = 0;
      descriptionOverlayRef.current &&
        (descriptionOverlayRef.current.scrollTop = 0);
    }
    if (!canExpand && isDescriptionExpanded) setIsDescriptionExpanded(false);
  }, [form.watch("description"), isDescriptionExpanded]);

  useLayoutEffect(() => {
    const textarea = titleInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [form.watch("summary")]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
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
    const handleClick = (e: Event) => {
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
      if (
        colorRef.current?.contains(target) ||
        colorButtonRef.current?.contains(target)
      )
        return;
      if (customReminderRef.current?.contains(target)) return;
      if (customRecurrenceRef.current?.contains(target)) return;
      if (target.closest("[data-participants-section]")) return;
      if (target.closest("[data-calendar-event]")) return;
      if ((target as HTMLInputElement).type === "checkbox") return;
      handleClose();
    };
    if (isOpen) document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isOpen, handleClose]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (customReminderOpen) {
        if (customReminderRef.current?.contains(target)) return;
        setCustomReminderOpen(false);
        return;
      }
      if (customRecurrenceOpen) {
        if (customRecurrenceRef.current?.contains(target)) return;
        setCustomRecurrenceOpen(false);
        return;
      }
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
      if (
        colorRef.current?.contains(target) ||
        colorButtonRef.current?.contains(target)
      )
        return;
      setRecurrenceOpen(false);
      setReminderOpen(false);
      setColorOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const handleSubmit = form.handleSubmit(async (data: EventFormData) => {
    const calendarId = data.calendarId || defaultCalendarId;
    if (!calendarId) return;

    if (isNew) {
      await createEvent.mutateAsync({ calendarId, event: data });
    } else {
      await updateEvent.mutateAsync({
        calendarId: existingEvent?.calendarId || calendarId,
        eventId: activeEventId!,
        event: data,
      });
    }
    handleClose();
  });

  const toggleReminder = (minutes: number | null) => {
    if (minutes === null) {
      form.setValue(
        "reminders",
        { useDefault: false, overrides: [] },
        { shouldDirty: true },
      );
      return;
    }

    const currentOverrides = form.getValues("reminders")?.overrides ?? [];
    const hasReminder = currentOverrides.some(
      (override) => override.minutes === minutes,
    );
    const nextOverrides: { method: "email" | "popup"; minutes: number }[] =
      hasReminder
        ? currentOverrides.filter((override) => override.minutes !== minutes)
        : [...currentOverrides, { method: "popup", minutes }];

    nextOverrides.sort((a, b) => a.minutes - b.minutes);

    form.setValue(
      "reminders",
      { useDefault: false, overrides: nextOverrides },
      { shouldDirty: true },
    );
  };

  const saveCustomRecurrence = () => {
    let rrule = `RRULE:FREQ=${customRecurrenceFreq}`;
    const interval = Number(customRecurrenceInterval);
    if (interval > 1) {
      rrule += `;INTERVAL=${interval}`;
    }
    if (customRecurrenceFreq === "WEEKLY" && customRecurrenceByDay.length > 0) {
      rrule += `;BYDAY=${customRecurrenceByDay.join(",")}`;
    }
    form.setValue("recurrence", [rrule], { shouldDirty: true });
    setCustomRecurrenceOpen(false);
  };

  const saveCustomReminder = () => {
    setCustomReminderError(null);

    let minutes = 0;
    if (customReminderUnit !== "on_date") {
      const val = Number(customReminderValue);
      if (!Number.isFinite(val) || val < 0) return;
      let multiplier = 1;
      if (customReminderUnit === "hours") multiplier = 60;
      if (customReminderUnit === "days") multiplier = 1440;
      if (customReminderUnit === "weeks") multiplier = 10080;

      minutes = val * multiplier;
      if (customReminderRelation === "after") {
        minutes = -minutes;
      }
    } else {
      const startDateTimeStr = form.getValues("start")?.dateTime;
      const startDateStr = form.getValues("start")?.date;

      let startMs = 0;
      if (startDateTimeStr) {
        startMs = new Date(startDateTimeStr).getTime();
      } else if (startDateStr) {
        startMs = new Date(`${startDateStr}T00:00:00`).getTime();
      } else {
        startMs = new Date().getTime();
      }

      const reminderDateObj = new Date(
        `${customReminderDate}T${customReminderTime}:00`,
      );
      const reminderMs = reminderDateObj.getTime();

      minutes = Math.round((startMs - reminderMs) / 60000);
    }

    if (minutes < 0) {
      setCustomReminderError("Reminder must be at or before the event");
      return;
    }

    const currentOverrides = form.getValues("reminders")?.overrides ?? [];
    const nextOverrides: { method: "email" | "popup"; minutes: number }[] =
      currentOverrides.filter(
        (override) =>
          !(
            override.minutes === minutes &&
            override.method === customReminderMethod
          ),
      );

    nextOverrides.push({ method: customReminderMethod, minutes });
    nextOverrides.sort((a, b) => a.minutes - b.minutes);

    form.setValue(
      "reminders",
      { useDefault: false, overrides: nextOverrides },
      { shouldDirty: true },
    );
    setCustomReminderOpen(false);
  };

  useEffect(() => {
    if (customReminderOpen) {
      setCustomReminderError(null);
      const startDateTimeStr = form.getValues("start")?.dateTime;
      const startDateStr = form.getValues("start")?.date;
      let date = toDateString(new Date());
      let time = "09:00";
      if (startDateTimeStr) {
        const d = new Date(startDateTimeStr);
        date = toDateString(d);
        time = formatTimeFromISO(startDateTimeStr);
      } else if (startDateStr) {
        date = startDateStr;
      }
      setCustomReminderDate(date);
      setCustomReminderTime(time);
      setCustomReminderValue("15");
      setCustomReminderUnit("minutes");
      setCustomReminderRelation("before");
    }
  }, [customReminderOpen, form]);

  useEffect(() => {
    if (customReminderError) {
      setCustomReminderError(null);
    }
  }, [
    customReminderValue,
    customReminderUnit,
    customReminderRelation,
    customReminderDate,
    customReminderTime,
    customReminderMethod,
  ]);

  const recurrenceRef = useRef<HTMLDivElement>(null);
  const reminderRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const rsvpButtonRef = useRef<HTMLButtonElement>(null);
  const customReminderRef = useRef<HTMLDivElement>(null);
  const recurrenceButtonRef = useRef<HTMLButtonElement>(null);
  const reminderButtonRef = useRef<HTMLButtonElement>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    side: ModalSide;
    connectorTop?: number;
    connectorLeft?: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !selectedEventId) return;
    const anchor = selectedEventAnchor;
    if (!anchor) {
      setPosition(null);
      return;
    }
    const anchorCenterX = anchor.left + anchor.width / 2;
    const anchorCenterY = anchor.top + anchor.height / 2;
    const spaceRight = window.innerWidth - anchor.right - GAP;
    const spaceLeft = anchor.left - GAP;
    const spaceAbove = anchor.top - GAP;
    const spaceBelow = window.innerHeight - anchor.bottom - GAP;

    const fitsRight = spaceRight >= MODAL_WIDTH;
    const fitsLeft = spaceLeft >= MODAL_WIDTH;
    const fitsAbove = spaceAbove >= MODAL_HEIGHT;
    const fitsBelow = spaceBelow >= MODAL_HEIGHT;

    const triangleSize = 10;
    const triangleHeight = 20;

    const candidates: { side: ModalSide; space: number }[] = [];
    if (fitsRight) candidates.push({ side: "right", space: spaceRight });
    if (fitsLeft) candidates.push({ side: "left", space: spaceLeft });
    if (fitsBelow) candidates.push({ side: "below", space: spaceBelow });
    if (fitsAbove) candidates.push({ side: "above", space: spaceAbove });

    const side =
      candidates.length > 0
        ? candidates[0].side
        : spaceRight >= spaceLeft
          ? "right"
          : "left";

    let left: number;
    let top: number;
    let connectorTop: number | undefined;
    let connectorLeft: number | undefined;

    // Use actual height if available for better centering
    const currentHeight = modalRef.current?.offsetHeight || MODAL_HEIGHT;

    if (side === "right") {
      left = anchor.right + GAP;
      top = anchorCenterY - currentHeight / 2;
      top = Math.max(8, Math.min(top, window.innerHeight - currentHeight - 8));
      connectorTop = anchorCenterY - top - triangleHeight / 2;
    } else if (side === "left") {
      left = anchor.left - GAP - MODAL_WIDTH;
      top = anchorCenterY - currentHeight / 2;
      top = Math.max(8, Math.min(top, window.innerHeight - currentHeight - 8));
      connectorTop = anchorCenterY - top - triangleHeight / 2;
    } else if (side === "above") {
      left = anchorCenterX - MODAL_WIDTH / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - MODAL_WIDTH - 8));
      top = anchor.top - currentHeight - GAP;
      connectorLeft = Math.max(
        8,
        Math.min(anchorCenterX - left - triangleSize, MODAL_WIDTH - 24),
      );
    } else {
      left = anchorCenterX - MODAL_WIDTH / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - MODAL_WIDTH - 8));
      top = anchor.bottom + GAP;
      connectorLeft = Math.max(
        8,
        Math.min(anchorCenterX - left - triangleSize, MODAL_WIDTH - 24),
      );
    }

    setPosition({ left, top, side, connectorTop, connectorLeft });
  }, [isOpen, selectedEventAnchor, selectedEventId]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!isNew && activeEventId) {
      const calendarId = existingEvent?.calendarId || defaultCalendarId;
      if (!calendarId) return;
      await deleteEvent.mutateAsync({ calendarId, eventId: activeEventId });
      setShowDeleteConfirm(false);
      handleClose();
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  if (!isMounted) return null;

  const watchedColor = form.watch("color") as EventColor;
  const colors = EVENT_COLORS[watchedColor || "blue"];
  const startValue = form.watch("start");
  const endValue = form.watch("end");
  const currentValues = form.watch();
  const currentSnapshot = JSON.stringify(
    normalizeEventFormData(currentValues as EventFormData),
  );
  const defaultSnapshot = JSON.stringify(
    normalizeEventFormData(
      (form.formState.defaultValues ??
        getDefaultEventValues(undefined, defaultCalendarId)) as EventFormData,
    ),
  );
  const isFormChanged = currentSnapshot !== defaultSnapshot;

  const { ref: registerSummaryRef, ...summaryRegisterProps } =
    form.register("summary");
  const summaryRef = (e: HTMLTextAreaElement | null) => {
    if (typeof registerSummaryRef === "function") {
      registerSummaryRef(e);
    }
    if (e) {
      titleInputRef.current = e;
    }
  };

  const { ref: registerDescriptionRef, ...descriptionRegisterProps } =
    form.register("description");
  const descriptionRef = (e: HTMLTextAreaElement | null) => {
    if (typeof registerDescriptionRef === "function") {
      registerDescriptionRef(e);
    }
    if (e) {
      descriptionInputRef.current = e;
    }
  };

  return ReactDOM.createPortal(
    <>
      <div
        className={`fixed inset-0 z-[3999] transition-opacity duration-250 ease-out ${isVisible ? "opacity-100" : "opacity-0"} pointer-events-none`}
      />

      <div
        ref={modalRef}
        className={`fixed z-[4000] bg-white max-w-[calc(100vw-48px)] border border-gray-200 rounded-[22px] overflow-visible shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] origin-center ${
          isTransitioning
            ? "transition-[opacity,transform] duration-250 ease-out"
            : ""
        } ${isVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{
          width: MODAL_WIDTH,
          ...(position
            ? {
                left: position.left,
                top: position.top,
                transform: isVisible ? "scale(1)" : "scale(0.98)",
              }
            : {
                left: "50%",
                top: "auto",
                bottom: 32,
                transform: `translateX(-50%) ${isVisible ? "scale(1)" : "scale(0.98)"}`,
              }),
        }}
      >
        {position &&
          (position.connectorTop != null || position.connectorLeft != null) && (
            <>
              {position.side === "left" && position.connectorTop != null && (
                <>
                  <div
                    className="absolute w-0 h-0 border-t-[11px] border-t-transparent border-b-[11px] border-b-transparent -z-10"
                    style={{
                      right: "-11px",
                      borderLeftWidth: 13,
                      borderLeftColor: "rgb(229 231 235)",
                      top: position.connectorTop - 1,
                    }}
                  />
                  <div
                    className="absolute w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent"
                    style={{
                      right: "-10px",
                      borderLeftWidth: 12,
                      borderLeftColor: "white",
                      top: position.connectorTop,
                    }}
                  />
                </>
              )}
              {position.side === "right" && position.connectorTop != null && (
                <>
                  <div
                    className="absolute w-0 h-0 border-t-[11px] border-t-transparent border-b-[11px] border-b-transparent -z-10"
                    style={{
                      left: "-11px",
                      borderRightWidth: 13,
                      borderRightColor: "rgb(229 231 235)",
                      top: position.connectorTop - 1,
                    }}
                  />
                  <div
                    className="absolute w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent"
                    style={{
                      left: "-10px",
                      borderRightWidth: 12,
                      borderRightColor: "white",
                      top: position.connectorTop,
                    }}
                  />
                </>
              )}
              {position.side === "above" && position.connectorLeft != null && (
                <>
                  <div
                    className="absolute w-0 h-0 border-l-[11px] border-l-transparent border-r-[11px] border-r-transparent -z-10"
                    style={{
                      bottom: "-11px",
                      borderTopWidth: 13,
                      borderTopColor: "rgb(229 231 235)",
                      left: position.connectorLeft - 1,
                    }}
                  />
                  <div
                    className="absolute w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent"
                    style={{
                      bottom: "-10px",
                      borderTopWidth: 12,
                      borderTopColor: "white",
                      left: position.connectorLeft,
                    }}
                  />
                </>
              )}
              {position.side === "below" && position.connectorLeft != null && (
                <>
                  <div
                    className="absolute w-0 h-0 border-l-[11px] border-l-transparent border-r-[11px] border-r-transparent -z-10"
                    style={{
                      top: "-11px",
                      borderBottomWidth: 13,
                      borderBottomColor: "rgb(229 231 235)",
                      left: position.connectorLeft - 1,
                    }}
                  />
                  <div
                    className="absolute w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent"
                    style={{
                      top: "-10px",
                      borderBottomWidth: 12,
                      borderBottomColor: "white",
                      left: position.connectorLeft,
                    }}
                  />
                </>
              )}
            </>
          )}
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              e.target instanceof HTMLElement &&
              e.target.tagName !== "TEXTAREA"
            ) {
              e.preventDefault();
              handleSubmit();
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

          <div
            className={`px-4 pt-[14px] ${(form.watch("description") || descriptionOverflowing) && descriptionOverflowing ? "pb-2" : "pb-0"}`}
            style={{
              paddingBottom:
                !form.watch("description") && !descriptionOverflowing
                  ? 5
                  : undefined,
            }}
          >
            <div className="flex items-start gap-3">
              {!isNew && (
                <button
                  type="button"
                  className="w-[20px] h-[20px] flex items-center justify-center border-2 rounded-[6px] transition-colors mt-[8px] border-gray-300 text-transparent hover:border-green-500"
                >
                  <Check size={14} />
                </button>
              )}
              <div className="flex-1 min-w-0 pr-5">
                <textarea
                  {...summaryRegisterProps}
                  ref={summaryRef}
                  placeholder="New event"
                  rows={1}
                  className="w-full px-0 py-1 text-xl font-semibold text-gray-900 border-none focus:outline-none focus:ring-0 placeholder-gray-400 bg-transparent resize-none overflow-hidden"
                />
                <>
                  <div className="relative">
                    <textarea
                      {...descriptionRegisterProps}
                      ref={descriptionRef}
                      placeholder="Add description"
                      rows={1}
                      onFocus={() => setIsDescriptionFocused(true)}
                      onBlur={() => setIsDescriptionFocused(false)}
                      className="w-full px-0 text-sm text-gray-500 border-none focus:outline-none focus:ring-0 resize-none bg-transparent placeholder-gray-400 custom-scrollbar"
                      style={{
                        minHeight: descriptionOverflowing ? "32px" : "0px",
                        lineHeight: `${DESCRIPTION_LINE_HEIGHT}px`,
                        pointerEvents:
                          !isDescriptionExpanded && descriptionOverflowing
                            ? "none"
                            : "auto",
                        color:
                          !isDescriptionFocused && form.watch("description")
                            ? "transparent"
                            : undefined,
                        caretColor:
                          !isDescriptionFocused && form.watch("description")
                            ? "transparent"
                            : undefined,
                      }}
                    />
                    {!isDescriptionFocused && form.watch("description") && (
                      <div
                        ref={descriptionOverlayRef}
                        className={`absolute inset-0 text-sm text-gray-500 whitespace-pre-wrap break-words cursor-text ${isDescriptionExpanded ? "overflow-y-auto" : "overflow-hidden"}`}
                        style={{
                          lineHeight: `${DESCRIPTION_LINE_HEIGHT}px`,
                          height: isDescriptionExpanded
                            ? "auto"
                            : descriptionOverflowing
                              ? MAX_DESCRIPTION_PREVIEW_HEIGHT
                              : "auto",
                          maxHeight: isDescriptionExpanded ? 320 : undefined,
                        }}
                        onClick={() => descriptionInputRef.current?.focus()}
                      >
                        {linkifyText(form.watch("description") ?? "").map(
                          (part, i) =>
                            typeof part === "string" ? (
                              <span key={i}>{part}</span>
                            ) : (
                              <a
                                key={i}
                                href={part.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {part.url}
                              </a>
                            ),
                        )}
                      </div>
                    )}
                  </div>
                  {descriptionOverflowing && (
                    <div className="pb-2 pt-0" style={{ marginTop: "-15px" }}>
                      <button
                        type="button"
                        onClick={() => setIsDescriptionExpanded((p) => !p)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer p-2 -m-2"
                      >
                        {isDescriptionExpanded ? "See less" : "See more"}
                      </button>
                    </div>
                  )}
                </>
              </div>
            </div>
          </div>

          <div className="border-b border-gray-100" />

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Users className="text-gray-400 mt-1 flex-shrink-0" size={20} />
                <div className="flex-1 space-y-2.5 min-w-0">
                  <input
                    type="email"
                    value={participantEmail}
                    onChange={(e) => setParticipantEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const email = participantEmail.trim().toLowerCase();
                        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                          const current = form.getValues("attendees") ?? [];
                          if (
                            !current.some(
                              (a) => a.email.toLowerCase() === email,
                            )
                          ) {
                            form.setValue(
                              "attendees",
                              [
                                ...current,
                                { email, responseStatus: "needsAction" },
                              ],
                              { shouldDirty: true },
                            );
                            setParticipantEmail("");
                          }
                        }
                      }
                    }}
                    onBlur={() => {
                      const email = participantEmail.trim().toLowerCase();
                      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        const current = form.getValues("attendees") ?? [];
                        if (
                          !current.some((a) => a.email.toLowerCase() === email)
                        ) {
                          form.setValue(
                            "attendees",
                            [
                              ...current,
                              { email, responseStatus: "needsAction" },
                            ],
                            { shouldDirty: true },
                          );
                          setParticipantEmail("");
                        }
                      }
                    }}
                    placeholder="Add guests"
                    className="w-full px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400"
                  />
                  {(form.watch("attendees") ?? []).length > 0 && (
                    <div data-participants-section>
                      {!participantsExpanded ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            {(() => {
                              const attendees = form.watch("attendees") ?? [];
                              const going = attendees.filter(
                                (a) => a.responseStatus === "accepted",
                              ).length;
                              const declined = attendees.filter(
                                (a) => a.responseStatus === "declined",
                              ).length;
                              const awaiting = attendees.filter(
                                (a) =>
                                  a.responseStatus !== "accepted" &&
                                  a.responseStatus !== "declined",
                              ).length;
                              const parts = [
                                going > 0 && `${going} going`,
                                declined > 0 && `${declined} declined`,
                                awaiting > 0 && `${awaiting} awaiting`,
                              ].filter(Boolean);
                              return (
                                <div className="text-xs text-gray-500">
                                  <span className="font-medium text-gray-700">
                                    {attendees.length} guest
                                    {attendees.length !== 1 ? "s" : ""} –
                                  </span>
                                  {parts.length > 0 && (
                                    <span className="ml-1">
                                      {parts.join(", ")}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setParticipantsExpanded(true);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors -mr-1"
                            >
                              <ChevronDown size={16} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            {(form.watch("attendees") ?? [])
                              .slice(0, 5)
                              .map((attendee, i) => {
                                const isAccepted =
                                  attendee.responseStatus === "accepted";
                                const isDeclined =
                                  attendee.responseStatus === "declined";
                                return (
                                  <div
                                    key={attendee.email}
                                    className="relative group"
                                    style={{
                                      marginLeft: i > 0 ? -8 : 0,
                                      zIndex: 5 - i,
                                    }}
                                  >
                                    <div
                                      className="rounded-full text-xs font-semibold text-white flex items-center justify-center border-2 border-white"
                                      style={{
                                        backgroundColor: getParticipantColor(
                                          attendee.email,
                                        ),
                                        width: 33.6,
                                        height: 33.6,
                                      }}
                                      title={
                                        attendee.displayName || attendee.email
                                      }
                                    >
                                      {getInitials(attendee.email)}
                                    </div>
                                    {isAccepted && (
                                      <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center border border-white">
                                        <Check
                                          size={10}
                                          className="text-white"
                                          strokeWidth={3}
                                        />
                                      </div>
                                    )}
                                    {isDeclined && (
                                      <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center border border-white">
                                        <X
                                          size={10}
                                          className="text-white"
                                          strokeWidth={3}
                                        />
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const list =
                                          form.getValues("attendees") ?? [];
                                        const idx = list.findIndex(
                                          (a) => a.email === attendee.email,
                                        );
                                        form.setValue(
                                          "attendees",
                                          list.filter((_, j) => j !== idx),
                                          { shouldDirty: true },
                                        );
                                      }}
                                      className="absolute -bottom-1 -right-1 w-4 h-4 bg-white hover:bg-red-50 rounded-full flex items-center justify-center border border-gray-300 hover:border-red-400 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-150 z-10"
                                      aria-label={`Remove ${attendee.email}`}
                                    >
                                      <X
                                        size={10}
                                        className="text-gray-600 hover:text-red-600"
                                        strokeWidth={2.5}
                                      />
                                    </button>
                                  </div>
                                );
                              })}
                            {(form.watch("attendees") ?? []).length > 5 && (
                              <div
                                className="rounded-full text-xs font-semibold bg-gray-200 text-gray-600 flex items-center justify-center border-2 border-white"
                                style={{
                                  marginLeft: -5,
                                  zIndex: 0,
                                  width: 33.6,
                                  height: 33.6,
                                }}
                              >
                                +{(form.watch("attendees") ?? []).length - 5}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="text-xs text-gray-500">
                              <span className="font-medium text-gray-700">
                                {(form.watch("attendees") ?? []).length} guest
                                {(form.watch("attendees") ?? []).length !== 1
                                  ? "s"
                                  : ""}{" "}
                                –
                              </span>
                              {(() => {
                                const attendees = form.watch("attendees") ?? [];
                                const going = attendees.filter(
                                  (a) => a.responseStatus === "accepted",
                                ).length;
                                const declined = attendees.filter(
                                  (a) => a.responseStatus === "declined",
                                ).length;
                                const awaiting = attendees.filter(
                                  (a) =>
                                    a.responseStatus !== "accepted" &&
                                    a.responseStatus !== "declined",
                                ).length;
                                const parts = [
                                  going > 0 && `${going} going`,
                                  declined > 0 && `${declined} declined`,
                                  awaiting > 0 && `${awaiting} awaiting`,
                                ].filter(Boolean);
                                return parts.length > 0 ? (
                                  <span className="ml-1">
                                    {parts.join(", ")}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setParticipantsExpanded(false);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                            >
                              <ChevronUp size={16} />
                            </button>
                          </div>
                          <div className="flex flex-col gap-0.5 custom-scrollbar overflow-y-auto max-h-[200px]">
                            {(form.watch("attendees") ?? []).map((attendee) => {
                              const isAccepted =
                                attendee.responseStatus === "accepted";
                              const isDeclined =
                                attendee.responseStatus === "declined";
                              const isOrganizer =
                                existingEvent?.organizer?.email ===
                                attendee.email;
                              return (
                                <div
                                  key={attendee.email}
                                  className="flex items-center gap-2 py-1.5 group min-h-[36px]"
                                >
                                  <div className="relative flex-shrink-0">
                                    <div
                                      className="rounded-full text-xs font-semibold text-white flex items-center justify-center"
                                      style={{
                                        backgroundColor: getParticipantColor(
                                          attendee.email,
                                        ),
                                        width: 28,
                                        height: 28,
                                      }}
                                    >
                                      {getInitials(attendee.email)}
                                    </div>
                                    {isAccepted && (
                                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center border border-white">
                                        <Check
                                          size={8}
                                          className="text-white"
                                          strokeWidth={3}
                                        />
                                      </div>
                                    )}
                                    {isDeclined && (
                                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center border border-white">
                                        <X
                                          size={8}
                                          className="text-white"
                                          strokeWidth={3}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className={`text-sm text-gray-900 truncate ${isOrganizer ? "font-semibold" : ""}`}
                                    >
                                      {attendee.displayName || attendee.email}
                                    </div>
                                    {isOrganizer && (
                                      <div className="text-xs text-gray-500">
                                        Organizer
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const list =
                                        form.getValues("attendees") ?? [];
                                      const idx = list.findIndex(
                                        (a) => a.email === attendee.email,
                                      );
                                      form.setValue(
                                        "attendees",
                                        list.filter((_, j) => j !== idx),
                                        { shouldDirty: true },
                                      );
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 rounded transition-all"
                                    aria-label={`Remove ${attendee.email}`}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="submit"
                disabled={!isFormChanged}
                className={`flex-shrink-0 px-4 py-1.5 text-sm rounded-md font-medium whitespace-nowrap self-start ${
                  !isFormChanged
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-green-600 text-white hover:bg-green-700"
                }`}
              >
                {isNew ? "Create event" : "Update event"}
              </button>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex flex-wrap items-center gap-2">
              <MapPin className="text-gray-400 flex-shrink-0" size={20} />
              <div className="flex-1 min-w-0">
                <input
                  {...form.register("location")}
                  placeholder="Add location or URL"
                  className="w-full px-0 py-1 text-sm text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-400"
                />
              </div>
              {(() => {
                const location = form.watch("location")?.trim() ?? "";
                const conf = existingEvent?.conferenceData as
                  | {
                      hangoutLink?: string;
                      entryPoints?: { entryPointType: string; uri: string }[];
                    }
                  | undefined;
                const meetingLink =
                  conf?.hangoutLink ??
                  conf?.entryPoints?.find(
                    (ep) => ep.entryPointType === "video" && ep.uri,
                  )?.uri ??
                  "";
                const isLocationUrl =
                  !!location &&
                  (() => {
                    try {
                      return ["http:", "https:"].includes(
                        new URL(location).protocol,
                      );
                    } catch {
                      return false;
                    }
                  })();
                const googleMapsLink =
                  location && !isLocationUrl
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
                    : "";
                if (meetingLink || isLocationUrl) {
                  return (
                    <a
                      href={meetingLink || location}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs flex-shrink-0 bg-blue-500/80 text-white hover:bg-blue-600/80 border border-blue-500/50 origin-right"
                      style={{ transform: "scale(0.85)" }}
                    >
                      <Video size={16} className="text-white" />
                      <span className="hidden sm:inline">Join meeting</span>
                    </a>
                  );
                }
                if (googleMapsLink) {
                  return (
                    <a
                      href={googleMapsLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2 py-1.5 bg-white/80 border border-gray-200 rounded-lg hover:bg-white/90 text-xs text-gray-700 flex-shrink-0 origin-right"
                      style={{ transform: "scale(0.85)" }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M12 2C8.13 2 5 5.13 5 9c0 4.75 3.75 9.1 6.5 11.36a1 1 0 001 0C15.25 18.1 19 13.75 19 9c0-3.87-3.13-7-7-7zm0 14c-2.76-2.5-5-6.02-5-7.5 0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.48-2.24 5-5 7.5zm0-10a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
                        />
                      </svg>
                      <span className="hidden sm:inline">Get directions</span>
                    </a>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-gray-100">
            <div className="flex items-start gap-[9px]">
              <div
                className="flex flex-col items-center gap-[10px] flex-shrink-0"
                style={{ marginTop: 4 }}
              >
                <div className="h-[20px] flex items-center">
                  <Clock className="text-gray-400" size={17} />
                </div>
                <div className="h-[20px] flex items-center">
                  <Calendar className="text-gray-400" size={17} />
                </div>
              </div>
              <div className="flex-1" style={{ marginTop: 4 }}>
                {!isAllDayLocal && (
                  <div className="h-[20px] mb-[10px] flex items-center gap-2 text-sm text-gray-900">
                    <Controller
                      name="start"
                      control={form.control}
                      render={({ field }) => (
                        <input
                          type="time"
                          value={formatTimeFromISO(field.value?.dateTime)}
                          onChange={(e) => {
                            const currentDate = formatDateFromISO(
                              field.value?.dateTime,
                              field.value?.date,
                            );
                            field.onChange({
                              ...field.value,
                              dateTime: combineDateAndTime(
                                currentDate,
                                e.target.value,
                              ),
                              date: undefined,
                            });
                          }}
                          className="px-0 py-0.5 border-none focus:outline-none text-sm font-bold bg-transparent text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
                          style={{ width: 88 }}
                        />
                      )}
                    />
                    <span className="text-gray-400 font-semibold w-3 text-center">
                      -
                    </span>
                    <Controller
                      name="end"
                      control={form.control}
                      render={({ field }) => (
                        <input
                          type="time"
                          value={formatTimeFromISO(field.value?.dateTime)}
                          onChange={(e) => {
                            const currentDate = formatDateFromISO(
                              field.value?.dateTime,
                              field.value?.date,
                            );
                            field.onChange({
                              ...field.value,
                              dateTime: combineDateAndTime(
                                currentDate,
                                e.target.value,
                              ),
                              date: undefined,
                            });
                          }}
                          className="px-0 py-0.5 border-none focus:outline-none text-sm font-bold bg-transparent text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
                          style={{ width: 100 }}
                        />
                      )}
                    />
                    <label className="ml-auto flex w-[180px] items-center justify-end cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isAllDayLocal}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIsAllDayLocal(checked);
                          const startDate = formatDateFromISO(
                            startValue?.dateTime,
                            startValue?.date,
                          );
                          const endDate = formatDateFromISO(
                            endValue?.dateTime,
                            endValue?.date,
                          );
                          if (checked) {
                            form.setValue(
                              "start",
                              { date: startDate },
                              { shouldDirty: true },
                            );
                            form.setValue(
                              "end",
                              { date: endDate },
                              { shouldDirty: true },
                            );
                          } else {
                            form.setValue(
                              "start",
                              {
                                dateTime: combineDateAndTime(
                                  startDate,
                                  "09:00",
                                ),
                              },
                              { shouldDirty: true },
                            );
                            form.setValue(
                              "end",
                              {
                                dateTime: combineDateAndTime(endDate, "10:00"),
                              },
                              { shouldDirty: true },
                            );
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="relative h-5.5 w-10 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:after:translate-x-[18px]" />
                      <span className="ml-3 text-xs leading-none text-gray-600">
                        All day
                      </span>
                    </label>
                  </div>
                )}
                {isAllDayLocal && (
                  <div className="h-[20px] mb-[10px] flex items-center gap-2">
                    <span className="text-sm text-gray-900">All day</span>
                    <label className="ml-auto flex w-[180px] items-center justify-end cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isAllDayLocal}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIsAllDayLocal(checked);
                          const startDate = formatDateFromISO(
                            startValue?.dateTime,
                            startValue?.date,
                          );
                          const endDate = formatDateFromISO(
                            endValue?.dateTime,
                            endValue?.date,
                          );
                          if (checked) {
                            form.setValue(
                              "start",
                              { date: startDate },
                              { shouldDirty: true },
                            );
                            form.setValue(
                              "end",
                              { date: endDate },
                              { shouldDirty: true },
                            );
                          } else {
                            form.setValue(
                              "start",
                              {
                                dateTime: combineDateAndTime(
                                  startDate,
                                  "09:00",
                                ),
                              },
                              { shouldDirty: true },
                            );
                            form.setValue(
                              "end",
                              {
                                dateTime: combineDateAndTime(endDate, "10:00"),
                              },
                              { shouldDirty: true },
                            );
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="relative h-5.5 w-10 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:after:translate-x-[18px]" />
                      <span className="ml-3 text-xs leading-none text-gray-600">
                        All day
                      </span>
                    </label>
                  </div>
                )}
                <div className="h-[20px] flex items-center gap-2 text-sm text-gray-900">
                  <div className="flex items-center gap-2 translate-y-[1px]">
                    <Controller
                      name="start"
                      control={form.control}
                      render={({ field }) => (
                        <input
                          type="date"
                          value={formatDateFromISO(
                            field.value?.dateTime,
                            field.value?.date,
                          )}
                          onChange={(e) => {
                            if (isAllDayLocal) {
                              field.onChange({ date: e.target.value });
                            } else {
                              const currentTime = formatTimeFromISO(
                                field.value?.dateTime,
                              );
                              field.onChange({
                                dateTime: combineDateAndTime(
                                  e.target.value,
                                  currentTime,
                                ),
                              });
                            }
                          }}
                          className="px-0 py-0.5 border-none focus:outline-none text-sm bg-transparent text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
                          style={{ width: 88 }}
                        />
                      )}
                    />
                    <span className="text-gray-400 font-semibold w-3 text-center">
                      -
                    </span>
                    <Controller
                      name="end"
                      control={form.control}
                      render={({ field }) => (
                        <input
                          type="date"
                          value={formatDateFromISO(
                            field.value?.dateTime,
                            field.value?.date,
                          )}
                          onChange={(e) => {
                            if (isAllDayLocal) {
                              field.onChange({ date: e.target.value });
                            } else {
                              const currentTime = formatTimeFromISO(
                                field.value?.dateTime,
                              );
                              field.onChange({
                                dateTime: combineDateAndTime(
                                  e.target.value,
                                  currentTime,
                                ),
                              });
                            }
                          }}
                          className="px-0 py-0.5 border-none focus:outline-none text-sm bg-transparent text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
                          style={{ width: 88 }}
                        />
                      )}
                    />
                  </div>
                  <button
                    ref={recurrenceButtonRef}
                    type="button"
                    onClick={() => {
                      setColorOpen(false);
                      setReminderOpen(false);
                      setRecurrenceOpen((o) => !o);
                      setCustomRecurrenceOpen(false);
                    }}
                    className="ml-auto flex w-[180px] flex-shrink-0 items-center justify-end cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <span className="flex w-10 justify-end">
                      <Repeat
                        className="text-gray-400 flex-shrink-0"
                        size={20}
                      />
                    </span>
                    <span className="ml-3 whitespace-nowrap text-xs text-gray-600">
                      {getRecurrenceLabel(form.watch("recurrence"))}
                    </span>
                  </button>
                  {recurrenceOpen &&
                    recurrenceButtonRef.current &&
                    ReactDOM.createPortal(
                      <div
                        ref={recurrenceRef}
                        data-event-modal-popover="recurrence"
                        onClick={(e) => e.stopPropagation()}
                        className="fixed bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl shadow-[0_10px_50px_rgba(0,0,0,0.15)] py-2 z-[9999] modal-fade-in overflow-hidden flex flex-col items-stretch min-w-[150px]"
                        style={{
                          bottom:
                            window.innerHeight -
                            recurrenceButtonRef.current.getBoundingClientRect()
                              .top +
                            8,
                          left:
                            recurrenceButtonRef.current.getBoundingClientRect()
                              .right - 150,
                        }}
                      >
                        <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                          Recurrence
                        </div>
                        <div className="mx-2 mb-1 border-t border-gray-100" />
                        {RECURRENCE_OPTIONS.map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              form.setValue(
                                "recurrence",
                                opt.value ? [opt.value] : [],
                                { shouldDirty: true },
                              );
                              setRecurrenceOpen(false);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                          >
                            <span
                              className={`flex-1 ${getRecurrenceLabel(form.watch("recurrence")) === opt.label ? "font-semibold" : "font-medium"}`}
                            >
                              {opt.label}
                            </span>
                            {getRecurrenceLabel(form.watch("recurrence")) ===
                              opt.label && (
                              <Check size={16} className="text-gray-400" />
                            )}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const currentRule =
                              form.getValues("recurrence")?.[0] || "";
                            let freq: RecurrenceFrequency = "WEEKLY";
                            let interval = "1";
                            let byDay: string[] = [];

                            if (currentRule.startsWith("RRULE:")) {
                              const freqMatch = currentRule.match(/FREQ=(\w+)/);
                              if (
                                freqMatch &&
                                isRecurrenceFrequency(freqMatch[1])
                              )
                                freq = freqMatch[1];

                              const intervalMatch =
                                currentRule.match(/INTERVAL=(\d+)/);
                              if (intervalMatch) interval = intervalMatch[1];

                              const byDayMatch =
                                currentRule.match(/BYDAY=([^;]+)/);
                              if (byDayMatch) byDay = byDayMatch[1].split(",");
                            }

                            setCustomRecurrenceFreq(freq);
                            setCustomRecurrenceInterval(interval);
                            setCustomRecurrenceByDay(byDay);

                            setCustomRecurrenceOpen(true);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span
                            className={`flex-1 ${getRecurrenceLabel(form.watch("recurrence")) === "Custom" ? "font-semibold" : "font-medium"}`}
                          >
                            Custom...
                          </span>
                          {getRecurrenceLabel(form.watch("recurrence")) ===
                            "Custom" && (
                            <Check size={16} className="text-gray-400" />
                          )}
                        </button>
                      </div>,
                      document.body,
                    )}
                  {customRecurrenceOpen &&
                    recurrenceRef.current &&
                    ReactDOM.createPortal(
                      <div
                        ref={customRecurrenceRef}
                        onClick={(e) => e.stopPropagation()}
                        className="fixed z-[10000] rounded-xl border border-black bg-white/95 p-1.5 shadow-[0_10px_50px_rgba(0,0,0,0.15)] backdrop-blur-md modal-fade-in"
                        style={{
                          width: Math.max(
                            280,
                            recurrenceRef.current.getBoundingClientRect().width,
                          ),
                          bottom:
                            window.innerHeight -
                            recurrenceRef.current.getBoundingClientRect()
                              .bottom,
                          left:
                            window.innerWidth -
                              recurrenceRef.current.getBoundingClientRect()
                                .right >
                            280
                              ? recurrenceRef.current.getBoundingClientRect()
                                  .left
                              : recurrenceRef.current.getBoundingClientRect()
                                  .right - 280,
                        }}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 mt-1 px-1">
                            <span className="text-[13px] text-gray-700 font-medium whitespace-nowrap w-20">
                              Frequency:
                            </span>
                            <div className="relative flex-1 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                              <select
                                value={customRecurrenceFreq}
                                onChange={(e) => {
                                  if (isRecurrenceFrequency(e.target.value)) {
                                    setCustomRecurrenceFreq(e.target.value);
                                  }
                                }}
                                className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 cursor-pointer p-0 m-0 appearance-none focus:ring-0 font-semibold pr-4 relative z-10"
                              >
                                <option
                                  value="DAILY"
                                  className="font-medium text-gray-700"
                                >
                                  Daily
                                </option>
                                <option
                                  value="WEEKLY"
                                  className="font-medium text-gray-700"
                                >
                                  Weekly
                                </option>
                                <option
                                  value="MONTHLY"
                                  className="font-medium text-gray-700"
                                >
                                  Monthly
                                </option>
                                <option
                                  value="YEARLY"
                                  className="font-medium text-gray-700"
                                >
                                  Yearly
                                </option>
                              </select>
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center z-0">
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 8 8"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M1 2.5L4 5.5L7 2.5"
                                    stroke="#6B7280"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 px-1 my-2">
                            <span className="text-[13px] text-gray-700 font-medium whitespace-nowrap">
                              Every
                            </span>
                            <div className="relative w-[48px] px-1 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300 shrink-0">
                              <input
                                type="number"
                                min="1"
                                value={customRecurrenceInterval}
                                onChange={(e) =>
                                  setCustomRecurrenceInterval(e.target.value)
                                }
                                className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 text-center p-0 m-0 focus:ring-0 font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                            <span className="text-[13px] text-gray-700 font-medium">
                              {customRecurrenceFreq === "DAILY" ? "day" : ""}
                              {customRecurrenceFreq === "WEEKLY" ? "week" : ""}
                              {customRecurrenceFreq === "MONTHLY"
                                ? "month"
                                : ""}
                              {customRecurrenceFreq === "YEARLY" ? "year" : ""}
                              {Number(customRecurrenceInterval) > 1 ? "s" : ""}
                              {customRecurrenceFreq === "WEEKLY" ? " on:" : ""}
                            </span>
                          </div>

                          {customRecurrenceFreq === "WEEKLY" && (
                            <div className="flex border border-gray-200 rounded-[6px] overflow-hidden mb-3 mx-1">
                              {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map(
                                (day, i) => {
                                  const isSelected =
                                    customRecurrenceByDay.includes(day);
                                  const labels = [
                                    "M",
                                    "T",
                                    "W",
                                    "T",
                                    "F",
                                    "S",
                                    "S",
                                  ];
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() => {
                                        if (isSelected) {
                                          setCustomRecurrenceByDay(
                                            customRecurrenceByDay.filter(
                                              (d) => d !== day,
                                            ),
                                          );
                                        } else {
                                          setCustomRecurrenceByDay([
                                            ...customRecurrenceByDay,
                                            day,
                                          ]);
                                        }
                                      }}
                                      className={`flex-1 h-8 flex items-center justify-center text-[13px] font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                                        isSelected
                                          ? "bg-gray-200 text-gray-900"
                                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                                      }`}
                                    >
                                      {labels[i]}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-1 px-1 pb-1">
                            <button
                              type="button"
                              onClick={() => setCustomRecurrenceOpen(false)}
                              className="flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={saveCustomRecurrence}
                              className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              OK
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-5">
              <button
                ref={colorButtonRef}
                type="button"
                onClick={() => {
                  setRecurrenceOpen(false);
                  setReminderOpen(false);
                  setColorOpen((o) => !o);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gray-200 transition-colors hover:scale-110"
                style={{ backgroundColor: colors.border }}
              />
              {colorOpen &&
                colorButtonRef.current &&
                ReactDOM.createPortal(
                  <div
                    ref={colorRef}
                    onClick={(e) => e.stopPropagation()}
                    className="fixed z-[9999] w-[120px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_10px_50px_rgba(0,0,0,0.15)] modal-fade-in"
                    style={{
                      bottom:
                        window.innerHeight -
                        colorButtonRef.current.getBoundingClientRect().top +
                        8,
                      left: colorButtonRef.current.getBoundingClientRect().left,
                    }}
                  >
                    <div className="custom-scrollbar max-h-80 overflow-y-auto py-1">
                      {COLOR_OPTIONS.map(([colorKey, colorValue]) => (
                        <button
                          key={colorKey}
                          type="button"
                          onClick={() => {
                            form.setValue("color", colorKey, {
                              shouldDirty: true,
                            });
                            setColorOpen(false);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-gray-900 transition-colors hover:bg-gray-50"
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: colorValue.border }}
                          />
                          <span className="flex-1 text-[13px] leading-none capitalize truncate">
                            {colorKey}
                          </span>
                          {watchedColor === colorKey && (
                            <Check
                              size={14}
                              className="text-gray-500 flex-shrink-0"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body,
                )}
              <button
                ref={reminderButtonRef}
                type="button"
                onClick={() => {
                  setColorOpen(false);
                  setRecurrenceOpen(false);
                  setReminderOpen((o) => !o);
                  setCustomReminderOpen(false);
                }}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Bell size={18} className="text-gray-400 hover:text-gray-600" />
                <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-gray-100 px-1 py-0.5 text-[9px] font-medium leading-none text-gray-600">
                  {getReminderCount(form.watch("reminders"))}
                </span>
              </button>
              {reminderOpen &&
                reminderButtonRef.current &&
                ReactDOM.createPortal(
                  <div
                    ref={reminderRef}
                    data-event-modal-popover="reminder"
                    onClick={(e) => e.stopPropagation()}
                    className="fixed bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl shadow-[0_10px_50px_rgba(0,0,0,0.15)] py-2.5 px-1 z-[9999] modal-fade-in flex flex-col items-stretch min-w-[240px]"
                    style={{
                      bottom:
                        window.innerHeight -
                        reminderButtonRef.current.getBoundingClientRect().top +
                        8,
                      left: reminderButtonRef.current.getBoundingClientRect()
                        .left,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 px-3 pb-2">
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400">
                        Reminders
                      </span>
                      <button
                        type="button"
                        onClick={() => setReminderOpen(false)}
                        className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="mx-2 mb-1 border-t border-gray-100" />
                    <div className="pr-1">
                      {REMINDER_OPTIONS.map((opt) => {
                        const selectedMinutes =
                          form
                            .watch("reminders")
                            ?.overrides?.map((override) => override.minutes) ??
                          [];
                        const isSelected =
                          opt.minutes === null
                            ? selectedMinutes.length === 0
                            : selectedMinutes.includes(opt.minutes);

                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => toggleReminder(opt.minutes)}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full flex items-center gap-2.5 px-3 py-[10px] text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                          >
                            <span
                              className={`flex-1 ${isSelected ? "font-semibold" : "font-medium"}`}
                            >
                              {opt.label}
                            </span>
                            {isSelected && (
                              <Check size={16} className="text-gray-400" />
                            )}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setCustomReminderOpen(true)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="w-full px-3 py-[9px] text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        Custom
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
              {customReminderOpen &&
                reminderRef.current &&
                ReactDOM.createPortal(
                  <div
                    ref={customReminderRef}
                    onClick={(e) => e.stopPropagation()}
                    className="fixed z-[10000] rounded-xl border border-black bg-white/95 p-1.5 shadow-[0_10px_50px_rgba(0,0,0,0.15)] backdrop-blur-md modal-fade-in"
                    style={{
                      width: reminderRef.current.getBoundingClientRect().width,
                      bottom:
                        window.innerHeight -
                        reminderRef.current.getBoundingClientRect().bottom,
                      left: reminderRef.current.getBoundingClientRect().left,
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="relative">
                        <select
                          value={customReminderMethod}
                          onChange={(e) =>
                            setCustomReminderMethod(
                              e.target.value as ReminderMethod,
                            )
                          }
                          className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 font-semibold cursor-pointer hover:bg-gray-100 rounded-lg px-2.5 py-1.5 appearance-none focus:ring-0 pr-8"
                        >
                          <option
                            value="popup"
                            className="font-medium text-gray-700"
                          >
                            Push notification
                          </option>
                          <option
                            value="email"
                            className="font-medium text-gray-700"
                          >
                            Email
                          </option>
                        </select>
                        <div className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center">
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M1 2.5L4 5.5L7 2.5"
                              stroke="#6B7280"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomReminderOpen(false)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                        >
                          <X size={12} />
                        </button>
                      </div>

                      {customReminderUnit !== "on_date" ? (
                        <div className="flex items-center gap-1 my-2">
                          <div className="relative w-[48px] px-1 py-2 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300 shrink-0">
                            <input
                              type="number"
                              min="0"
                              value={customReminderValue}
                              onChange={(e) =>
                                setCustomReminderValue(e.target.value)
                              }
                              className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 text-center p-0 m-0 focus:ring-0 font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>

                          <div className="relative flex-[1.2] px-1 py-2 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                            <select
                              value={customReminderUnit}
                              onChange={(e) => {
                                if (isReminderUnit(e.target.value)) {
                                  setCustomReminderUnit(e.target.value);
                                }
                              }}
                              className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 cursor-pointer p-0 m-0 appearance-none text-center focus:ring-0 font-semibold pr-3 relative z-10"
                            >
                              <option
                                value="minutes"
                                className="font-medium text-gray-700"
                              >
                                minutes
                              </option>
                              <option
                                value="hours"
                                className="font-medium text-gray-700"
                              >
                                hours
                              </option>
                              <option
                                value="days"
                                className="font-medium text-gray-700"
                              >
                                days
                              </option>
                              <option
                                value="weeks"
                                className="font-medium text-gray-700"
                              >
                                weeks
                              </option>
                              <option
                                value="on_date"
                                className="font-medium text-gray-700"
                              >
                                On date
                              </option>
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center z-0">
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 8 8"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M1 2.5L4 5.5L7 2.5"
                                  stroke="#6B7280"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </div>
                          </div>

                          <div className="relative flex-1 px-1 py-2 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                            <select
                              value={customReminderRelation}
                              onChange={(e) => {
                                if (isReminderRelation(e.target.value)) {
                                  setCustomReminderRelation(e.target.value);
                                }
                              }}
                              className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 cursor-pointer p-0 m-0 appearance-none text-center focus:ring-0 font-semibold pr-3 relative z-10"
                            >
                              <option
                                value="before"
                                className="font-medium text-gray-700"
                              >
                                before
                              </option>
                              <option
                                value="after"
                                className="font-medium text-gray-700"
                              >
                                after
                              </option>
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center z-0">
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 8 8"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M1 2.5L4 5.5L7 2.5"
                                  stroke="#6B7280"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 my-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-gray-500 w-6 px-1">
                              On
                            </span>
                            <div className="relative flex-1 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                              <input
                                type="date"
                                value={customReminderDate}
                                onChange={(e) =>
                                  setCustomReminderDate(e.target.value)
                                }
                                className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 text-right p-0 m-0 [&::-webkit-calendar-picker-indicator]:hidden focus:ring-0 font-semibold pr-4"
                              />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center">
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 8 8"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M1 2.5L4 5.5L7 2.5"
                                    stroke="#6B7280"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-gray-500 w-6 px-1">
                              At
                            </span>
                            <div className="relative flex-1 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                              <input
                                type="time"
                                value={customReminderTime}
                                onChange={(e) =>
                                  setCustomReminderTime(e.target.value)
                                }
                                className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 text-right p-0 m-0 [&::-webkit-calendar-picker-indicator]:hidden focus:ring-0 font-semibold pr-4"
                              />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col justify-center">
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 8 8"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M1 2.5L4 5.5L7 2.5"
                                    stroke="#6B7280"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCustomReminderUnit("minutes")}
                            className="text-[11px] text-gray-400 hover:text-gray-600 text-left px-2.5 py-1 transition-colors"
                          >
                            Switch to relative time
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-0.5 px-1 pb-1">
                        {customReminderError && (
                          <div className="flex-1 text-[11px] font-medium text-red-600">
                            {customReminderError}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-1 pb-1">
                        <button
                          type="button"
                          onClick={() => setCustomReminderOpen(false)}
                          className="flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveCustomReminder}
                          className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
            <div className="flex items-center gap-2">
              {!isNew && (
                <div className="relative">
                  <button
                    ref={rsvpButtonRef}
                    type="button"
                    onClick={() => setRsvpOpen((o) => !o)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm shrink-0 transition-colors ${(() => {
                      const status =
                        existingEvent?.attendees?.find((a) => a.self)
                          ?.responseStatus ?? "needsAction";
                      return status === "accepted"
                        ? "text-green-700"
                        : status === "declined"
                          ? "text-red-600"
                          : "text-gray-600";
                    })()}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${(() => {
                        const status =
                          existingEvent?.attendees?.find((a) => a.self)
                            ?.responseStatus ?? "needsAction";
                        return status === "accepted"
                          ? "bg-green-500"
                          : status === "declined"
                            ? "bg-red-500"
                            : "bg-gray-400";
                      })()}`}
                    />
                    <span className="whitespace-nowrap">
                      {(() => {
                        const status =
                          existingEvent?.attendees?.find((a) => a.self)
                            ?.responseStatus ?? "needsAction";
                        return status === "accepted"
                          ? "Going"
                          : status === "declined"
                            ? "Not going"
                            : "Maybe";
                      })()}
                    </span>
                    <ChevronDown size={14} />
                  </button>
                  {rsvpOpen &&
                    rsvpButtonRef.current &&
                    ReactDOM.createPortal(
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 py-1 modal-fade-in"
                        style={{
                          width:
                            rsvpButtonRef.current.getBoundingClientRect().width,
                          bottom:
                            window.innerHeight -
                            rsvpButtonRef.current.getBoundingClientRect().top +
                            8,
                          left: rsvpButtonRef.current.getBoundingClientRect()
                            .left,
                        }}
                      >
                        {RSVP_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                              existingEvent?.attendees?.find((a) => a.self)
                                ?.responseStatus === option.value
                                ? "font-semibold"
                                : ""
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                </div>
              )}
              {!isNew && !showDeleteConfirm && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
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
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
