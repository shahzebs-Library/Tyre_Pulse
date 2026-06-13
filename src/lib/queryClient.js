import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,        // 2 min — data stays fresh
      gcTime: 10 * 60 * 1000,           // 10 min — keep unused cache
      retry: 2,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
})
