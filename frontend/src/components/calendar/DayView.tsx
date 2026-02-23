import { useMemo } from "react";
import { Repeat } from "lucide-react";
import { useCalendarStore } from "../../stores";
import { useEventsContext } from "../../contexts/EventsContext";
import { useTimeIndicator } from "../../hooks/useTimeIndicator";
import {
  format,
  isToday,
  isSameDay,
  getEventDisplayStyles,
  getEventColorPalette,
  HOUR_HEIGHT,
  DAY_START_HOUR,
  DAY_END_HOUR,
} from "../../lib";
import {
  getEventStart,
  getEventEnd,
  isAllDayEvent,
  isRecurringEvent,
} from "../../types";

export function DayView() {
  const { currentDate, selectEvent } = useCalendarStore();
  const { events: allEvents } = useEventsContext();
  const today = isToday(currentDate);
  const { scrollContainerRef, getPosition } = useTimeIndicator();

  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, i) => DAY_START_HOUR + i,
  );

  const { timedEvents, allDayEvents } = useMemo(() => {
    const dayEvents = allEvents.filter((e) =>
      isSameDay(getEventStart(e), currentDate),
    );
    return {
      timedEvents: dayEvents.filter((e) => !isAllDayEvent(e)),
      allDayEvents: dayEvents.filter((e) => isAllDayEvent(e)),
    };
  }, [allEvents, currentDate]);

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 relative overflow-hidden bg-white">
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        <div className="w-16 flex-shrink-0 flex items-center justify-center border-r border-gray-200">
          <span className="text-[10px] font-medium text-gray-500">GMT-7</span>
        </div>
        <div className="flex-1 py-3 text-center">
          <div
            className={`text-xs font-medium uppercase tracking-wider ${today ? "text-purple-600" : "text-gray-500"}`}
          >
            {format(currentDate, "EEEE")}
          </div>
          <div
            className={`
              mt-1 w-10 h-10 mx-auto flex items-center justify-center text-xl font-semibold rounded-full transition-colors
              ${today ? "bg-purple-100 text-purple-700" : "text-gray-900 hover:bg-gray-100"}
            `}
          >
            {format(currentDate, "d")}
          </div>
        </div>
      </div>

      {allDayEvents.length > 0 && (
        <div className="flex border-b border-gray-200 bg-gray-50/30 flex-shrink-0">
          <div className="w-16 flex-shrink-0 border-r border-gray-200 flex items-center justify-center">
            <span className="text-[10px] font-medium text-gray-500">
              All-day
            </span>
          </div>
          <div className="flex flex-1 p-1 gap-1 flex-wrap">
            {allDayEvents.map((event) => {
              const colors = getEventColorPalette(event);
              return (
                <div
                  key={event.id}
                  onClick={() => selectEvent(event.id)}
                  className="px-2 py-1 text-xs font-medium rounded-md cursor-pointer hover:brightness-95 transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: colors.background,
                    color: colors.text,
                  }}
                >
                  <div
                    className="w-[3px] h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.border }}
                  />
                  {event.summary}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-auto custom-scrollbar relative">
        <div className="flex min-h-full">
          <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-white sticky left-0 z-10">
            {hours.map((hour) => (
              <div
                key={hour}
                className="pr-2 text-right"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                <span
                  className="text-[10px] font-medium text-gray-400 relative"
                  style={{ top: "-6px" }}
                >
                  {hour === 0
                    ? ""
                    : format(new Date().setHours(hour, 0), "h a")}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 relative" data-day-column="true">
            {hours.map((hour) => (
              <div
                key={hour}
                className="border-b border-gray-100"
                style={{ height: `${HOUR_HEIGHT}px` }}
              />
            ))}

            {timedEvents.map((event) => {
              const start = getEventStart(event);
              const end = getEventEnd(event);
              const startHours = start.getHours() + start.getMinutes() / 60;
              const duration = Math.max(
                0.5,
                (end.getTime() - start.getTime()) / (1000 * 60 * 60),
              );
              const colors = getEventColorPalette(event);
              const top = (startHours - DAY_START_HOUR) * HOUR_HEIGHT;
              const height = Math.max(20, duration * HOUR_HEIGHT - 4);
              const isRecurring = isRecurringEvent(event);
              const styles = getEventDisplayStyles(event, colors);

              return (
                <div
                  key={event.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectEvent(event.id);
                  }}
                  className={`absolute left-0.5 right-2 rounded-lg p-1 overflow-hidden cursor-pointer hover:brightness-95 transition-all group ${
                    styles.showDashedBorder
                      ? "border border-dashed border-slate-300"
                      : ""
                  }`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    backgroundColor: styles.backgroundColor,
                    opacity: styles.opacity,
                    zIndex: 10,
                  }}
                >
                  <div
                    className="absolute left-0.5 top-0.5 bottom-0.5 w-1 rounded-full"
                    style={{ backgroundColor: colors.border }}
                  />
                  <div className="ml-3">
                    <div className="flex items-center gap-1">
                      <div
                        className="text-[11px] font-medium leading-tight truncate flex-1"
                        style={{ color: styles.titleColor }}
                      >
                        <span style={{ textDecoration: styles.textDecoration }}>
                          {event.summary}
                        </span>
                      </div>
                      {isRecurring && (
                        <Repeat
                          size={12}
                          className="flex-shrink-0 text-gray-400"
                        />
                      )}
                    </div>
                    <div className="text-[10px] font-medium opacity-70 text-gray-600">
                      {format(start, "h:mm")} – {format(end, "h:mm a")}
                    </div>
                  </div>
                </div>
              );
            })}

            {today && (
              <div
                className="absolute right-0 z-20 pointer-events-none"
                style={{ top: `${getPosition()}px`, left: "-64px" }}
              >
                <div className="relative flex items-center">
                  <div className="w-2 h-2 rounded-full bg-red-500 ml-[63px]" />
                  <div className="h-0.5 bg-red-500 flex-1" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
