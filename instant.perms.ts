// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const ownerRules = {
  allow: {
    view: "isOwner",
    create: "isOwner",
    update: "isOwner",
    delete: "isOwner",
    link: {
      user: "auth.id != null && linkedData.id == auth.id",
    },
    unlink: {
      user: "auth.id != null && linkedData.id == auth.id",
    },
  },
  bind: {
    isOwner: "auth.id != null && auth.id in data.ref('user.id')",
  },
} as const;

const calendarPreferenceRules = {
  allow: {
    ...ownerRules.allow,
    create: "isOwner && hasValidPreferenceKey",
    update: "isOwner && hasValidUpdatedPreferenceKey",
    link: {
      ...ownerRules.allow.link,
      calendar:
        "auth.id != null && linkedData.id in auth.ref('$user.calendars.id') && newData.preferenceKey == auth.id + ':' + linkedData.id",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      calendar:
        "auth.id != null && linkedData.id in auth.ref('$user.calendars.id')",
    },
  },
  bind: {
    ...ownerRules.bind,
    hasValidPreferenceKey:
      "data.preferenceKey == auth.id + ':' + data.ref('calendar.id')[0]",
    hasValidUpdatedPreferenceKey:
      "newData.preferenceKey == auth.id + ':' + data.ref('calendar.id')[0]",
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
    isOwner: "auth.id != null && auth.id in data.ref('user.id')",
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
      create:
        "auth.id != null && auth.id == data.id && request.modifiedFields.all(field, field in ['email', 'name', 'imageURL', 'timeZone'])",
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
  calendarPreferences: calendarPreferenceRules,
  todoLists: ownerRules,
  todos: ownerRules,
  labels: ownerRules,
  taskCompletions: ownerRules,

  // Privileged namespaces deliberately inherit the global deny rule:
  // googleCredentials, $files, and $streams. Storage stays disabled until
  // avatars or attachments are explicitly added to product scope.
} satisfies InstantRules;

export default rules;
