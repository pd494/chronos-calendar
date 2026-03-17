import { useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Bell, Check, X } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import { EventFormData } from "../../../schemas/event.schema";
import {
  REMINDER_OPTIONS,
  ReminderMethod,
  ReminderUnit,
  ReminderRelation,
  getReminderCount,
  isReminderUnit,
  isReminderRelation,
  formatTimeFromISO,
  toDateString,
} from "./constants";

interface ReminderPickerProps {
  form: UseFormReturn<EventFormData>;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  customOpen: boolean;
  onCustomOpenChange: (open: boolean) => void;
  watchedReminders: EventFormData["reminders"];
  reminderButtonRef: React.RefObject<HTMLButtonElement | null>;
  reminderRef: React.RefObject<HTMLDivElement | null>;
  customReminderRef: React.RefObject<HTMLDivElement | null>;
}

export function ReminderPicker({
  form,
  isOpen,
  onToggle,
  onClose,
  customOpen,
  onCustomOpenChange,
  watchedReminders,
  reminderButtonRef,
  reminderRef,
  customReminderRef,
}: ReminderPickerProps) {
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

  const openCustomReminder = () => {
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
    onCustomOpenChange(true);
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
    onCustomOpenChange(false);
  };

  return (
    <>
      <button
        ref={reminderButtonRef}
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 cursor-pointer"
      >
        <Bell size={18} className="text-gray-400 hover:text-gray-600" />
        <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-gray-100 px-1 py-0.5 text-[9px] font-medium leading-none text-gray-600">
          {getReminderCount(watchedReminders)}
        </span>
      </button>
      {isOpen &&
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
                onClick={onClose}
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
                onClick={openCustomReminder}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full px-3 py-[9px] text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Custom
              </button>
            </div>
          </div>,
          document.body,
        )}
      {customOpen &&
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
                  onClick={() => onCustomOpenChange(false)}
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
                  onClick={() => onCustomOpenChange(false)}
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
    </>
  );
}
