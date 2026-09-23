import { QueryClient } from '@tanstack/react-query';

// Module-level so non-React code (sign-out) can clear per-user cached data.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 2,
    },
  },
});
