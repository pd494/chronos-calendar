import { QueryClient } from '@tanstack/react-query'
import { get, set, del } from 'idb-keyval'
import { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

export const createIDBPersister = (idbValidKey: IDBValidKey = 'chronos-query-cache'): Persister => ({
  persistClient: async (client: PersistedClient) => {
    await set(idbValidKey, client)
  },
  restoreClient: async () => {
    return await get<PersistedClient>(idbValidKey)
  },
  removeClient: async () => {
    await del(idbValidKey)
  },
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours (formerly cacheTime)
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export const persister = createIDBPersister()
