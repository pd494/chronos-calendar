// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const ownerRules = {
  allow: {
    view: "isOwner",
    // Instant includes same-transaction links in `data` during create checks,
    // so every client-owned record must already link to its authenticated owner.
    create: "isOwner",
    update: "isOwner",
    delete: "isOwner",
    link: {
      // Create/link checks see the completed transaction, so a new record must
      // already resolve as owned. Existing ownerless records cannot be claimed.
      user: "isOwner && linkedData.id == auth.id",
    },
    unlink: {
      // Ownership is immutable for client-owned records.
      user: "false",
    },
  },
  bind: {
    isOwner: "auth.id != null && auth.id in data.ref('user.id')",
  },
} as const;

const todoRules = {
  ...ownerRules,
  allow: {
    ...ownerRules.allow,
    link: {
      ...ownerRules.allow.link,
      // `actions.linkedData` is Instant's link-rule lifecycle binding. It lets
      // a transaction create a list/label and its first todo atomically.
      todoList:
        "isOwner && (actions.linkedData == 'create' || linkedData.id in auth.ref('$user.todoLists.id'))",
      labels:
        "isOwner && (actions.linkedData == 'create' || linkedData.id in auth.ref('$user.labels.id'))",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      todoList:
        "isOwner && linkedData.id in auth.ref('$user.todoLists.id')",
      labels: "isOwner && linkedData.id in auth.ref('$user.labels.id')",
    },
  },
} as const;

const taskCompletionRules = {
  ...ownerRules,
  allow: {
    ...ownerRules.allow,
    create: "isOwner && hasValidOccurrenceKey",
    update: "isOwner && keepsOccurrenceIdentity",
    link: {
      ...ownerRules.allow.link,
      todo:
        "isOwner && linkedData.id in auth.ref('$user.todos.id') && data.occurrenceKey.startsWith(auth.id + ':' + linkedData.id + ':')",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      // A completion's identity is permanently tied to its required todo.
      todo: "false",
    },
  },
  bind: {
    ...ownerRules.bind,
    hasValidOccurrenceKey:
      "size(data.ref('todo.id')) == 1 && data.occurrenceKey.startsWith(auth.id + ':' + data.ref('todo.id')[0] + ':')",
    keepsOccurrenceIdentity:
      "newData.occurrenceKey == data.occurrenceKey && newData.occurrenceAt == data.occurrenceAt",
  },
} as const;

const calendarPreferenceRules = {
  allow: {
    ...ownerRules.allow,
    create: "isOwner && hasValidPreferenceKey",
    update: "isOwner && keepsPreferenceKey",
    link: {
      ...ownerRules.allow.link,
      calendar:
        "isOwner && linkedData.id in auth.ref('$user.calendars.id') && data.preferenceKey == auth.id + ':' + linkedData.id",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      // A preference's unique key is permanently tied to its required calendar.
      calendar: "false",
    },
  },
  bind: {
    ...ownerRules.bind,
    hasValidPreferenceKey:
      "size(data.ref('calendar.id')) == 1 && data.preferenceKey == auth.id + ':' + data.ref('calendar.id')[0]",
    keepsPreferenceKey: "newData.preferenceKey == data.preferenceKey",
  },
} as const;

const serverManagedOwnerRules = {
  allow: {
    view: "isOwner",
    create: "false",
    update: "false",
    delete: "false",
    link: {
      $default: "false",
    },
    unlink: {
      $default: "false",
    },
  },
  bind: {
    isOwner: "auth.id != null && auth.id in data.ref('user.id')",
  },
} as const;

const calendarRules = {
  ...serverManagedOwnerRules,
  allow: {
    ...serverManagedOwnerRules.allow,
    link: {
      ...serverManagedOwnerRules.allow.link,
      // This is the sole client-writable relationship on a synced calendar.
      preferences:
        "data.user == auth.id && linkedData.preferenceKey == auth.id + ':' + data.id",
    },
    unlink: {
      ...serverManagedOwnerRules.allow.unlink,
      preferences: "false",
    },
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
      // This rule runs only during Instant's auth signup flow. `email` is
      // provider-managed and is included among the newly created user fields.
      create:
        "auth.id != null && auth.id == data.id && request.modifiedFields.all(field, field in ['email', 'name', 'imageURL', 'timeZone'])",
      update:
        "auth.id != null && auth.id == data.id && request.modifiedFields.all(field, field in ['name', 'timeZone'])",
      delete: "false",
      link: {
        linkedPrimaryUser: "false",
        linkedGuestUsers: "false",
      },
      unlink: {
        linkedPrimaryUser: "false",
        linkedGuestUsers: "false",
      },
    },
    fields: {
      email: "auth.id != null && auth.id == data.id",
    },
  },

  // Provider-backed read models are visible to their owner but writable only
  // through the Admin SDK in the Worker.
  googleAccounts: serverManagedOwnerRules,
  calendars: calendarRules,
  calendarEvents: serverManagedOwnerRules,

  // User preferences and task data are local-first client-owned records.
  calendarPreferences: calendarPreferenceRules,
  todoLists: ownerRules,
  todos: todoRules,
  labels: ownerRules,
  taskCompletions: taskCompletionRules,

  // Privileged namespaces deliberately inherit the global deny rule:
  // googleCredentials, $files, and $streams. Storage stays disabled until
  // avatars or attachments are explicitly added to product scope.
} satisfies InstantRules;

export default rules;
