import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { eventsApi } from "../api/events";
import type { CalendarEvent, EventCompletion } from "../types";
import { eventKeys } from "../lib";
import {
  calendarEventToDexie,
  completionToDexie,
  db,
  dexieToCalendarEvent,
} from "../lib/db";

export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      calendarId,
      event,
    }: {
      calendarId: string;
      event: Partial<CalendarEvent>;
    }) => eventsApi.create(calendarId, event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      calendarId,
      eventId,
      event,
    }: {
      calendarId: string;
      eventId: string;
      event: Partial<CalendarEvent>;
      currentEvent?: CalendarEvent;
    }) => eventsApi.update(calendarId, eventId, event),
    onMutate: async ({ calendarId, eventId, event, currentEvent }) => {
      await queryClient.cancelQueries({ queryKey: eventKeys.lists() });
      await queryClient.cancelQueries({
        queryKey: eventKeys.detail(calendarId, eventId),
      });

      const previousDetail = queryClient.getQueryData<CalendarEvent>(
        eventKeys.detail(calendarId, eventId),
      );
      const previousLists = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: eventKeys.lists(),
      });
      const previousDexieEvent = await db.events
        .where("[calendarId+googleEventId]")
        .equals([calendarId, eventId])
        .first();
      const baseEvent =
        currentEvent ??
        (previousDexieEvent
          ? dexieToCalendarEvent(previousDexieEvent)
          : previousDetail);
      const optimisticEvent: CalendarEvent = {
        ...baseEvent!,
        ...event,
      };

      queryClient.setQueryData(
        eventKeys.detail(calendarId, eventId),
        optimisticEvent,
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.id === eventId && item.calendarId === calendarId
              ? { ...item, ...event }
              : item,
          ),
      );
      await db.events.put({
        ...calendarEventToDexie(optimisticEvent),
        id: previousDexieEvent?.id,
      });

      return {
        calendarId,
        eventId,
        previousDetail,
        previousLists,
        previousDexieEvent,
      };
    },
    onError: (_, __, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          eventKeys.detail(context.calendarId, context.eventId),
          context.previousDetail,
        );
      }
      for (const [queryKey, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      if (context?.previousDexieEvent) {
        void db.events.put(context.previousDexieEvent);
      }
      toast.error("Failed to update event");
    },
    onSuccess: async (updatedEvent, { calendarId, eventId }) => {
      queryClient.setQueryData(
        eventKeys.detail(calendarId, eventId),
        updatedEvent,
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.id === eventId && item.calendarId === calendarId
              ? updatedEvent
              : item,
          ),
      );
      const existingDexieEvent = await db.events
        .where("[calendarId+googleEventId]")
        .equals([calendarId, eventId])
        .first();
      await db.events.put({
        ...calendarEventToDexie(updatedEvent),
        id: existingDexieEvent?.id,
      });
    },
    onSettled: (_, __, { calendarId, eventId }) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: eventKeys.detail(calendarId, eventId),
      });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      calendarId,
      eventId,
    }: {
      calendarId: string;
      eventId: string;
    }) => eventsApi.delete(calendarId, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

export function useToggleEventCompletion() {
  return useMutation({
    mutationFn: (params: EventCompletion & { completed: boolean }) =>
      eventsApi.toggleCompletion(params),
    onMutate: async (params) => {
      const dexieCompletion = completionToDexie(params);
      const existing = await db.completedEvents
        .where("[googleCalendarId+masterEventId+instanceStart]")
        .equals([
          dexieCompletion.googleCalendarId,
          dexieCompletion.masterEventId,
          dexieCompletion.instanceStart,
        ])
        .first();

      if (params.completed) {
        await db.completedEvents.put({
          ...dexieCompletion,
          id: existing?.id,
        });
      } else if (existing) {
        await db.completedEvents.delete(existing.id!);
      }

      return { existing, params };
    },
    onError: (_, __, context) => {
      if (!context) return;
      const { existing, params } = context;
      const dexieCompletion = completionToDexie(params);

      if (params.completed && !existing) {
        db.completedEvents
          .where("[googleCalendarId+masterEventId+instanceStart]")
          .equals([
            dexieCompletion.googleCalendarId,
            dexieCompletion.masterEventId,
            dexieCompletion.instanceStart,
          ])
          .delete();
      } else if (!params.completed && existing) {
        db.completedEvents.put(existing);
      }
      toast.error("Failed to update completion");
    },
  });
}
