import { QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { eventsApi } from "../api/events";
import type { CalendarEvent, EventCompletion } from "../types";
import { eventKeys } from "../lib";
import { completionToDexie, db } from "../lib/db";

type PreviousLists = [unknown, CalendarEvent[] | undefined][];

async function cancelAndSnapshot(queryClient: QueryClient): Promise<PreviousLists> {
  await queryClient.cancelQueries({ queryKey: eventKeys.lists() });
  return queryClient.getQueriesData<CalendarEvent[]>({ queryKey: eventKeys.lists() });
}

function restoreLists(queryClient: QueryClient, previousLists: PreviousLists): void {
  for (const [queryKey, data] of previousLists) {
    queryClient.setQueryData(queryKey as string[], data);
  }
}

function findEvent(googleCalendarId: string, googleEventId: string): Promise<CalendarEvent | undefined> {
  return db.events
    .where("[googleCalendarId+googleEventId]")
    .equals([googleCalendarId, googleEventId])
    .first();
}

async function upsertEvent(event: CalendarEvent): Promise<void> {
  const existing = await findEvent(event.googleCalendarId, event.googleEventId);
  await db.events.put({
    ...event,
    uuid: existing?.uuid,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      googleCalendarId,
      event,
    }: {
      googleCalendarId: string;
      event: Partial<CalendarEvent>;
      calendarColor?: string;
    }) => eventsApi.create(googleCalendarId, event),
    onMutate: async ({ googleCalendarId, event, calendarColor }) => {
      const previousLists = await cancelAndSnapshot(queryClient);
      const tempId = `temp-${Date.now()}`;
      const now = new Date().toISOString();

      await db.events.add({
        googleEventId: tempId,
        googleCalendarId,
        completed: false,
        summary: event.summary || "",
        description: event.description,
        location: event.location,
        start: event.start || { dateTime: now },
        end: event.end || { dateTime: now },
        recurrence: event.recurrence?.length ? event.recurrence : undefined,
        attendees: event.attendees,
        colorId: event.colorId || calendarColor,
        status: "confirmed",
        visibility: event.visibility || "default",
        transparency: event.transparency || "opaque",
        reminders: event.reminders,
        createdAt: now,
        updatedAt: now,
      } as CalendarEvent);

      return { tempId, previousLists };
    },
    onError: async (_, { googleCalendarId }, context) => {
      if (context?.previousLists) {
        restoreLists(queryClient, context.previousLists);
      }
      if (context?.tempId) {
        const temp = await findEvent(googleCalendarId, context.tempId);
        if (temp) await db.events.delete(temp.uuid!);
      }
      toast.error("Failed to create event");
    },
    onSuccess: async (createdEvent, { googleCalendarId }, context) => {
      if (context?.tempId) {
        await db.transaction("rw", db.events, async () => {
          const temp = await findEvent(googleCalendarId, context.tempId);
          if (temp) await db.events.delete(temp.uuid!);
          await db.events.add(createdEvent);
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
      googleCalendarId,
      eventId,
      event,
    }: {
      googleCalendarId: string;
      eventId: string;
      event: Partial<CalendarEvent>;
      currentEvent?: CalendarEvent;
    }) => eventsApi.update(googleCalendarId, eventId, event),
    onMutate: async ({ googleCalendarId, eventId, event, currentEvent }) => {
      const previousLists = await cancelAndSnapshot(queryClient);
      await queryClient.cancelQueries({
        queryKey: eventKeys.detail(googleCalendarId, eventId),
      });

      const previousDetail = queryClient.getQueryData<CalendarEvent>(
        eventKeys.detail(googleCalendarId, eventId),
      );
      const previousEvent = await findEvent(googleCalendarId, eventId);
      const baseEvent = currentEvent ?? previousEvent ?? previousDetail;

      if (!baseEvent) return { googleCalendarId, eventId, previousDetail, previousLists };

      const optimisticEvent: CalendarEvent = { ...baseEvent, ...event };

      queryClient.setQueryData(
        eventKeys.detail(googleCalendarId, eventId),
        optimisticEvent,
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.googleEventId === eventId && item.googleCalendarId === googleCalendarId
              ? { ...item, ...event }
              : item,
          ),
      );
      await db.events.put({
        ...optimisticEvent,
        uuid: previousEvent?.uuid,
      });

      return {
        googleCalendarId,
        eventId,
        previousDetail,
        previousLists,
        previousEvent,
      };
    },
    onError: (_, __, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          eventKeys.detail(context.googleCalendarId, context.eventId),
          context.previousDetail,
        );
      }
      restoreLists(queryClient, context?.previousLists ?? []);
      if (context?.previousEvent) {
        db.events.put(context.previousEvent).catch((e) => {
          console.error("Dexie rollback failed:", e);
        });
      }
      toast.error("Failed to update event");
    },
    onSuccess: async (updatedEvent, { googleCalendarId, eventId }) => {
      queryClient.setQueryData(
        eventKeys.detail(googleCalendarId, eventId),
        updatedEvent,
      );
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.map((item) =>
            item.googleEventId === eventId && item.googleCalendarId === googleCalendarId
              ? updatedEvent
              : item,
          ),
      );
      await upsertEvent(updatedEvent);
    },
    onSettled: (_, __, { googleCalendarId, eventId }) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: eventKeys.detail(googleCalendarId, eventId),
      });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      googleCalendarId,
      eventId,
    }: {
      googleCalendarId: string;
      eventId: string;
    }) => eventsApi.delete(googleCalendarId, eventId),
    onMutate: async ({ googleCalendarId, eventId }) => {
      const previousLists = await cancelAndSnapshot(queryClient);
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old?.filter(
            (item) => !(item.googleEventId === eventId && item.googleCalendarId === googleCalendarId),
          ),
      );
      const previousEvent = await findEvent(googleCalendarId, eventId);
      if (previousEvent) {
        await db.events.delete(previousEvent.uuid!);
      }

      return { previousLists, previousEvent };
    },
    onError: (_, __, context) => {
      restoreLists(queryClient, context?.previousLists ?? []);
      if (context?.previousEvent) {
        db.events.put(context.previousEvent).catch((e) => {
          console.error("Dexie rollback failed:", e);
        });
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
