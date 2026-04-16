import type { EventDateTime } from "../../types";

const ICAL_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function getWeekdayIndex(value: EventDateTime): WeekdayIndex {
  if (value.dateTime) {
    const day = new Date(value.dateTime).getDay();
    return (day === 0 ? 6 : day - 1) as WeekdayIndex;
  }

  const day = new Date(`${value.date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 6 : day - 1) as WeekdayIndex;
}

function rewriteByDay(rrule: string, oldDay: WeekdayIndex, newDay: WeekdayIndex): string {
  const oldByDay = ICAL_DAYS[oldDay];
  const newByDay = ICAL_DAYS[newDay];
  const match = rrule.match(/BYDAY=([^;]+)/);
  if (!match) return rrule;

  const days = match[1]
    .split(",")
    .map((day) => (day === oldByDay ? newByDay : day));

  return rrule.replace(/BYDAY=[^;]+/, `BYDAY=${days.join(",")}`);
}

export function adjustRecurrenceForStartChange(
  recurrence: string[] | undefined,
  previousStart: EventDateTime | undefined,
  nextStart: EventDateTime | undefined,
): string[] | undefined {
  if (!recurrence?.length || !previousStart || !nextStart) return recurrence;

  const oldDay = getWeekdayIndex(previousStart);
  const newDay = getWeekdayIndex(nextStart);

  if (oldDay === newDay) {
    return recurrence;
  }

  return recurrence.map((rule) =>
    rule.startsWith("RRULE:") && rule.includes("BYDAY=")
      ? rewriteByDay(rule, oldDay, newDay)
      : rule,
  );
}
