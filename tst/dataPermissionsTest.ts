import { id, init } from "@instantdb/admin";
import { PlatformApi } from "@instantdb/platform";
import { Effect, Either } from "effect";
import { beforeAll, describe, expect, test } from "vitest";

import permissions from "../instant.perms.js";
import schema from "../instant.schema.js";

const createAdminDatabase = (appId: string, adminToken: string) =>
  init({ appId, adminToken, schema });

type AdminDatabase = ReturnType<typeof createAdminDatabase>;
type UserDatabase = ReturnType<AdminDatabase["asUser"]>;

interface SecurityContext {
  readonly admin: AdminDatabase;
  readonly test1: UserDatabase;
  readonly test1Id: string;
  readonly test2: UserDatabase;
  readonly test2Id: string;
  readonly guest: UserDatabase;
  readonly test1GoogleAccountId: string;
  readonly test1GoogleCredentialId: string;
  readonly test1CalendarId: string;
  readonly test1SecondaryCalendarId: string;
  readonly test1CalendarEventId: string;
  readonly test1ListId: string;
  readonly test1TodoId: string;
  readonly test1LabelId: string;
  readonly test1CompletionId: string;
  readonly test1CompletionKey: string;
  readonly test1PreferenceId: string;
  readonly test2ListId: string;
  readonly test2LabelId: string;
  readonly test2TodoId: string;
  readonly fileId: string;
}

let testContext: SecurityContext | undefined;

const fromPromise = <A>(label: string, evaluate: () => Promise<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`),
  });

const run = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(program);

const context = () => {
  if (!testContext) {
    throw new Error("Security test context has not been initialized");
  }
  return testContext;
};

const expectDenied = <A>(label: string, evaluate: () => Promise<A>) =>
  Effect.gen(function* () {
    const result = yield* Effect.either(fromPromise(label, evaluate));
    yield* Effect.sync(() => expect(Either.isLeft(result), label).toBe(true));
  });

const listFields = (name: string) => {
  const now = Date.now();
  return {
    name,
    color: "#2563EB",
    isSystem: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const todoFields = (title: string) => {
  const now = Date.now();
  return {
    title,
    completed: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const calendarFields = (accountId: string, googleCalendarId: string) => {
  const now = Date.now();
  return {
    accountCalendarKey: `${accountId}:${googleCalendarId}`,
    googleCalendarId,
    summary: googleCalendarId,
    accessRole: "owner",
    isPrimary: googleCalendarId === "primary",
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
};

const eventFields = (accountId: string, calendarId: string, eventId: string) => {
  const now = Date.now();
  return {
    accountEventKey: `${accountId}:${calendarId}:${eventId}`,
    googleEventId: eventId,
    sequence: 0,
    status: "confirmed",
    eventType: "default",
    summary: "Private calendar event",
    isAllDay: false,
    startAt: now,
    endAt: now + 3_600_000,
    providerUpdatedAt: now,
    syncedAt: now,
  };
};

const setup = Effect.gen(function* () {
  const temporaryApi = new PlatformApi({});
  const { app } = yield* fromPromise("create temporary Instant app", () =>
    temporaryApi.createTemporaryApp({
      title: `chronos-security-${Date.now()}`,
      schema,
      rules: { code: permissions },
    }),
  );

  const admin = createAdminDatabase(app.id, app.adminToken);
  const test1Token = yield* fromPromise("create test1", () =>
    admin.auth.createToken({ email: "security-test1@chronos.test" }),
  );
  const test2Token = yield* fromPromise("create test2", () =>
    admin.auth.createToken({ email: "security-test2@chronos.test" }),
  );
  const test1User = yield* fromPromise("resolve test1", () =>
    admin.auth.verifyToken(test1Token),
  );
  const test2User = yield* fromPromise("resolve test2", () =>
    admin.auth.verifyToken(test2Token),
  );

  const test1GoogleAccountId = id();
  const test1GoogleCredentialId = id();
  const test1CalendarId = id();
  const test1SecondaryCalendarId = id();
  const test1CalendarEventId = id();
  const test1ListId = id();
  const test1TodoId = id();
  const test1LabelId = id();
  const test1CompletionId = id();
  const test1PreferenceId = id();
  const test2ListId = id();
  const test2LabelId = id();
  const test2TodoId = id();
  const now = Date.now();
  const test1CompletionKey = `${test1User.id}:${test1TodoId}:2026-08-16`;

  yield* fromPromise("seed security fixtures", () =>
    admin.transact([
      admin.tx.googleAccounts[test1GoogleAccountId]
        .update({
          providerAccountId: "security-test1-google",
          email: "security-test1@chronos.test",
          connectedAt: now,
          updatedAt: now,
        })
        .link({ user: test1User.id }),
      admin.tx.googleCredentials[test1GoogleCredentialId]
        .update({
          encryptedRefreshToken: "encrypted-test-token",
          encryptionKeyVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .link({ googleAccount: test1GoogleAccountId }),
      admin.tx.calendars[test1CalendarId]
        .update(calendarFields(test1GoogleAccountId, "primary"))
        .link({ googleAccount: test1GoogleAccountId, user: test1User.id }),
      admin.tx.calendars[test1SecondaryCalendarId]
        .update(calendarFields(test1GoogleAccountId, "secondary"))
        .link({ googleAccount: test1GoogleAccountId, user: test1User.id }),
      admin.tx.calendarEvents[test1CalendarEventId]
        .update(eventFields(test1GoogleAccountId, "primary", "event-1"))
        .link({ calendar: test1CalendarId, user: test1User.id }),
      admin.tx.todoLists[test1ListId]
        .update(listFields("test1 private list"))
        .link({ user: test1User.id }),
      admin.tx.labels[test1LabelId]
        .update({
          name: "test1 private label",
          color: "#DC2626",
          createdAt: now,
          updatedAt: now,
        })
        .link({ user: test1User.id }),
      admin.tx.todos[test1TodoId]
        .update(todoFields("test1 private todo"))
        .link({ user: test1User.id, todoList: test1ListId, labels: test1LabelId }),
      admin.tx.taskCompletions[test1CompletionId]
        .update({
          occurrenceKey: test1CompletionKey,
          occurrenceAt: now,
          completedAt: now,
          createdAt: now,
        })
        .link({ user: test1User.id, todo: test1TodoId }),
      admin.tx.calendarPreferences[test1PreferenceId]
        .update({
          preferenceKey: `${test1User.id}:${test1CalendarId}`,
          visible: true,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .link({ user: test1User.id, calendar: test1CalendarId }),
      admin.tx.todoLists[test2ListId]
        .update(listFields("test2 private list"))
        .link({ user: test2User.id }),
      admin.tx.labels[test2LabelId]
        .update({
          name: "test2 private label",
          color: "#2563EB",
          createdAt: now,
          updatedAt: now,
        })
        .link({ user: test2User.id }),
      admin.tx.todos[test2TodoId]
        .update(todoFields("test2 private todo"))
        .link({ user: test2User.id, todoList: test2ListId }),
    ]),
  );
  const uploadedFile = yield* fromPromise("seed private storage file", () =>
    admin.storage.uploadFile(
      "security/private.txt",
      new TextEncoder().encode("private"),
      { contentType: "text/plain" },
    ),
  );

  return {
    admin,
    test1: admin.asUser({ token: test1Token }),
    test1Id: test1User.id,
    test2: admin.asUser({ token: test2Token }),
    test2Id: test2User.id,
    guest: admin.asUser({ guest: true }),
    test1GoogleAccountId,
    test1GoogleCredentialId,
    test1CalendarId,
    test1SecondaryCalendarId,
    test1CalendarEventId,
    test1ListId,
    test1TodoId,
    test1LabelId,
    test1CompletionId,
    test1CompletionKey,
    test1PreferenceId,
    test2ListId,
    test2LabelId,
    test2TodoId,
    fileId: uploadedFile.data.id,
  } satisfies SecurityContext;
});

beforeAll(() =>
  run(
    setup.pipe(
      Effect.tap((ctx) =>
        Effect.sync(() => {
          testContext = ctx;
        }),
      ),
    ),
  ),
);

describe.sequential("InstantDB data permissions", () => {
  test("creates an owned task graph atomically", () => {
    const ctx = context();
    const listId = id();
    const labelId = id();
    const todoId = id();
    const completionId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("create owned task graph", () =>
          ctx.test1.transact([
            ctx.test1.tx.todoLists[listId]
              .update(listFields("Today"))
              .link({ user: ctx.test1Id }),
            ctx.test1.tx.labels[labelId]
              .update({
                name: "Important",
                color: "#DC2626",
                createdAt: now,
                updatedAt: now,
              })
              .link({ user: ctx.test1Id }),
            ctx.test1.tx.todos[todoId]
              .update(todoFields("Plan the week"))
              .link({ user: ctx.test1Id, todoList: listId, labels: labelId }),
            ctx.test1.tx.taskCompletions[completionId]
              .update({
                occurrenceKey: `${ctx.test1Id}:${todoId}:2026-08-15`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.test1Id, todo: todoId }),
          ]),
        );

        const result = yield* fromPromise("query owned task graph", () =>
          ctx.test1.query({
            todos: {
              $: { where: { id: todoId } },
              todoList: {},
              labels: {},
              completions: {},
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.todos).toHaveLength(1);
          expect(result.todos[0]?.todoList?.id).toBe(listId);
          expect(result.todos[0]?.labels[0]?.id).toBe(labelId);
          expect(result.todos[0]?.completions[0]?.id).toBe(completionId);
        });
      }),
    );
  });

  test("hides protected records from other users and guests", () => {
    const ctx = context();

    return run(
      Effect.gen(function* () {
        const test2Result = yield* fromPromise("test2 queries test1's records", () =>
          ctx.test2.query({
            $users: { $: { where: { id: ctx.test1Id } } },
            googleAccounts: { $: { where: { id: ctx.test1GoogleAccountId } } },
            googleCredentials: {
              $: { where: { id: ctx.test1GoogleCredentialId } },
            },
            calendars: { $: { where: { id: ctx.test1CalendarId } } },
            calendarEvents: { $: { where: { id: ctx.test1CalendarEventId } } },
            calendarPreferences: {
              $: { where: { id: ctx.test1PreferenceId } },
            },
            todoLists: { $: { where: { id: ctx.test1ListId } } },
            todos: { $: { where: { id: ctx.test1TodoId } } },
            labels: { $: { where: { id: ctx.test1LabelId } } },
            taskCompletions: {
              $: { where: { id: ctx.test1CompletionId } },
            },
          }),
        );

        const guestResult = yield* fromPromise("guest queries protected data", () =>
          ctx.guest.query({
            todos: { $: { where: { id: ctx.test1TodoId } } },
            googleAccounts: {
              $: { where: { id: ctx.test1GoogleAccountId } },
            },
            $files: { $: { where: { id: ctx.fileId } } },
            $streams: {},
          }),
        );

        yield* Effect.sync(() => {
          expect(test2Result.$users).toHaveLength(0);
          expect(test2Result.googleAccounts).toHaveLength(0);
          expect(test2Result.googleCredentials).toHaveLength(0);
          expect(test2Result.calendars).toHaveLength(0);
          expect(test2Result.calendarEvents).toHaveLength(0);
          expect(test2Result.calendarPreferences).toHaveLength(0);
          expect(test2Result.todoLists).toHaveLength(0);
          expect(test2Result.todos).toHaveLength(0);
          expect(test2Result.labels).toHaveLength(0);
          expect(test2Result.taskCompletions).toHaveLength(0);
          expect(guestResult.todos).toHaveLength(0);
          expect(guestResult.googleAccounts).toHaveLength(0);
          expect(guestResult.$files).toHaveLength(0);
          expect(guestResult.$streams).toHaveLength(0);
        });

        yield* expectDenied("guest updates test1's todo", () =>
          ctx.guest.transact(
            ctx.guest.tx.todos[ctx.test1TodoId].update({ title: "Guest edit" }),
          ),
        );
      }),
    );
  });

  test("allows owned updates and label unlinking while rejecting test2's mutations", () => {
    const ctx = context();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("test1 updates owned records", () =>
          ctx.test1.transact([
            ctx.test1.tx.$users[ctx.test1Id].update({
              name: "test1",
              timeZone: "America/Los_Angeles",
            }),
            ctx.test1.tx.todoLists[ctx.test1ListId].update({
              name: "test1 updated list",
              updatedAt: now,
            }),
            ctx.test1.tx.todos[ctx.test1TodoId].update({
              title: "test1 updated todo",
              updatedAt: now,
            }),
            ctx.test1.tx.labels[ctx.test1LabelId].update({
              name: "test1 updated label",
              updatedAt: now,
            }),
            ctx.test1.tx.taskCompletions[ctx.test1CompletionId].update({
              completedAt: now,
            }),
            ctx.test1.tx.calendarPreferences[ctx.test1PreferenceId].update({
              visible: false,
              updatedAt: now,
            }),
          ]),
        );

        yield* fromPromise("test1 unlinks and relinks a label", () =>
          ctx.test1.transact([
            ctx.test1.tx.todos[ctx.test1TodoId].unlink({
              labels: ctx.test1LabelId,
            }),
            ctx.test1.tx.todos[ctx.test1TodoId].link({
              labels: ctx.test1LabelId,
            }),
          ]),
        );

        yield* expectDenied("test2 updates test1's todo", () =>
          ctx.test2.transact(
            ctx.test2.tx.todos[ctx.test1TodoId].update({ title: "Stolen" }),
          ),
        );
        yield* expectDenied("test2 deletes test1's todo", () =>
          ctx.test2.transact(ctx.test2.tx.todos[ctx.test1TodoId].delete()),
        );
        yield* expectDenied("test2 unlinks test1's label", () =>
          ctx.test2.transact(
            ctx.test2.tx.todos[ctx.test1TodoId].unlink({ labels: ctx.test1LabelId }),
          ),
        );
        yield* expectDenied("test2 moves test1's todo into test2's list", () =>
          ctx.test2.transact(
            ctx.test2.tx.todos[ctx.test1TodoId].link({ todoList: ctx.test2ListId }),
          ),
        );
        yield* expectDenied("test2 reverse-links test1's todo from test2's list", () =>
          ctx.test2.transact(
            ctx.test2.tx.todoLists[ctx.test2ListId].link({ todos: ctx.test1TodoId }),
          ),
        );
        yield* expectDenied("test2 reverse-tags test1's todo from test2's label", () =>
          ctx.test2.transact(
            ctx.test2.tx.labels[ctx.test2LabelId].link({ todos: ctx.test1TodoId }),
          ),
        );
        yield* expectDenied("test2 reverse-links test1's completion", () =>
          ctx.test2.transact(
            ctx.test2.tx.todos[ctx.test2TodoId].link({
              completions: ctx.test1CompletionId,
            }),
          ),
        );
        yield* expectDenied("test1 changes an auth-managed profile field", () =>
          ctx.test1.transact(
            ctx.test1.tx.$users[ctx.test1Id].update({
              imageURL: "https://example.com/tampered.png",
            }),
          ),
        );
        yield* expectDenied("test1 links unrelated users", () =>
          ctx.test1.transact(
            ctx.test1.tx.$users[ctx.test1Id].link({
              linkedPrimaryUser: ctx.test2Id,
            }),
          ),
        );
        yield* expectDenied("test1 unlinks todo ownership", () =>
          ctx.test1.transact(
            ctx.test1.tx.todos[ctx.test1TodoId].unlink({ user: ctx.test1Id }),
          ),
        );
        yield* expectDenied("test1 unlinks a required todo list", () =>
          ctx.test1.transact(
            ctx.test1.tx.todos[ctx.test1TodoId].unlink({
              todoList: ctx.test1ListId,
            }),
          ),
        );
        yield* expectDenied("test1 unlinks completion identity", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[ctx.test1CompletionId].unlink({
              todo: ctx.test1TodoId,
            }),
          ),
        );
        yield* expectDenied("test1 unlinks preference identity", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarPreferences[ctx.test1PreferenceId].unlink({
              calendar: ctx.test1CalendarId,
            }),
          ),
        );
      }),
    );
  });

  test("rejects missing and spoofed owner links during creation", () => {
    const ctx = context();
    const ownerlessListId = id();
    const spoofedListId = id();
    const spoofedTodoId = id();
    const spoofedPreferenceId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* expectDenied("create ownerless list", () =>
          ctx.test1.transact(
            ctx.test1.tx.todoLists[ownerlessListId].update(listFields("Ownerless")),
          ),
        );
        yield* expectDenied("test1 creates test2-owned list", () =>
          ctx.test1.transact(
            ctx.test1.tx.todoLists[spoofedListId]
              .update(listFields("Spoofed list"))
              .link({ user: ctx.test2Id }),
          ),
        );
        yield* expectDenied("test1 creates test2-owned todo", () =>
          ctx.test1.transact(
            ctx.test1.tx.todos[spoofedTodoId]
              .update(todoFields("Spoofed todo"))
              .link({ user: ctx.test2Id, todoList: ctx.test2ListId }),
          ),
        );
        yield* expectDenied("test1 creates test2-owned preference", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarPreferences[spoofedPreferenceId]
              .update({
                preferenceKey: `${ctx.test2Id}:${ctx.test1CalendarId}`,
                visible: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              })
              .link({ user: ctx.test2Id, calendar: ctx.test1CalendarId }),
          ),
        );
      }),
    );
  });

  test("exposes provider read models only to their owner and blocks client writes", () => {
    const ctx = context();
    const newAccountId = id();
    const newCredentialId = id();
    const newEventId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        const result = yield* fromPromise("test1 queries provider data", () =>
          ctx.test1.query({
            googleAccounts: {
              $: { where: { id: ctx.test1GoogleAccountId } },
            },
            calendarEvents: {
              $: { where: { id: ctx.test1CalendarEventId } },
            },
            googleCredentials: {
              $: { where: { id: ctx.test1GoogleCredentialId } },
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.googleAccounts).toHaveLength(1);
          expect(result.calendarEvents).toHaveLength(1);
          expect(result.googleCredentials).toHaveLength(0);
        });

        yield* expectDenied("client updates Google account", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleAccounts[ctx.test1GoogleAccountId].update({
              displayName: "Tampered",
            }),
          ),
        );
        yield* expectDenied("client deletes Google account", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleAccounts[ctx.test1GoogleAccountId].delete(),
          ),
        );
        yield* expectDenied("client creates Google account", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleAccounts[newAccountId]
              .update({
                providerAccountId: "client-created-account",
                email: "client@chronos.test",
                connectedAt: now,
                updatedAt: now,
              })
              .link({ user: ctx.test1Id }),
          ),
        );
        yield* expectDenied("client updates calendar event", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarEvents[ctx.test1CalendarEventId].update({
              summary: "Tampered",
            }),
          ),
        );
        yield* expectDenied("client updates synced calendar", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendars[ctx.test1CalendarId].update({
              summary: "Tampered",
            }),
          ),
        );
        yield* expectDenied("client creates calendar event", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarEvents[newEventId]
              .update(eventFields(ctx.test1GoogleAccountId, "primary", "client-event"))
              .link({ calendar: ctx.test1CalendarId, user: ctx.test1Id }),
          ),
        );
        yield* expectDenied("client creates Google credential", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleCredentials[newCredentialId]
              .update({
                encryptedRefreshToken: "not-allowed",
                encryptionKeyVersion: 1,
                createdAt: now,
                updatedAt: now,
              })
              .link({ googleAccount: ctx.test1GoogleAccountId }),
          ),
        );
        yield* expectDenied("client updates Google credential", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleCredentials[ctx.test1GoogleCredentialId].update({
              encryptionKeyVersion: 2,
            }),
          ),
        );
        yield* expectDenied("client deletes Google credential", () =>
          ctx.test1.transact(
            ctx.test1.tx.googleCredentials[ctx.test1GoogleCredentialId].delete(),
          ),
        );
      }),
    );
  });

  test("keeps files and streams inaccessible to clients", () => {
    const ctx = context();

    return run(
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          expect(permissions.$default.allow.$default).toBe("false");
          expect(permissions).not.toHaveProperty("$streams");
        });

        const result = yield* fromPromise("query denied storage namespaces", () =>
          ctx.test1.query({
            $files: { $: { where: { id: ctx.fileId } } },
            $streams: {},
          }),
        );
        yield* Effect.sync(() => {
          expect(result.$files).toHaveLength(0);
          expect(result.$streams).toHaveLength(0);
        });

        yield* expectDenied("client updates file metadata", () =>
          ctx.test1.transact(
            ctx.test1.tx.$files[ctx.fileId].update({
              path: "security/renamed.txt",
            }),
          ),
        );
        yield* expectDenied("client deletes file metadata", () =>
          ctx.test1.transact(ctx.test1.tx.$files[ctx.fileId].delete()),
        );
        yield* expectDenied("client uploads storage file", () =>
          ctx.test1.storage.uploadFile(
            "security/upload.txt",
            new TextEncoder().encode("denied"),
            { contentType: "text/plain" },
          ),
        );
      }),
    );
  });

  test("rejects invalid, cross-user, and mutable completion identities", () => {
    const ctx = context();
    const invalidCompletionId = id();
    const crossUserCompletionId = id();
    const test2SpoofedCompletionId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* expectDenied("invalid completion key", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[invalidCompletionId]
              .update({
                occurrenceKey: `wrong:${ctx.test1TodoId}:2026-08-17`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.test1Id, todo: ctx.test1TodoId }),
          ),
        );
        yield* expectDenied("test1 completes test2's todo", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[crossUserCompletionId]
              .update({
                occurrenceKey: `${ctx.test1Id}:${ctx.test2TodoId}:2026-08-17`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.test1Id, todo: ctx.test2TodoId }),
          ),
        );
        yield* expectDenied("test2 squats on test1's completion key", () =>
          ctx.test2.transact(
            ctx.test2.tx.taskCompletions[test2SpoofedCompletionId]
              .update({
                occurrenceKey: `${ctx.test1Id}:${ctx.test2TodoId}:2026-08-18`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.test2Id, todo: ctx.test2TodoId }),
          ),
        );
        yield* expectDenied("change completion occurrence key", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[ctx.test1CompletionId].update({
              occurrenceKey: `${ctx.test1Id}:${ctx.test1TodoId}:changed`,
            }),
          ),
        );
        yield* expectDenied("change completion occurrence time", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[ctx.test1CompletionId].update({
              occurrenceAt: now + 1,
            }),
          ),
        );
      }),
    );
  });

  test("enforces uniqueness during duplicate and concurrent writes", () => {
    const ctx = context();
    const duplicateCompletionId = id();
    const invalidPreferenceId = id();
    const firstPreferenceId = id();
    const secondPreferenceId = id();
    const preferenceKey = `${ctx.test1Id}:${ctx.test1SecondaryCalendarId}`;
    const now = Date.now();

    const createPreference = (preferenceId: string) =>
      fromPromise(`create concurrent preference ${preferenceId}`, () =>
        ctx.test1.transact(
          ctx.test1.tx.calendarPreferences[preferenceId]
            .update({
              preferenceKey,
              visible: true,
              isDefault: false,
              createdAt: now,
              updatedAt: now,
            })
            .link({ user: ctx.test1Id, calendar: ctx.test1SecondaryCalendarId }),
        ),
      );

    return run(
      Effect.gen(function* () {
        yield* expectDenied("preference key does not match owner and calendar", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarPreferences[invalidPreferenceId]
              .update({
                preferenceKey: `wrong:${ctx.test1SecondaryCalendarId}`,
                visible: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              })
              .link({
                user: ctx.test1Id,
                calendar: ctx.test1SecondaryCalendarId,
              }),
          ),
        );
        yield* expectDenied("preference identity cannot be changed", () =>
          ctx.test1.transact(
            ctx.test1.tx.calendarPreferences[ctx.test1PreferenceId].update({
              preferenceKey: `${ctx.test1Id}:${ctx.test1SecondaryCalendarId}`,
            }),
          ),
        );
        yield* expectDenied("duplicate completion occurrence key", () =>
          ctx.test1.transact(
            ctx.test1.tx.taskCompletions[duplicateCompletionId]
              .update({
                occurrenceKey: ctx.test1CompletionKey,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.test1Id, todo: ctx.test1TodoId }),
          ),
        );

        const attempts = yield* Effect.all(
          [
            Effect.either(createPreference(firstPreferenceId)),
            Effect.either(createPreference(secondPreferenceId)),
          ],
          { concurrency: "unbounded" },
        );
        const successfulAttempts = attempts.filter(Either.isRight);
        const failedAttempts = attempts.filter(Either.isLeft);
        yield* Effect.sync(() => {
          expect(successfulAttempts).toHaveLength(1);
          expect(failedAttempts).toHaveLength(1);
        });

        const result = yield* fromPromise("query unique preference", () =>
          ctx.test1.query({
            calendarPreferences: {
              $: { where: { preferenceKey } },
            },
          }),
        );
        yield* Effect.sync(() =>
          expect(result.calendarPreferences).toHaveLength(1),
        );
      }),
    );
  });

});
