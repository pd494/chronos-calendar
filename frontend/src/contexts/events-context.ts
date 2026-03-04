import { createContext } from "react";
import type { CalendarEvent } from "../types";

export interface EventsContextValue {
  events: CalendarEvent[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  sync: () => Promise<void>;
  progress: {
    eventsLoaded: number;
    calendarsComplete: number;
    totalCalendars: number;
  };
}

export const EventsContext = createContext<EventsContextValue | undefined>(
  undefined,
);
