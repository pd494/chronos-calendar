import { EVENT_COLORS, EventColor } from "../../../types";

export function formatTimeFromISO(isoString: string | undefined): string {
  if (!isoString) return "09:00";
  const date = new Date(isoString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

export function formatDateFromISO(
  isoString: string | undefined,
  allDayDate: string | undefined,
): string {
  if (allDayDate) return allDayDate;
  return toDateString(isoString ? new Date(isoString) : new Date());
}

export function combineDateAndTime(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  return date.toISOString();
}

export const RECURRENCE_OPTIONS = [
  { label: "Never", value: "" },
  { label: "Daily", value: "RRULE:FREQ=DAILY" },
  { label: "Weekly", value: "RRULE:FREQ=WEEKLY" },
  { label: "Monthly", value: "RRULE:FREQ=MONTHLY" },
  { label: "Yearly", value: "RRULE:FREQ=YEARLY" },
] as const;

export const REMINDER_OPTIONS = [
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

export const COLOR_OPTIONS = Object.entries(EVENT_COLORS) as [
  EventColor,
  (typeof EVENT_COLORS)[EventColor],
][];

export const RSVP_OPTIONS = [
  { label: "Maybe", value: "tentative" as const },
  { label: "Decline", value: "declined" as const },
  { label: "Accept", value: "accepted" as const },
];

export const DESCRIPTION_LINE_HEIGHT = 24;
export const MAX_DESCRIPTION_PREVIEW_HEIGHT = DESCRIPTION_LINE_HEIGHT * 2;

const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

export function linkifyText(text: string): (string | { url: string })[] {
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

export function getRecurrenceLabel(recurrence: string[] | undefined): string {
  if (!recurrence?.length) return "Never";
  const rrule = recurrence.find((r) => r.startsWith("RRULE:"));
  if (!rrule) return "Never";
  const exactOpt = RECURRENCE_OPTIONS.find((o) => o.value === rrule);
  if (exactOpt) return exactOpt.label;
  return "Custom";
}

export type ReminderMethod = "email" | "popup";
export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type ReminderUnit = "minutes" | "hours" | "days" | "weeks" | "on_date";
export type ReminderRelation = "before" | "after";

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

export function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return RECURRENCE_FREQUENCY_SET.has(value);
}

export function isReminderUnit(value: string): value is ReminderUnit {
  return REMINDER_UNIT_SET.has(value);
}

export function isReminderRelation(value: string): value is ReminderRelation {
  return REMINDER_RELATION_SET.has(value);
}

export function getReminderCount(
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

export const PARTICIPANT_COLORS = [
  "#1761C7",
  "#FF3B30",
  "#34C759",
  "#FF9500",
  "#AF52DE",
  "#FFD60A",
  "#00C7BE",
  "#FF2D55",
];

export function getParticipantColor(email: string): string {
  const index =
    email.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[index];
}

export function getInitials(email: string): string {
  const name = email.split("@")[0];
  return name.charAt(0).toUpperCase();
}
