import { QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { DexieEvent } from "../lib/db";

async function cancelAndSnapshot(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: eventKeys.lists() });
  return queryClient.getQueriesData<CalendarEvent[]>({ queryKey: eventKeys.lists() });
}

function restoreLists(queryClient: QueryClient, previousLists: [unknown, CalendarEvent[] | undefined][]) {
  for (const [queryKey, data] of previousLists) {
    queryClient.setQueryData(queryKey as string[], data);
  }
}

function rollbackDexieEvent(previousDexieEvent: DexieEvent) {
  db.events.put(previousDexieEvent).catch((e) => {
    console.error("Dexie rollback failed:", e);
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      calendarId,
      event,
    }: {
      calendarId: string;
      event: Partial<CalendarEvent>;
      calendarColor?: string;
    }) => eventsApi.create(calendarId, event),
    onMutate: async ({ calendarId, event, calendarColor }) => {
      const previousLists = await cancelAndSnapshot(queryClient);

      const tempId = `temp-${Date.now()}`;
      const now = new Date().toISOString();
      const optimisticEvent: CalendarEvent = {
        id: tempId,
        calendarId,
        completed: false,
        summary: event.summary || "",
        description: event.description,
        location: event.location,
        start: event.start || { dateTime: now },
        end: event.end || { dateTime: now },
        recurrence: event.recurrence,
        attendees: event.attendees,
        colorId: event.colorId || calendarColor,
        color: event.color,
        status: "confirmed",
        visibility: event.visibility || "default",
        transparency: event.transparency || "opaque",
        reminders: event.reminders,
        created: now,
        updated: now,
      };

      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) => (old ? [...old, optimisticEvent] : [optimisticEvent]),
      );

      await db.events.add(calendarEventToDexie(optimisticEvent));

      return { tempId, previousLists };
    },
    onError: (_, { calendarId }, context) => {
      if (context?.previousLists) {
        restoreLists(queryClient, context.previousLists);
      }
      if (context?.tempId) {
        db.events
          .where("[calendarId+googleEventId]")
          .equals([calendarId, context.tempId])
          .delete();
      }
      toast.error("Failed to create event");
    },
    onSuccess: async (createdEvent, { calendarId }, context) => {
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.id === context?.tempId && item.calendarId === calendarId
              ? createdEvent
              : item,
          ),
      );

      if (context?.tempId) {
        await db.transaction("rw", db.events, async () => {
          const tempDexie = await db.events
            .where("[calendarId+googleEventId]")
            .equals([calendarId, context.tempId])
            .first();
          if (tempDexie) {
            await db.events.delete(tempDexie.id!);
          }
          await db.events.add(calendarEventToDexie(createdEvent));
        });
      }
    },
    onSettled: () => {
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
      const previousLists = await cancelAndSnapshot(queryClient);
      await queryClient.cancelQueries({
        queryKey: eventKeys.detail(calendarId, eventId),
      });

      const previousDetail = queryClient.getQueryData<CalendarEvent>(
        eventKeys.detail(calendarId, eventId),
      );
      const previousDexieEvent = await db.events
        .where("[calendarId+googleEventId]")
        .equals([calendarId, eventId])
        .first();
      const baseEvent =
        currentEvent ??
        (previousDexieEvent
          ? dexieToCalendarEvent(previousDexieEvent)
          : previousDetail);
      if (!baseEvent) return { calendarId, eventId, previousDetail, previousLists };
      const optimisticEvent: CalendarEvent = {
        ...baseEvent,
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
      restoreLists(queryClient, context?.previousLists ?? []);
      if (context?.previousDexieEvent) {
        rollbackDexieEvent(context.previousDexieEvent);
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
      await db.transaction("rw", db.events, async () => {
        const existingDexieEvent = await db.events
          .where("[calendarId+googleEventId]")
          .equals([calendarId, eventId])
          .first();
        await db.events.put({
          ...calendarEventToDexie(updatedEvent),
          id: existingDexieEvent?.id,
        });
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
    onMutate: async ({ calendarId, eventId }) => {
      const previousLists = await cancelAndSnapshot(queryClient);
      const previousDexieEvent = await db.events
        .where("[calendarId+googleEventId]")
        .equals([calendarId, eventId])
        .first();

      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.filter(
            (item) => !(item.id === eventId && item.calendarId === calendarId),
          ),
      );
      if (previousDexieEvent) {
        await db.events.delete(previousDexieEvent.id!);
      }

      return { previousLists, previousDexieEvent };
    },
    onError: (_, __, context) => {
      restoreLists(queryClient, context?.previousLists ?? []);
      if (context?.previousDexieEvent) {
        rollbackDexieEvent(context.previousDexieEvent);
      }
      toast.error("Failed to delete event");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

export function useToggleEventCompletion() {
  const queryClient = useQueryClient();

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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}
