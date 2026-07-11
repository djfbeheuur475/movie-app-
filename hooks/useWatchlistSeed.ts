import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../lib/tmdb';
import { passesQualityFilter } from '../lib/quality';
import {
  isMismatchedNiche,
  buildWatchedSet,
  type RecsContext,
} from '../lib/recommendations';
import type { ContentItem, WatchlistItem } from '../types';

/**
 * Seed row from the user's watchlist. Picks the most recently added
 * unwatched item as the seed, then fetches similar + recommended titles.
 * Returns both the seed (for the row title) and the fetched items.
 */
export function useWatchlistSeed(watchlistItems: WatchlistItem[], ctx: RecsContext) {
  const { traktMovies, traktShows, genreAffinity, profile } = ctx;
  const affinityKey = Object.keys(genreAffinity).length > 0 ? 'history' : 'empty';

  const seed = useMemo((): WatchlistItem | null => {
    if (!watchlistItems.length) return null;
    const watchedSet = buildWatchedSet(traktMovies, traktShows);
    return (
      [...watchlistItems]
        .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
        .find(item => !watchedSet.has(item.tmdb_id)) ?? null
    );
  }, [watchlistItems, traktMovies, traktShows]);

  const { data: items } = useQuery({
    queryKey: ['watchlist-seed-v1', seed?.tmdb_id, seed?.media_type, affinityKey],
    queryFn: async (): Promise<ContentItem[]> => {
      if (!seed) return [];
      const watchedSet = buildWatchedSet(traktMovies, traktShows);

      const [similarRaw, recsRaw] = await Promise.all(
        seed.media_type === 'movie'
          ? [
              tmdbApi.getMovieSimilar(seed.tmdb_id).then(r => r.map(normalizeMovie)),
              tmdbApi.getMovieRecommendations(seed.tmdb_id).then(r => r.map(normalizeMovie)),
            ]
          : [
              tmdbApi.getTVSimilar(seed.tmdb_id).then(r => r.map(normalizeTVShow)),
              tmdbApi.getTVRecommendations(seed.tmdb_id).then(r => r.map(normalizeTVShow)),
            ]
      );

      const seen = new Set<number>([seed.tmdb_id]);
      const merged: ContentItem[] = [];
      for (const item of [...similarRaw, ...recsRaw]) {
        if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
      }

      return merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .filter(item => !isMismatchedNiche(item, [], genreAffinity, profile))
        .slice(0, 20);
    },
    enabled: !!seed,
    staleTime: 1000 * 60 * 60,
  });

  return { seed, items };
}
