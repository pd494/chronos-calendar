import { useRef, useMemo, useEffect, useState, startTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCalendarStore } from "../../stores";
import { generateWeeks } from "../../lib/date";
import { WeekRow } from "./WeekRow";
import { useEventsContext } from "../../contexts/EventsContext";
import { getEventStart } from "../../types";

const BUFFER_WEEKS = 260;
const WEEKS_PER_PAGE = 6;
const MONTH_OVERSCAN_ROWS = 28;
const SCROLL_RESET_DELAY_MS = 200;

export function MonthView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { currentDate, setCurrentDate } = useCalendarStore();
  const currentMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const { events: allEvents } = useEventsContext();
  const [pageHeight, setPageHeight] = useState(720);
  const [hasScrolledToToday, setHasScrolledToToday] = useState(false);
  const pendingMonthDayRef = useRef<Date | null>(null);
  const latestMonthKeyRef = useRef<string>("");
  const weeks = useMemo(() => generateWeeks(BUFFER_WEEKS), []);
  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, typeof allEvents>();
    for (const event of allEvents) {
      const start = getEventStart(event);
      const month = String(start.getMonth() + 1).padStart(2, "0");
      const date = String(start.getDate()).padStart(2, "0");
      const key = `${start.getFullYear()}-${month}-${date}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(event);
      } else {
        grouped.set(key, [event]);
      }
    }
    return grouped;
  }, [allEvents]);
  const todayIndex = BUFFER_WEEKS;
  const rowHeight = pageHeight / WEEKS_PER_PAGE + 10;

  const virtualizer = useVirtualizer({
    count: weeks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: MONTH_OVERSCAN_ROWS,
    useFlushSync: false,
    isScrollingResetDelay: SCROLL_RESET_DELAY_MS,
    useScrollendEvent: true,
    useAnimationFrameWithResizeObserver: true,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        setPageHeight(containerRef.current.clientHeight);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!hasScrolledToToday && containerRef.current) {
      virtualizer.scrollToIndex(todayIndex, { align: "start" });
      setHasScrolledToToday(true);
    }
  }, [hasScrolledToToday, todayIndex, virtualizer]);

  useEffect(() => {
    latestMonthKeyRef.current = currentMonthKey;
  }, [currentMonthKey]);

  const visibleItems = virtualizer.getVirtualItems();
  const firstVisibleIndex = visibleItems[0]?.index;

  useEffect(() => {
    if (!hasScrolledToToday) return;
    const midItem = visibleItems[Math.floor(visibleItems.length / 2)];
    if (!midItem) return;
    const middleDay = weeks[midItem.index].days[3];
    const nextMonthKey = `${middleDay.getFullYear()}-${middleDay.getMonth()}`;
    if (nextMonthKey === currentMonthKey) return;
    if (latestMonthKeyRef.current === nextMonthKey) return;

    if (virtualizer.isScrolling) {
      pendingMonthDayRef.current = middleDay;
      return;
    }
    pendingMonthDayRef.current = null;
    latestMonthKeyRef.current = nextMonthKey;
    startTransition(() => {
      setCurrentDate(middleDay);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    firstVisibleIndex,
    hasScrolledToToday,
    weeks,
    currentMonthKey,
    virtualizer.isScrolling,
    setCurrentDate,
  ]);

  useEffect(() => {
    if (virtualizer.isScrolling) return;
    const pendingDay = pendingMonthDayRef.current;
    if (!pendingDay) return;
    const pendingMonthKey = `${pendingDay.getFullYear()}-${pendingDay.getMonth()}`;
    if (pendingMonthKey === currentMonthKey) return;
    if (latestMonthKeyRef.current === pendingMonthKey) return;
    pendingMonthDayRef.current = null;
    latestMonthKeyRef.current = pendingMonthKey;
    startTransition(() => {
      setCurrentDate(pendingDay);
    });
  }, [virtualizer.isScrolling, currentMonthKey, setCurrentDate]);

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 overflow-hidden bg-white">
      <div className="flex mb-0 flex-shrink-0 px-2">
        <div className="grid flex-1 grid-cols-7">
          {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
            <div
              key={d}
              className="text-center text-sm text-gray-500 font-medium py-1"
            >
              {d}
            </div>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative bg-white scrollbar-hide overflow-y-scroll overflow-x-hidden px-2"
      >
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {visibleItems.map((virtualRow) => {
            const week = weeks[virtualRow.index];
            return (
              <WeekRow
                key={week.key}
                week={week}
                currentDate={currentDate}
                eventsByDay={eventsByDay}
                style={{
                  position: "absolute",
                  top: virtualRow.start,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
