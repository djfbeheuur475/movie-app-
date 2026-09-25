import { useQuery } from '@tanstack/react-query';
import { compactHistory, fetchForYou, loadTasteProfile } from '../lib/taste';
import { getTemporalContext } from '../lib/tasteDna';
import type { TraktWatchedMovie, TraktWatchedShow } from '../lib/trakt';

/**
 * The viewer's stored taste profile and today's "For You" rows. Shared by the
 * Home screen (hero + which rows to show) and ForYouSection — React Query
 * dedupes the two, so there's one fetch.
 */
export function useForYou(
  userId: string | null,
  movies: TraktWatchedMovie[] | undefined,
  shows: TraktWatchedShow[] | undefined,
  historyReady: boolean,
) {
  const dateKey = getTemporalContext().dateKey.slice(0, 10);

  const profile = useQuery({
    queryKey: ['taste-profile', userId],
    queryFn: () => loadTasteProfile(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60 * 10,
  });
  const hasProfile = !!profile.data?.profile;

  const rows = useQuery({
    queryKey: ['for-you', userId, dateKey, profile.data?.builtAt ?? null],
    queryFn: () => fetchForYou(compactHistory(movies, shows), dateKey),
    enabled: !!userId && hasProfile && historyReady,
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  return { profile, rows, hasProfile };
}
