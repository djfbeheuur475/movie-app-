import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiKeysStore } from '../store/apiKeysStore';
import { useAuthStore } from '../store/authStore';
import { traktApi, TraktUnauthorizedError, effectiveTraktClientId } from '../lib/trakt';
import { loadTraktHistory, saveTraktHistory, slimHistory, type TraktHistory } from '../lib/traktHistoryCache';

/**
 * The one source of Trakt watch history for the whole app.
 *
 * Serves the cached copy (device, then cloud) immediately, refreshes it live
 * from Trakt whenever a token is available, and keeps serving the last-known
 * history if Trakt disconnects — so recommendations never fall back to
 * "brand-new user" just because a token lapsed.
 */
export function useTraktHistory() {
  const { traktClientId, traktAccessToken, handleTraktUnauthorized } = useApiKeysStore();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const authLoaded = useAuthStore((s) => s.isLoaded);
  const queryClient = useQueryClient();

  const owner = userId ?? 'guest';
  const clientId = effectiveTraktClientId(traktClientId);
  const hasTrakt = !!traktAccessToken;

  const cached = useQuery({
    queryKey: ['trakt-history-cache', owner],
    queryFn: () => loadTraktHistory(owner, userId),
    enabled: authLoaded,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const live = useQuery({
    queryKey: ['trakt-history-live', owner, clientId, traktAccessToken],
    queryFn: async (): Promise<TraktHistory> => {
      const [movies, shows] = await Promise.all([
        traktApi.getWatchedMovies(clientId, traktAccessToken),
        traktApi.getWatchedShows(clientId, traktAccessToken),
      ]);
      const history: TraktHistory = { ...slimHistory(movies, shows), syncedAt: Date.now() };
      queryClient.setQueryData(['trakt-history-cache', owner], history);
      saveTraktHistory(owner, userId, history).catch(() => {});
      return history;
    },
    enabled: hasTrakt && authLoaded,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: (count, err) => !(err instanceof TraktUnauthorizedError) && count < 2,
  });

  // Expired token: refresh (single-flight in the store). The new token changes
  // the live query key, so it refetches on its own — and the cached history
  // keeps everything populated in the meantime.
  useEffect(() => {
    if (live.error instanceof TraktUnauthorizedError) handleTraktUnauthorized();
  }, [live.error, handleTraktUnauthorized]);

  const history = live.data ?? cached.data ?? null;

  return {
    movies: history?.movies,
    shows: history?.shows,
    hasHistory: !!history && (history.movies.length > 0 || history.shows.length > 0),
    /** Settled enough to build recommendations: live data, a cached copy, or nothing is coming. */
    isReady: live.isFetched || (cached.isFetched && (!!cached.data || !hasTrakt)),
    /** True when showing the saved copy because Trakt isn't currently connected/reachable. */
    isFromCache: !live.data && !!cached.data,
    syncedAt: history?.syncedAt ?? null,
  };
}
