import { useMemo, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, addMonths } from "date-fns";
import { useCalendarStore, useCalendarsStore } from "../stores";
import {
  useEventsLive,
  useCalendarSync,
  useGoogleCalendars,
  useGoogleAccounts,
} from "../hooks";
import { googleApi } from "../api";
import { googleKeys, getExpandedEvents } from "../lib";
import { EventsContext } from "./events-context";

interface EventsProviderProps {
  children: ReactNode;
}

export function EventsProvider({ children }: EventsProviderProps) {
  const queryClient = useQueryClient();
  const { currentDate } = useCalendarStore();
  const { getVisibleCalendarIds, initializeCalendars, removeStaleCalendars } =
    useCalendarsStore();
  const { data: accounts } = useGoogleAccounts();
  const { data: calendars } = useGoogleCalendars();
  const calendarsRefreshed = useRef(false);

  useEffect(() => {
    if (calendars?.length) {
      const calendarIds = calendars.map((c) => c.id);
      initializeCalendars(calendarIds);
      removeStaleCalendars(calendarIds);
    }
  }, [calendars, initializeCalendars, removeStaleCalendars]);

  useEffect(() => {
    if (calendarsRefreshed.current) return;
    if (!accounts?.length || calendars?.length) return;

    calendarsRefreshed.current = true;
    const refreshAll = async () => {
      for (const account of accounts) {
        await googleApi.refreshCalendars(account.id);
      }
      queryClient.invalidateQueries({ queryKey: googleKeys.calendars() });
    };
    refreshAll();
  }, [accounts, calendars, queryClient]);

  const visibleCalendarIds = useMemo(() => {
    if (!calendars?.length) return [];
    const calendarIdSet = new Set(calendars.map((c) => c.id));
    const visible = getVisibleCalendarIds().filter((id) =>
      calendarIdSet.has(id),
    );
    if (visible.length === 0) {
      return calendars.map((c) => c.id);
    }
    return visible;
  }, [getVisibleCalendarIds, calendars]);

  const {
    events: regularEvents,
    masters,
    exceptions,
    isLoading: isDexieLoading,
  } = useEventsLive(visibleCalendarIds);

  const {
    isLoading: isSyncLoading,
    isSyncing,
    error,
    sync,
    progress,
  } = useCalendarSync({
    calendarIds: visibleCalendarIds,
    enabled: visibleCalendarIds.length > 0,
  });

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const rangeStart = useMemo(
    () => startOfMonth(addMonths(new Date(currentYear, currentMonth, 1), -2)),
    [currentYear, currentMonth],
  );
  const rangeEnd = useMemo(
    () => endOfMonth(addMonths(new Date(currentYear, currentMonth, 1), 2)),
    [currentYear, currentMonth],
  );

  const events = useMemo(() => {
    return getExpandedEvents(
      regularEvents,
      masters,
      exceptions,
      rangeStart,
      rangeEnd,
    );
  }, [regularEvents, masters, exceptions, rangeStart, rangeEnd]);

  const isLoading = isDexieLoading || (isSyncLoading && events.length === 0);

  const value = useMemo(
    () => ({ events, isLoading, isSyncing, error, sync, progress }),
    [events, isLoading, isSyncing, error, sync, progress],
  );

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}
