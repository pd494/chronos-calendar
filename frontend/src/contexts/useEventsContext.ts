import { useContext } from "react";
import { EventsContext } from "./events-context";

export function useEventsContext() {
  const context = useContext(EventsContext);
  if (context === undefined) {
    throw new Error("useEventsContext must be used within EventsProvider");
  }
  return context;
}
