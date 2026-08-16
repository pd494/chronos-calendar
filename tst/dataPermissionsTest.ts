import { init, id } from "@instantdb/admin";
import { PlatformApi } from "@instantdb/platform";
import { Effect, Either } from "effect";
import { beforeAll, describe, expect, test } from "vitest";

import permissions from "../instant.perms.js";
import schema from "../instant.schema.js";

const createAdminDatabase = (appId: string, adminToken: string) =>
  init({ appId, adminToken, schema });

type AdminDatabase = ReturnType<typeof createAdminDatabase>;
type UserDatabase = ReturnType<AdminDatabase["asUser"]>;

interface TestContext {
  readonly alice: UserDatabase;
  readonly aliceCalendarId: string;
  readonly aliceId: string;
  readonly bob: UserDatabase;
  readonly bobId: string;
}

let testContext: TestContext | undefined;

const fromPromise = <A>(label: string, evaluate: () => Promise<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`),
  });

const run = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(program);

const context = () => {
  if (!testContext) {
    throw new Error("Permission test context has not been initialized");
  }
  return testContext;
};

const expectDenied = <A>(label: string, evaluate: () => Promise<A>) =>
  Effect.gen(function* () {
    const result = yield* Effect.either(fromPromise(label, evaluate));
    yield* Effect.sync(() => expect(Either.isLeft(result)).toBe(true));
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

const setup = Effect.gen(function* () {
  const temporaryApi = new PlatformApi({});
  const { app } = yield* fromPromise("create temporary Instant app", () =>
    temporaryApi.createTemporaryApp({
      title: `chronos-permissions-${Date.now()}`,
      schema,
      rules: { code: permissions },
    }),
  );

  const admin = createAdminDatabase(app.id, app.adminToken);
  const aliceToken = yield* fromPromise("create Alice", () =>
    admin.auth.createToken({ email: "alice@chronos.test" }),
  );
  const bobToken = yield* fromPromise("create Bob", () =>
    admin.auth.createToken({ email: "bob@chronos.test" }),
  );
  const aliceUser = yield* fromPromise("resolve Alice", () =>
    admin.auth.verifyToken(aliceToken),
  );
  const bobUser = yield* fromPromise("resolve Bob", () =>
    admin.auth.verifyToken(bobToken),
  );

  const googleAccountId = id();
  const aliceCalendarId = id();
  const now = Date.now();
  yield* fromPromise("seed Alice's synced calendar", () =>
    admin.transact([
      admin.tx.googleAccounts[googleAccountId]
        .update({
          providerAccountId: "alice-google-account",
          email: "alice@chronos.test",
          connectedAt: now,
          updatedAt: now,
        })
        .link({ user: aliceUser.id }),
      admin.tx.calendars[aliceCalendarId]
        .update({
          accountCalendarKey: `${googleAccountId}:primary`,
          googleCalendarId: "primary",
          summary: "Alice's calendar",
          accessRole: "owner",
          isPrimary: true,
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
        })
        .link({ googleAccount: googleAccountId, user: aliceUser.id }),
    ]),
  );

  return {
    alice: admin.asUser({ token: aliceToken }),
    aliceCalendarId,
    aliceId: aliceUser.id,
    bob: admin.asUser({ token: bobToken }),
    bobId: bobUser.id,
  } satisfies TestContext;
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
  test("creates a list, label, and first todo atomically", () => {
    const { alice, aliceId } = context();
    const listId = id();
    const labelId = id();
    const todoId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("create task graph", () =>
          alice.transact([
            alice.tx.todoLists[listId]
              .update(listFields("Inbox"))
              .link({ user: aliceId }),
            alice.tx.labels[labelId]
              .update({
                name: "Important",
                color: "#DC2626",
                createdAt: now,
                updatedAt: now,
              })
              .link({ user: aliceId }),
            alice.tx.todos[todoId]
              .update(todoFields("Plan the week"))
              .link({ user: aliceId, todoList: listId, labels: labelId }),
          ]),
        );

        const result = yield* fromPromise("query created task graph", () =>
          alice.query({
            todos: {
              $: { where: { id: todoId } },
              todoList: {},
              labels: {},
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.todos).toHaveLength(1);
          expect(result.todos[0]?.todoList?.id).toBe(listId);
          expect(result.todos[0]?.labels.map((label) => label.id)).toContain(labelId);
        });
      }),
    );
  });

  test("creates a completion alongside a newly created todo", () => {
    const { alice, aliceId } = context();
    const listId = id();
    const todoId = id();
    const completionId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("create todo and completion", () =>
          alice.transact([
            alice.tx.todoLists[listId]
              .update(listFields("Today"))
              .link({ user: aliceId }),
            alice.tx.todos[todoId]
              .update(todoFields("Morning review"))
              .link({ user: aliceId, todoList: listId }),
            alice.tx.taskCompletions[completionId]
              .update({
                occurrenceKey: `${aliceId}:${todoId}:2026-08-15`,
                occurrenceAt: now,
                completedAt: now,
                createdAt: now,
              })
              .link({ user: aliceId, todo: todoId }),
          ]),
        );

        const result = yield* fromPromise("query task completion", () =>
          alice.query({
            taskCompletions: {
              $: { where: { id: completionId } },
              todo: {},
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.taskCompletions).toHaveLength(1);
          expect(result.taskCompletions[0]?.todo?.id).toBe(todoId);
        });
      }),
    );
  });

  test("saves preferences for an owned synced calendar", () => {
    const { alice, aliceCalendarId, aliceId } = context();
    const preferenceId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        const transaction = alice.tx.calendarPreferences[preferenceId]
          .update({
            preferenceKey: `${aliceId}:${aliceCalendarId}`,
            visible: false,
            isDefault: true,
            colorOverride: "#7C3AED",
            createdAt: now,
            updatedAt: now,
          })
          .link({ user: aliceId, calendar: aliceCalendarId });
        yield* fromPromise("create calendar preference", () =>
          alice.transact(transaction),
        );

        const result = yield* fromPromise("query calendar preference", () =>
          alice.query({
            calendarPreferences: {
              $: { where: { id: preferenceId } },
              calendar: {},
            },
          }),
        );
        yield* Effect.sync(() => {
          expect(result.calendarPreferences).toHaveLength(1);
          expect(result.calendarPreferences[0]?.calendar?.id).toBe(aliceCalendarId);
        });
      }),
    );
  });

  test("prevents Bob from moving Alice's todo into Bob's list", () => {
    const { alice, aliceId, bob, bobId } = context();
    const aliceListId = id();
    const aliceTodoId = id();
    const bobListId = id();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("create Alice's todo", () =>
          alice.transact([
            alice.tx.todoLists[aliceListId]
              .update(listFields("Alice list"))
              .link({ user: aliceId }),
            alice.tx.todos[aliceTodoId]
              .update(todoFields("Alice private task"))
              .link({ user: aliceId, todoList: aliceListId }),
          ]),
        );
        yield* fromPromise("create Bob's list", () =>
          bob.transact(
            bob.tx.todoLists[bobListId]
              .update(listFields("Bob list"))
              .link({ user: bobId }),
          ),
        );

        yield* expectDenied("Bob moves Alice's todo", () =>
          bob.transact(bob.tx.todos[aliceTodoId].link({ todoList: bobListId })),
        );

        const result = yield* fromPromise("verify Alice's todo list", () =>
          alice.query({
            todos: {
              $: { where: { id: aliceTodoId } },
              todoList: {},
            },
          }),
        );
        yield* Effect.sync(() =>
          expect(result.todos[0]?.todoList?.id).toBe(aliceListId),
        );
      }),
    );
  });

  test("rejects invalid preference keys and client calendar writes", () => {
    const { alice, aliceCalendarId, aliceId } = context();
    const preferenceId = id();
    const now = Date.now();

    return run(
      Effect.gen(function* () {
        yield* expectDenied("create invalid preference key", () =>
          alice.transact(
            alice.tx.calendarPreferences[preferenceId]
              .update({
                preferenceKey: `wrong:${aliceCalendarId}`,
                visible: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              })
              .link({ user: aliceId, calendar: aliceCalendarId }),
          ),
        );

        yield* expectDenied("client updates synced calendar", () =>
          alice.transact(
            alice.tx.calendars[aliceCalendarId].update({ summary: "Tampered" }),
          ),
        );
      }),
    );
  });

  test("allows safe profile fields and rejects user-to-user links", () => {
    const { alice, aliceId, bobId } = context();

    return run(
      Effect.gen(function* () {
        yield* fromPromise("update safe profile fields", () =>
          alice.transact(
            alice.tx.$users[aliceId].update({
              name: "Alice",
              timeZone: "America/Los_Angeles",
            }),
          ),
        );

        yield* expectDenied("update auth-managed profile image", () =>
          alice.transact(
            alice.tx.$users[aliceId].update({
              imageURL: "https://example.com/alice.png",
            }),
          ),
        );

        yield* expectDenied("link unrelated users", () =>
          alice.transact(
            alice.tx.$users[aliceId].link({ linkedPrimaryUser: bobId }),
          ),
        );
      }),
    );
  });
});
