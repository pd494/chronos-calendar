import { useState } from "react";
import ReactDOM from "react-dom";
import { Repeat, Check } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { EventFormData } from "../../../schemas/event.schema";
import {
  RECURRENCE_OPTIONS,
  RecurrenceFrequency,
  getRecurrenceLabel,
  isRecurrenceFrequency,
} from "./constants";

const FREQ_UNIT_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

const WEEKDAYS = [
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
  { code: "SU", label: "S" },
] as const;

type WeekdayCode = (typeof WEEKDAYS)[number]["code"];
type RecurrenceEndMode = "never" | "on" | "after";

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

const RECURRENCE_END_MODES = new Set<string>(["never", "on", "after"]);
const WEEKDAY_CODES = new Set<string>(WEEKDAYS.map(({ code }) => code));
const JS_DAY_TO_ICAL: Record<number, WeekdayCode> = {
  0: "SU",
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
};

interface RecurrencePickerProps {
  form: UseFormReturn<EventFormData>;
  isOpen: boolean;
  onToggle: () => void;
  customOpen: boolean;
  onCustomOpenChange: (open: boolean) => void;
  watchedRecurrence: string[] | undefined;
  recurrenceButtonRef: React.RefObject<HTMLButtonElement>;
  recurrenceRef: React.RefObject<HTMLDivElement>;
  customRecurrenceRef: React.RefObject<HTMLDivElement>;
  startValue: EventFormData["start"];
}

interface CustomRecurrenceState {
  frequency: RecurrenceFrequency;
  interval: string;
  byDay: WeekdayCode[];
  endMode: RecurrenceEndMode;
  untilDate: string;
  count: string;
}

function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function isRecurrenceEndMode(value: string): value is RecurrenceEndMode {
  return RECURRENCE_END_MODES.has(value);
}

function isWeekdayCode(value: string): value is WeekdayCode {
  return WEEKDAY_CODES.has(value);
}

function getAnchorComponents(startValue: EventFormData["start"]): {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayCode;
} {
  if (startValue?.dateTime) {
    const date = new Date(startValue.dateTime);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: JS_DAY_TO_ICAL[date.getDay()],
    };
  }

  if (startValue?.date) {
    const [year, month, day] = startValue.date.split("-").map(Number);
    const weekdayDate = new Date(`${startValue.date}T00:00:00Z`);
    return {
      year,
      month,
      day,
      weekday: JS_DAY_TO_ICAL[weekdayDate.getUTCDay()],
    };
  }

  throw new Error("Custom recurrence requires a start date");
}

function getWeekdayCode(startValue: EventFormData["start"]): WeekdayCode {
  return getAnchorComponents(startValue).weekday;
}

function formatUntilValue(untilDate: string, startValue: EventFormData["start"]): string {
  const isAllDay = !!startValue?.date && !startValue?.dateTime;
  if (isAllDay) {
    return untilDate.replace(/-/g, "");
  }
  return `${untilDate.replace(/-/g, "")}T235959Z`;
}

function parseUntilDate(rrule: string): string {
  const until = assertDefined(rrule.match(/UNTIL=([^;]+)/)?.[1], "UNTIL rule is missing a date");
  if (until.length === 8) {
    return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  }
  return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
}

function buildRecurrenceRule(args: {
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: WeekdayCode[];
  endMode: RecurrenceEndMode;
  untilDate: string;
  count: number;
  startValue: EventFormData["start"];
}): string {
  const { frequency, interval, byDay, endMode, untilDate, count, startValue } = args;
  const anchor = getAnchorComponents(startValue);
  const parts = [`FREQ=${frequency}`];

  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }

  if (frequency === "WEEKLY") {
    const days = byDay.length ? byDay : [getWeekdayCode(startValue)];
    parts.push(`BYDAY=${days.join(",")}`);
  }

  if (frequency === "MONTHLY") {
    parts.push(`BYMONTHDAY=${anchor.day}`);
  }

  if (frequency === "YEARLY") {
    parts.push(`BYMONTH=${anchor.month}`);
    parts.push(`BYMONTHDAY=${anchor.day}`);
  }

  if (endMode === "after") {
    parts.push(`COUNT=${Math.min(1000, Math.max(1, count))}`);
  }

  if (endMode === "on" && untilDate) {
    parts.push(`UNTIL=${formatUntilValue(untilDate, startValue)}`);
  }

  return `RRULE:${parts.join(";")}`;
}

function parseCustomRecurrence(rule: string, startValue: EventFormData["start"]): CustomRecurrenceState {
  const anchor = getAnchorComponents(startValue);
  const state: CustomRecurrenceState = {
    frequency: "WEEKLY",
    interval: "1",
    byDay: [getWeekdayCode(startValue)],
    endMode: "never",
    untilDate: `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`,
    count: "10",
  };

  if (!rule.startsWith("RRULE:")) return state;

  const freqMatch = rule.match(/FREQ=(\w+)/);
  if (freqMatch && isRecurrenceFrequency(freqMatch[1])) {
    state.frequency = freqMatch[1];
  }

  const intervalMatch = rule.match(/INTERVAL=(\d+)/);
  if (intervalMatch) state.interval = intervalMatch[1];

  const byDayMatch = rule.match(/BYDAY=([^;]+)/);
  if (byDayMatch) {
    const days = byDayMatch[1].split(",").filter(isWeekdayCode);
    if (days.length) state.byDay = days;
  }

  const countMatch = rule.match(/COUNT=(\d+)/);
  if (countMatch) {
    state.endMode = "after";
    state.count = countMatch[1];
  }

  if (/UNTIL=/.test(rule)) {
    state.endMode = "on";
    state.untilDate = parseUntilDate(rule);
  }

  return state;
}

export function RecurrencePicker({
  form,
  isOpen,
  onToggle,
  customOpen,
  onCustomOpenChange,
  watchedRecurrence,
  recurrenceButtonRef,
  recurrenceRef,
  customRecurrenceRef,
  startValue,
}: RecurrencePickerProps) {
  const [customRecurrenceFreq, setCustomRecurrenceFreq] =
    useState<RecurrenceFrequency>("WEEKLY");
  const [customRecurrenceInterval, setCustomRecurrenceInterval] = useState("1");
  const [customRecurrenceByDay, setCustomRecurrenceByDay] = useState<WeekdayCode[]>([]);
  const [customRecurrenceEndMode, setCustomRecurrenceEndMode] = useState<RecurrenceEndMode>("never");
  const [customRecurrenceUntil, setCustomRecurrenceUntil] = useState("");
  const [customRecurrenceCount, setCustomRecurrenceCount] = useState("10");
  const anchor = getAnchorComponents(startValue);

  const currentLabel = getRecurrenceLabel(watchedRecurrence);

  const saveCustomRecurrence = () => {
    const interval = Math.max(1, Number(customRecurrenceInterval) || 1);
    const count = Math.min(1000, Math.max(1, Number(customRecurrenceCount) || 1));
    const byDay: WeekdayCode[] = customRecurrenceFreq === "WEEKLY"
      ? (customRecurrenceByDay.length ? customRecurrenceByDay : [getWeekdayCode(startValue)])
      : [];
    const rrule = buildRecurrenceRule({
      frequency: customRecurrenceFreq,
      interval,
      byDay,
      endMode: customRecurrenceEndMode,
      untilDate: customRecurrenceUntil,
      count,
      startValue,
    });
    form.setValue("recurrence", [rrule], { shouldDirty: true });
    onCustomOpenChange(false);
  };

  return (
    <>
      <button
        ref={recurrenceButtonRef}
        type="button"
        onClick={onToggle}
        className="ml-auto flex w-[180px] flex-shrink-0 items-center justify-end cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="flex w-10 justify-end">
          <Repeat
            className="text-gray-400 flex-shrink-0"
            size={20}
          />
        </span>
        <span className="ml-3 whitespace-nowrap text-xs text-gray-600">
          {currentLabel}
        </span>
      </button>
      {isOpen &&
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
                  const nextRecurrence = opt.value
                    ? [buildRecurrenceRule({
                        frequency: opt.value,
                        interval: 1,
                        byDay: [],
                        endMode: "never",
                        untilDate: "",
                        count: 10,
                        startValue,
                      })]
                    : [];
                  form.setValue(
                    "recurrence",
                    nextRecurrence,
                    { shouldDirty: true },
                  );
                  onToggle();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <span
                  className={`flex-1 ${currentLabel === opt.label ? "font-semibold" : "font-medium"}`}
                >
                  {opt.label}
                </span>
                {currentLabel ===
                  opt.label && (
                  <Check size={16} className="text-gray-400" />
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const currentRule =
                  form.getValues("recurrence")?.[0] ?? "";
                const parsed = parseCustomRecurrence(currentRule, startValue);

                setCustomRecurrenceFreq(parsed.frequency);
                setCustomRecurrenceInterval(parsed.interval);
                setCustomRecurrenceByDay(parsed.byDay);
                setCustomRecurrenceEndMode(parsed.endMode);
                setCustomRecurrenceUntil(parsed.untilDate);
                setCustomRecurrenceCount(parsed.count);

                onCustomOpenChange(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
            >
              <span
                className={`flex-1 ${currentLabel === "Custom" ? "font-semibold" : "font-medium"}`}
              >
                Custom...
              </span>
              {currentLabel ===
                "Custom" && (
                <Check size={16} className="text-gray-400" />
              )}
            </button>
          </div>,
          document.body,
        )}
      {customOpen &&
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
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
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
                  {FREQ_UNIT_LABELS[customRecurrenceFreq]}
                  {Number(customRecurrenceInterval) > 1 ? "s" : ""}
                  {customRecurrenceFreq === "WEEKLY" ? " on:" : ""}
                </span>
              </div>

              {customRecurrenceFreq === "WEEKLY" && (
                <div className="flex border border-gray-200 rounded-[6px] overflow-hidden mb-3 mx-1">
                  {WEEKDAYS.map(({ code, label }) => {
                    const isSelected = customRecurrenceByDay.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          setCustomRecurrenceByDay((prev) =>
                            isSelected
                              ? prev.filter((d) => d !== code)
                              : [...prev, code],
                          )
                        }
                        className={`flex-1 h-8 flex items-center justify-center text-[13px] font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                          isSelected
                            ? "bg-gray-200 text-gray-900"
                            : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2 px-1 my-2">
                <span className="text-[13px] text-gray-700 font-medium whitespace-nowrap w-20">
                  Ends:
                </span>
                <div className="relative flex-1 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                  <select
                    value={customRecurrenceEndMode}
                    onChange={(e) => {
                      if (isRecurrenceEndMode(e.target.value)) {
                        setCustomRecurrenceEndMode(e.target.value);
                      }
                    }}
                    className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 cursor-pointer p-0 m-0 appearance-none focus:ring-0 font-semibold pr-4 relative z-10"
                  >
                    <option value="never">Never</option>
                    <option value="on">On date</option>
                    <option value="after">After count</option>
                  </select>
                </div>
              </div>

              {customRecurrenceEndMode === "on" && (
                <div className="flex items-center gap-2 px-1 my-2">
                  <span className="text-[13px] text-gray-700 font-medium whitespace-nowrap w-20">
                    Until:
                  </span>
                  <div className="relative flex-1 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300">
                    <input
                      type="date"
                      min={`${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`}
                      value={customRecurrenceUntil}
                      onChange={(e) => setCustomRecurrenceUntil(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 p-0 m-0 focus:ring-0 font-semibold"
                    />
                  </div>
                </div>
              )}

              {customRecurrenceEndMode === "after" && (
                <div className="flex items-center gap-2 px-1 my-2">
                  <span className="text-[13px] text-gray-700 font-medium whitespace-nowrap w-20">
                    Count:
                  </span>
                  <div className="relative w-[72px] px-1 py-1.5 hover:bg-gray-100 rounded-lg transition-colors focus-within:bg-gray-100 border border-transparent hover:border-gray-200 focus-within:border-gray-300 shrink-0">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={customRecurrenceCount}
                      onChange={(e) => setCustomRecurrenceCount(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-[13px] text-gray-700 text-center p-0 m-0 focus:ring-0 font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <span className="text-[13px] text-gray-700 font-medium">
                    occurrences
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 mt-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => onCustomOpenChange(false)}
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
    </>
  );
}
