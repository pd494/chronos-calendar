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
  readonly alice: UserDatabase;
  readonly aliceId: string;
  readonly bob: UserDatabase;
  readonly bobId: string;
  readonly guest: UserDatabase;
  readonly aliceGoogleAccountId: string;
  readonly aliceGoogleCredentialId: string;
  readonly aliceCalendarId: string;
  readonly aliceSecondaryCalendarId: string;
  readonly aliceCalendarEventId: string;
  readonly aliceListId: string;
  readonly aliceTodoId: string;
  readonly aliceLabelId: string;
  readonly aliceCompletionId: string;
  readonly aliceCompletionKey: string;
  readonly alicePreferenceId: string;
  readonly bobListId: string;
  readonly bobTodoId: string;
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
  const aliceToken = yield* fromPromise("create Alice", () =>
    admin.auth.createToken({ email: "security-alice@chronos.test" }),
  );
  const bobToken = yield* fromPromise("create Bob", () =>
    admin.auth.createToken({ email: "security-bob@chronos.test" }),
  );
  const aliceUser = yield* fromPromise("resolve Alice", () =>
    admin.auth.verifyToken(aliceToken),
  );
  const bobUser = yield* fromPromise("resolve Bob", () =>
    admin.auth.verifyToken(bobToken),
  );

  const aliceGoogleAccountId = id();
  const aliceGoogleCredentialId = id();
  const aliceCalendarId = id();
  const aliceSecondaryCalendarId = id();
  const aliceCalendarEventId = id();
  const aliceListId = id();
  const aliceTodoId = id();
  const aliceLabelId = id();
  const aliceCompletionId = id();
  const alicePreferenceId = id();
  const bobListId = id();
  const bobTodoId = id();
  const now = Date.now();
  const aliceCompletionKey = `${aliceUser.id}:${aliceTodoId}:2026-08-16`;

  yield* fromPromise("seed security fixtures", () =>
    admin.transact([
      admin.tx.googleAccounts[aliceGoogleAccountId]
        .update({
          providerAccountId: "security-alice-google",
          email: "security-alice@chronos.test",
          connectedAt: now,
          updatedAt: now,
        })
        .link({ user: aliceUser.id }),
      admin.tx.googleCredentials[aliceGoogleCredentialId]
        .update({
          encryptedRefreshToken: "encrypted-test-token",
          encryptionKeyVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .link({ googleAccount: aliceGoogleAccountId }),
      admin.tx.calendars[aliceCalendarId]
        .update(calendarFields(aliceGoogleAccountId, "primary"))
        .link({ googleAccount: aliceGoogleAccountId, user: aliceUser.id }),
      admin.tx.calendars[aliceSecondaryCalendarId]
        .update(calendarFields(aliceGoogleAccountId, "secondary"))
        .link({ googleAccount: aliceGoogleAccountId, user: aliceUser.id }),
      admin.tx.calendarEvents[aliceCalendarEventId]
        .update(eventFields(aliceGoogleAccountId, "primary", "event-1"))
        .link({ calendar: aliceCalendarId, user: aliceUser.id }),
      admin.tx.todoLists[aliceListId]
        .update(listFields("Alice private list"))
        .link({ user: aliceUser.id }),
      admin.tx.labels[aliceLabelId]
        .update({
          name: "Alice private label",
          color: "#DC2626",
          createdAt: now,
          updatedAt: now,
        })
        .link({ user: aliceUser.id }),
      admin.tx.todos[aliceTodoId]
        .update(todoFields("Alice private todo"))
        .link({ user: aliceUser.id, todoList: aliceListId, labels: aliceLabelId }),
      admin.tx.taskCompletions[aliceCompletionId]
        .update({
          occurrenceKey: aliceCompletionKey,
          occurrenceAt: now,
          completedAt: now,
          createdAt: now,
        })
        .link({ user: aliceUser.id, todo: aliceTodoId }),
      admin.tx.calendarPreferences[alicePreferenceId]
        .update({
          preferenceKey: `${aliceUser.id}:${aliceCalendarId}`,
          visible: true,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .link({ user: aliceUser.id, calendar: aliceCalendarId }),
      admin.tx.todoLists[bobListId]
        .update(listFields("Bob private list"))
        .link({ user: bobUser.id }),
      admin.tx.todos[bobTodoId]
        .update(todoFields("Bob private todo"))
        .link({ user: bobUser.id, todoList: bobListId }),
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
    alice: admin.asUser({ token: aliceToken }),
    aliceId: aliceUser.id,
    bob: admin.asUser({ token: bobToken }),
    bobId: bobUser.id,
    guest: admin.asUser({ guest: true }),
    aliceGoogleAccountId,
    aliceGoogleCredentialId,
    aliceCalendarId,
    aliceSecondaryCalendarId,
    aliceCalendarEventId,
    aliceListId,
    aliceTodoId,
    aliceLabelId,
    aliceCompletionId,
    aliceCompletionKey,
    alicePreferenceId,
    bobListId,
    bobTodoId,
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

describe.sequential("InstantDB security boundaries", () => {
  test("hides Alice's records from Bob across every protected namespace", () => {
    const ctx = context();

    return run(
      Effect.gen(function* () {
        const result = yield* fromPromise("Bob queries Alice's records", () =>
          ctx.bob.query({
            $users: { $: { where: { id: ctx.aliceId } } },
            googleAccounts: { $: { where: { id: ctx.aliceGoogleAccountId } } },
            googleCredentials: {
              $: { where: { id: ctx.aliceGoogleCredentialId } },
            },
            calendars: { $: { where: { id: ctx.aliceCalendarId } } },
            calendarEvents: { $: { where: { id: ctx.aliceCalendarEventId } } },
            calendarPreferences: {
              $: { where: { id: ctx.alicePreferenceId } },
            },
            todoLists: { $: { where: { id: ctx.aliceListId } } },
            todos: { $: { where: { id: ctx.aliceTodoId } } },
            labels: { $: { where: { id: ctx.aliceLabelId } } },
            taskCompletions: {
              $: { where: { id: ctx.aliceCompletionId } },
            },
          }),
        );

        yield* Effect.sync(() => {
          expect(result.$users).toHaveLength(0);
          expect(result.googleAccounts).toHaveLength(0);
          expect(result.googleCredentials).toHaveLength(0);
          expect(result.calendars).toHaveLength(0);
          expect(result.calendarEvents).toHaveLength(0);
          expect(result.calendarPreferences).toHaveLength(0);
          expect(result.todoLists).toHaveLength(0);
          expect(result.todos).toHaveLength(0);
          expect(result.labels).toHaveLength(0);
          expect(result.taskCompletions).toHaveLength(0);
        });
      }),
    );
  });

  test("allows owned updates and label unlinking while rejecting Bob's mutations", () => {
    const ctx = context();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("Alice updates owned records", () =>
          ctx.alice.transact([
            ctx.alice.tx.todoLists[ctx.aliceListId].update({
              name: "Alice updated list",
              updatedAt: now,
            }),
            ctx.alice.tx.todos[ctx.aliceTodoId].update({
              title: "Alice updated todo",
              updatedAt: now,
            }),
            ctx.alice.tx.labels[ctx.aliceLabelId].update({
              name: "Alice updated label",
              updatedAt: now,
            }),
            ctx.alice.tx.taskCompletions[ctx.aliceCompletionId].update({
              completedAt: now,
            }),
            ctx.alice.tx.calendarPreferences[ctx.alicePreferenceId].update({
              visible: false,
              updatedAt: now,
            }),
          ]),
        );

        yield* fromPromise("Alice unlinks and relinks a label", () =>
          ctx.alice.transact([
            ctx.alice.tx.todos[ctx.aliceTodoId].unlink({
              labels: ctx.aliceLabelId,
            }),
            ctx.alice.tx.todos[ctx.aliceTodoId].link({
              labels: ctx.aliceLabelId,
            }),
          ]),
        );

        yield* expectDenied("Bob updates Alice's todo", () =>
          ctx.bob.transact(
            ctx.bob.tx.todos[ctx.aliceTodoId].update({ title: "Stolen" }),
          ),
        );
        yield* expectDenied("Bob deletes Alice's todo", () =>
          ctx.bob.transact(ctx.bob.tx.todos[ctx.aliceTodoId].delete()),
        );
        yield* expectDenied("Bob unlinks Alice's label", () =>
          ctx.bob.transact(
            ctx.bob.tx.todos[ctx.aliceTodoId].unlink({ labels: ctx.aliceLabelId }),
          ),
        );
        yield* expectDenied("Alice unlinks todo ownership", () =>
          ctx.alice.transact(
            ctx.alice.tx.todos[ctx.aliceTodoId].unlink({ user: ctx.aliceId }),
          ),
        );
        yield* expectDenied("Alice unlinks a required todo list", () =>
          ctx.alice.transact(
            ctx.alice.tx.todos[ctx.aliceTodoId].unlink({
              todoList: ctx.aliceListId,
            }),
          ),
        );
        yield* expectDenied("Alice unlinks completion identity", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[ctx.aliceCompletionId].unlink({
              todo: ctx.aliceTodoId,
            }),
          ),
        );
        yield* expectDenied("Alice unlinks preference identity", () =>
          ctx.alice.transact(
            ctx.alice.tx.calendarPreferences[ctx.alicePreferenceId].unlink({
              calendar: ctx.aliceCalendarId,
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
          ctx.alice.transact(
            ctx.alice.tx.todoLists[ownerlessListId].update(listFields("Ownerless")),
          ),
        );
        yield* expectDenied("Alice creates Bob-owned list", () =>
          ctx.alice.transact(
            ctx.alice.tx.todoLists[spoofedListId]
              .update(listFields("Spoofed list"))
              .link({ user: ctx.bobId }),
          ),
        );
        yield* expectDenied("Alice creates Bob-owned todo", () =>
          ctx.alice.transact(
            ctx.alice.tx.todos[spoofedTodoId]
              .update(todoFields("Spoofed todo"))
              .link({ user: ctx.bobId, todoList: ctx.bobListId }),
          ),
        );
        yield* expectDenied("Alice creates Bob-owned preference", () =>
          ctx.alice.transact(
            ctx.alice.tx.calendarPreferences[spoofedPreferenceId]
              .update({
                preferenceKey: `${ctx.bobId}:${ctx.aliceCalendarId}`,
                visible: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              })
              .link({ user: ctx.bobId, calendar: ctx.aliceCalendarId }),
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
        const result = yield* fromPromise("Alice queries provider data", () =>
          ctx.alice.query({
            googleAccounts: {
              $: { where: { id: ctx.aliceGoogleAccountId } },
            },
            calendarEvents: {
              $: { where: { id: ctx.aliceCalendarEventId } },
            },
            googleCredentials: {
              $: { where: { id: ctx.aliceGoogleCredentialId } },
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.googleAccounts).toHaveLength(1);
          expect(result.calendarEvents).toHaveLength(1);
          expect(result.googleCredentials).toHaveLength(0);
        });

        yield* expectDenied("client updates Google account", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleAccounts[ctx.aliceGoogleAccountId].update({
              displayName: "Tampered",
            }),
          ),
        );
        yield* expectDenied("client deletes Google account", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleAccounts[ctx.aliceGoogleAccountId].delete(),
          ),
        );
        yield* expectDenied("client creates Google account", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleAccounts[newAccountId]
              .update({
                providerAccountId: "client-created-account",
                email: "client@chronos.test",
                connectedAt: now,
                updatedAt: now,
              })
              .link({ user: ctx.aliceId }),
          ),
        );
        yield* expectDenied("client updates calendar event", () =>
          ctx.alice.transact(
            ctx.alice.tx.calendarEvents[ctx.aliceCalendarEventId].update({
              summary: "Tampered",
            }),
          ),
        );
        yield* expectDenied("client creates calendar event", () =>
          ctx.alice.transact(
            ctx.alice.tx.calendarEvents[newEventId]
              .update(eventFields(ctx.aliceGoogleAccountId, "primary", "client-event"))
              .link({ calendar: ctx.aliceCalendarId, user: ctx.aliceId }),
          ),
        );
        yield* expectDenied("client creates Google credential", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleCredentials[newCredentialId]
              .update({
                encryptedRefreshToken: "not-allowed",
                encryptionKeyVersion: 1,
                createdAt: now,
                updatedAt: now,
              })
              .link({ googleAccount: ctx.aliceGoogleAccountId }),
          ),
        );
        yield* expectDenied("client updates Google credential", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleCredentials[ctx.aliceGoogleCredentialId].update({
              encryptionKeyVersion: 2,
            }),
          ),
        );
        yield* expectDenied("client deletes Google credential", () =>
          ctx.alice.transact(
            ctx.alice.tx.googleCredentials[ctx.aliceGoogleCredentialId].delete(),
          ),
        );
      }),
    );
  });

  test("keeps files and streams inaccessible to clients", () => {
    const ctx = context();
    const newStreamId = id();

    return run(
      Effect.gen(function* () {
        const result = yield* fromPromise("query denied storage namespaces", () =>
          ctx.alice.query({
            $files: { $: { where: { id: ctx.fileId } } },
            $streams: {},
          }),
        );
        yield* Effect.sync(() => {
          expect(result.$files).toHaveLength(0);
          expect(result.$streams).toHaveLength(0);
        });

        yield* expectDenied("client updates file metadata", () =>
          ctx.alice.transact(
            ctx.alice.tx.$files[ctx.fileId].update({
              path: "security/renamed.txt",
            }),
          ),
        );
        yield* expectDenied("client deletes file metadata", () =>
          ctx.alice.transact(ctx.alice.tx.$files[ctx.fileId].delete()),
        );
        yield* expectDenied("client creates stream metadata", () =>
          ctx.alice.transact(
            ctx.alice.tx.$streams[newStreamId].update({ clientId: "client-stream" }),
          ),
        );
        yield* expectDenied("client uploads storage file", () =>
          ctx.alice.storage.uploadFile(
            "security/upload.txt",
            new TextEncoder().encode("denied"),
            { contentType: "text/plain" },
          ),
        );
      }),
    );
  });

  test("denies unauthenticated reads and writes", () => {
    const ctx = context();
    const guestStreamId = id();

    return run(
      Effect.gen(function* () {
        const result = yield* fromPromise("guest queries protected data", () =>
          ctx.guest.query({
            todos: { $: { where: { id: ctx.aliceTodoId } } },
            googleAccounts: {
              $: { where: { id: ctx.aliceGoogleAccountId } },
            },
            $files: { $: { where: { id: ctx.fileId } } },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.todos).toHaveLength(0);
          expect(result.googleAccounts).toHaveLength(0);
          expect(result.$files).toHaveLength(0);
        });

        yield* expectDenied("guest creates stream metadata", () =>
          ctx.guest.transact(
            ctx.guest.tx.$streams[guestStreamId].update({ clientId: "guest-stream" }),
          ),
        );
        yield* expectDenied("guest updates Alice's todo", () =>
          ctx.guest.transact(
            ctx.guest.tx.todos[ctx.aliceTodoId].update({ title: "Guest edit" }),
          ),
        );
      }),
    );
  });

  test("rejects invalid, cross-user, and mutable completion identities", () => {
    const ctx = context();
    const invalidCompletionId = id();
    const crossUserCompletionId = id();
    const bobSpoofedCompletionId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* expectDenied("invalid completion key", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[invalidCompletionId]
              .update({
                occurrenceKey: `wrong:${ctx.aliceTodoId}:2026-08-17`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.aliceId, todo: ctx.aliceTodoId }),
          ),
        );
        yield* expectDenied("Alice completes Bob's todo", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[crossUserCompletionId]
              .update({
                occurrenceKey: `${ctx.aliceId}:${ctx.bobTodoId}:2026-08-17`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.aliceId, todo: ctx.bobTodoId }),
          ),
        );
        yield* expectDenied("Bob squats on Alice's completion key", () =>
          ctx.bob.transact(
            ctx.bob.tx.taskCompletions[bobSpoofedCompletionId]
              .update({
                occurrenceKey: `${ctx.aliceId}:${ctx.bobTodoId}:2026-08-18`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.bobId, todo: ctx.bobTodoId }),
          ),
        );
        yield* expectDenied("change completion occurrence key", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[ctx.aliceCompletionId].update({
              occurrenceKey: `${ctx.aliceId}:${ctx.aliceTodoId}:changed`,
            }),
          ),
        );
        yield* expectDenied("change completion occurrence time", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[ctx.aliceCompletionId].update({
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
    const firstPreferenceId = id();
    const secondPreferenceId = id();
    const preferenceKey = `${ctx.aliceId}:${ctx.aliceSecondaryCalendarId}`;
    const now = Date.now();

    const createPreference = (preferenceId: string) =>
      fromPromise(`create concurrent preference ${preferenceId}`, () =>
        ctx.alice.transact(
          ctx.alice.tx.calendarPreferences[preferenceId]
            .update({
              preferenceKey,
              visible: true,
              isDefault: false,
              createdAt: now,
              updatedAt: now,
            })
            .link({ user: ctx.aliceId, calendar: ctx.aliceSecondaryCalendarId }),
        ),
      );

    return run(
      Effect.gen(function* () {
        yield* expectDenied("duplicate completion occurrence key", () =>
          ctx.alice.transact(
            ctx.alice.tx.taskCompletions[duplicateCompletionId]
              .update({
                occurrenceKey: ctx.aliceCompletionKey,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: ctx.aliceId, todo: ctx.aliceTodoId }),
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
          ctx.alice.query({
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

  test("allows owners to delete their client-owned records", () => {
    const ctx = context();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("delete Alice's owned records", () =>
          ctx.alice.transact([
            ctx.alice.tx.taskCompletions[ctx.aliceCompletionId].delete(),
            ctx.alice.tx.calendarPreferences[ctx.alicePreferenceId].delete(),
            ctx.alice.tx.todos[ctx.aliceTodoId].delete(),
            ctx.alice.tx.labels[ctx.aliceLabelId].delete(),
            ctx.alice.tx.todoLists[ctx.aliceListId].delete(),
          ]),
        );

        const result = yield* fromPromise("verify owned records were deleted", () =>
          ctx.alice.query({
            taskCompletions: {
              $: { where: { id: ctx.aliceCompletionId } },
            },
            calendarPreferences: {
              $: { where: { id: ctx.alicePreferenceId } },
            },
            todos: { $: { where: { id: ctx.aliceTodoId } } },
            labels: { $: { where: { id: ctx.aliceLabelId } } },
            todoLists: { $: { where: { id: ctx.aliceListId } } },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.taskCompletions).toHaveLength(0);
          expect(result.calendarPreferences).toHaveLength(0);
          expect(result.todos).toHaveLength(0);
          expect(result.labels).toHaveLength(0);
          expect(result.todoLists).toHaveLength(0);
        });
      }),
    );
  });
});
