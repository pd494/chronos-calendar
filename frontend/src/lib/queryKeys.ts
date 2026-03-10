export const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  detail: (calendarId: string, id: string) =>
    [...eventKeys.all, 'detail', calendarId, id] as const,
}

export const googleKeys = {
  all: ['google'] as const,
  accounts: () => [...googleKeys.all, 'accounts'] as const,
  calendars: () => [...googleKeys.all, 'calendars'] as const,
}

export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (listId?: string) => [...todoKeys.lists(), listId] as const,
  detail: (id: string) => [...todoKeys.all, 'detail', id] as const,
}

export const listKeys = {
  all: ['todoLists'] as const,
}
