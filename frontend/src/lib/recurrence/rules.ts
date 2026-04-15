import type { EventDateTime } from "../../types";

const ICAL_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function getWeekdayIndex(value: EventDateTime | undefined): number | null {
  if (!value) return null;

  if (value.dateTime) {
    const day = new Date(value.dateTime).getDay();
    return day === 0 ? 6 : day - 1;
  }

  if (value.date) {
    const day = new Date(`${value.date}T00:00:00Z`).getUTCDay();
    return day === 0 ? 6 : day - 1;
  }

  return null;
}

function rewriteByDay(rrule: string, oldDay: number, newDay: number): string {
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
  if (!recurrence?.length || !nextStart) return recurrence;

  const oldDay = getWeekdayIndex(previousStart);
  const newDay = getWeekdayIndex(nextStart);

  if (oldDay === null || newDay === null || oldDay === newDay) {
    return recurrence;
  }

  return recurrence.map((rule) =>
    rule.startsWith("RRULE:") && rule.includes("BYDAY=")
      ? rewriteByDay(rule, oldDay, newDay)
      : rule,
  );
}
