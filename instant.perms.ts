// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const ownerRules = {
  allow: {
    view: "isOwner",
    // Every client-owned entity has a required `user` link. The link rule below
    // makes that user the authenticated user before creation can succeed.
    create: "auth.id != null",
    update: "isOwner",
    delete: "isOwner",
    link: {
      // Permit the required owner link while creating a record, but never let a
      // signed-in user claim a record that already belongs to someone else.
      user:
        "auth.id != null && linkedData.id == auth.id && (isOwner || size(data.ref('user.id')) == 0)",
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
      todoList:
        "isOwner && linkedData.id in auth.ref('$user.todoLists.id')",
      labels: "isOwner && linkedData.id in auth.ref('$user.labels.id')",
      completions:
        "isOwner && linkedData.id in auth.ref('$user.taskCompletions.id')",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      todoList:
        "isOwner && linkedData.id in auth.ref('$user.todoLists.id')",
      labels: "isOwner && linkedData.id in auth.ref('$user.labels.id')",
      completions:
        "isOwner && linkedData.id in auth.ref('$user.taskCompletions.id')",
    },
  },
} as const;

const todoListRules = {
  ...ownerRules,
  allow: {
    ...ownerRules.allow,
    link: {
      ...ownerRules.allow.link,
      todos: "isOwner && linkedData.id in auth.ref('$user.todos.id')",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      todos: "isOwner && linkedData.id in auth.ref('$user.todos.id')",
    },
  },
} as const;

const labelRules = {
  ...ownerRules,
  allow: {
    ...ownerRules.allow,
    link: {
      ...ownerRules.allow.link,
      todos: "isOwner && linkedData.id in auth.ref('$user.todos.id')",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      todos: "isOwner && linkedData.id in auth.ref('$user.todos.id')",
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
        "isOwner && linkedData.id in auth.ref('$user.todos.id') && newData.occurrenceKey.startsWith(auth.id + ':' + linkedData.id + ':')",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      todo: "isOwner && linkedData.id in auth.ref('$user.todos.id')",
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
        "isOwner && linkedData.id in auth.ref('$user.calendars.id') && newData.preferenceKey == auth.id + ':' + linkedData.id",
    },
    unlink: {
      ...ownerRules.allow.unlink,
      calendar:
        "isOwner && linkedData.id in auth.ref('$user.calendars.id')",
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
  todoLists: todoListRules,
  todos: todoRules,
  labels: labelRules,
  taskCompletions: taskCompletionRules,

  // Privileged namespaces deliberately inherit the global deny rule:
  // googleCredentials, $files, and $streams. Storage stays disabled until
  // avatars or attachments are explicitly added to product scope.
} satisfies InstantRules;

export default rules;
