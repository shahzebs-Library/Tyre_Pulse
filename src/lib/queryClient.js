import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,        // 2 min — data stays fresh
      gcTime: 10 * 60 * 1000,           // 10 min — keep unused cache
      retry: 2,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 10000),
      // Don't reload everything just because the user switched tabs and came
      // back — it reads as the page "refreshing on its own". Realtime
      // subscriptions keep data live, and staleTime covers normal navigation.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
})
