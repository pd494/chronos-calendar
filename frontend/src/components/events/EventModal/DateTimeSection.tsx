import { UseFormReturn, Controller } from "react-hook-form";
import { Clock, Calendar } from "lucide-react";
import { EventFormData } from "../../../schemas/event.schema";
import {
  formatTimeFromISO,
  formatDateFromISO,
  combineDateAndTime,
} from "./constants";
import { RecurrencePicker } from "./RecurrencePicker";

interface DateTimeSectionProps {
  form: UseFormReturn<EventFormData>;
  isEditing: boolean;
  isNew: boolean | undefined;
  isAllDayLocal: boolean;
  handleAllDayToggle: (checked: boolean) => void;
  startValue: EventFormData["start"];
  endValue: EventFormData["end"];
  recurrenceOpen: boolean;
  onRecurrenceToggle: () => void;
  customRecurrenceOpen: boolean;
  onCustomRecurrenceOpenChange: (open: boolean) => void;
  watchedRecurrence: string[] | undefined;
  recurrenceButtonRef: React.RefObject<HTMLButtonElement | null>;
  recurrenceRef: React.RefObject<HTMLDivElement | null>;
  customRecurrenceRef: React.RefObject<HTMLDivElement | null>;
}

export function DateTimeSection({
  form,
  isEditing,
  isNew,
  isAllDayLocal,
  handleAllDayToggle,
  startValue,
  endValue,
  recurrenceOpen,
  onRecurrenceToggle,
  customRecurrenceOpen,
  onCustomRecurrenceOpenChange,
  watchedRecurrence,
  recurrenceButtonRef,
  recurrenceRef,
  customRecurrenceRef,
}: DateTimeSectionProps) {
  return (
    <div className="px-4 py-2.5 border-b border-gray-100" style={!isEditing && !isNew ? { pointerEvents: "none" } : undefined}>
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
                      const newStartISO = combineDateAndTime(
                        currentDate,
                        e.target.value,
                      );
                      field.onChange({
                        ...field.value,
                        dateTime: newStartISO,
                        date: undefined,
                      });
                      const endDT = form.getValues("end")?.dateTime;
                      if (endDT && new Date(endDT) <= new Date(newStartISO)) {
                        const adjusted = new Date(newStartISO);
                        adjusted.setHours(adjusted.getHours() + 1);
                        form.setValue("end", { dateTime: adjusted.toISOString() }, { shouldDirty: true });
                      }
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
                  onChange={(e) => handleAllDayToggle(e.target.checked)}
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
              <span className="text-sm text-gray-900" style={{ marginLeft: 2 }}>All day</span>
              <label className="ml-auto flex w-[180px] items-center justify-end cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isAllDayLocal}
                  onChange={(e) => handleAllDayToggle(e.target.checked)}
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
                        const endDate = form.getValues("end")?.date;
                        if (endDate && e.target.value > endDate) {
                          form.setValue("end", { date: e.target.value }, { shouldDirty: true });
                        }
                      } else {
                        const currentTime = formatTimeFromISO(
                          field.value?.dateTime,
                        );
                        const newStartISO = combineDateAndTime(e.target.value, currentTime);
                        field.onChange({ dateTime: newStartISO });
                        const endDT = form.getValues("end")?.dateTime;
                        if (endDT && new Date(endDT) <= new Date(newStartISO)) {
                          const adjusted = new Date(newStartISO);
                          adjusted.setHours(adjusted.getHours() + 1);
                          form.setValue("end", { dateTime: adjusted.toISOString() }, { shouldDirty: true });
                        }
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
                        field.onChange({ dateTime: combineDateAndTime(e.target.value, currentTime) });
                      }
                    }}
                    className="px-0 py-0.5 border-none focus:outline-none text-sm bg-transparent text-gray-900 [&::-webkit-calendar-picker-indicator]:hidden"
                    style={{ width: 88 }}
                  />
                )}
              />
            </div>
            <RecurrencePicker
              form={form}
              isOpen={recurrenceOpen}
              onToggle={onRecurrenceToggle}
              customOpen={customRecurrenceOpen}
              onCustomOpenChange={onCustomRecurrenceOpenChange}
              watchedRecurrence={watchedRecurrence}
              recurrenceButtonRef={recurrenceButtonRef}
              recurrenceRef={recurrenceRef}
              customRecurrenceRef={customRecurrenceRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
