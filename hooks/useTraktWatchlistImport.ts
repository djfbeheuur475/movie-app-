import { useQuery } from '@tanstack/react-query';
import { useApiKeysStore } from '../store/apiKeysStore';
import { useAuthStore } from '../store/authStore';
import { effectiveTraktClientId } from '../lib/trakt';
import { importTraktWatchlist } from '../lib/traktWatchlistImport';

/** Mount once (tab layout): pulls new Trakt watchlist entries into NextUp. */
export function useTraktWatchlistImport() {
  const { traktClientId, traktAccessToken } = useApiKeysStore();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const authLoaded = useAuthStore((s) => s.isLoaded);
  const clientId = effectiveTraktClientId(traktClientId);

  useQuery({
    queryKey: ['trakt-watchlist-import', userId ?? 'guest', clientId, traktAccessToken],
    queryFn: () => importTraktWatchlist(clientId, traktAccessToken, userId ?? 'guest', userId),
    enabled: !!traktAccessToken && authLoaded,
    staleTime: 1000 * 60 * 30,
    retry: false,
  });
}
