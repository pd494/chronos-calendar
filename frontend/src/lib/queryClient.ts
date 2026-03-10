import { QueryClient } from '@tanstack/react-query'
import { get, set, del } from 'idb-keyval'
import { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

const idbValidKey = 'chronos-query-cache'

export const persister: Persister = {
  persistClient: async (client: PersistedClient) => {
    await set(idbValidKey, client)
  },
  restoreClient: async () => {
    return await get<PersistedClient>(idbValidKey)
  },
  removeClient: async () => {
    await del(idbValidKey)
  },
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 1000 * 60 * 60 * 24,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})
