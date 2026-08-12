// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const ownerRules = {
  allow: {
    view: "isOwner",
    create: "isOwner",
    update: "isOwner && isStillOwner",
    delete: "isOwner",
  },
  bind: {
    isOwner: "auth.id != null && auth.id == data.ownerId",
    isStillOwner: "auth.id != null && auth.id == newData.ownerId",
  },
} as const;

const serverManagedOwnerRules = {
  allow: {
    view: "isOwner",
    create: "false",
    update: "false",
    delete: "false",
  },
  bind: {
    isOwner: "auth.id != null && auth.id == data.ownerId",
  },
} as const;

const rules = {
  // Instant allows missing rules by default. Keep the global boundary closed and
  // opt each client-visible namespace in explicitly below.
  $default: {
    allow: {
      $default: "false",
    },
  },
  attrs: {
    allow: {
      $default: "false",
    },
  },
  $users: {
    allow: {
      view: "auth.id != null && auth.id == data.id",
      create: "false",
      update:
        "auth.id != null && auth.id == data.id && request.modifiedFields.all(field, field in ['name', 'imageURL', 'timeZone'])",
      delete: "false",
    },
    fields: {
      email: "auth.id != null && auth.id == data.id",
    },
  },

  // Provider-backed read models are visible to their owner but writable only
  // through the Admin SDK in the Worker.
  googleAccounts: serverManagedOwnerRules,
  calendars: serverManagedOwnerRules,
  calendarEvents: serverManagedOwnerRules,

  // User preferences and task data are local-first client-owned records.
  calendarPreferences: ownerRules,
  todoLists: ownerRules,
  todos: ownerRules,
  labels: ownerRules,
  taskCompletions: ownerRules,

  // Privileged namespaces deliberately inherit the global deny rule:
  // googleCredentials.
} satisfies InstantRules;

export default rules;
