import { useRef, useState } from "react";
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

interface RecurrencePickerProps {
  form: UseFormReturn<EventFormData>;
  isOpen: boolean;
  onToggle: () => void;
  customOpen: boolean;
  onCustomOpenChange: (open: boolean) => void;
  watchedRecurrence: string[] | undefined;
  recurrenceButtonRef: React.RefObject<HTMLButtonElement | null>;
  recurrenceRef: React.RefObject<HTMLDivElement | null>;
  customRecurrenceRef: React.RefObject<HTMLDivElement | null>;
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
}: RecurrencePickerProps) {
  const [customRecurrenceFreq, setCustomRecurrenceFreq] =
    useState<RecurrenceFrequency>("WEEKLY");
  const [customRecurrenceInterval, setCustomRecurrenceInterval] = useState("1");
  const [customRecurrenceByDay, setCustomRecurrenceByDay] = useState<string[]>([]);

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
          {getRecurrenceLabel(watchedRecurrence)}
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
                  form.setValue(
                    "recurrence",
                    opt.value ? [opt.value] : [],
                    { shouldDirty: true },
                  );
                  onToggle();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <span
                  className={`flex-1 ${getRecurrenceLabel(watchedRecurrence) === opt.label ? "font-semibold" : "font-medium"}`}
                >
                  {opt.label}
                </span>
                {getRecurrenceLabel(watchedRecurrence) ===
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

                onCustomOpenChange(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
            >
              <span
                className={`flex-1 ${getRecurrenceLabel(watchedRecurrence) === "Custom" ? "font-semibold" : "font-medium"}`}
              >
                Custom...
              </span>
              {getRecurrenceLabel(watchedRecurrence) ===
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
