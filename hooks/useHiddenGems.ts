import { useQuery } from '@tanstack/react-query';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../lib/tmdb';
import { passesQualityFilter } from '../lib/quality';
import { buildWatchedSet, type RecsContext } from '../lib/recommendations';
import type { ContentItem } from '../types';

/**
 * Hidden Gems: low vote-count ceiling (keeps mainstream hits out) + high quality
 * floor. Skips the niche mismatch filter so foreign/indie content surfaces freely.
 * Uses the top 4 genres for a broader but still relevant candidate pool.
 */
export function useHiddenGems(topGenreIds: number[], ctx: RecsContext) {
  const { traktMovies, traktShows, genreAffinity, profile, traktReady } = ctx;
  const affinityKey = Object.keys(genreAffinity).length > 0 ? 'history' : 'empty';

  // Top 4 genre IDs for hidden gems (broader than the top 2 used for trending)
  const gemGenreIds = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([id]) => Number(id));

  return useQuery({
    queryKey: ['hidden-gems-v1', topGenreIds.join(','), affinityKey],
    queryFn: async (): Promise<{ items: ContentItem[] }> => {
      if (gemGenreIds.length === 0) return { items: [] };

      const novelty = profile?.noveltyTolerance ?? 0.3;
      const voteCountMax = novelty > 0.60 ? 1500 : novelty > 0.35 ? 3000 : 5000;

      const classicAffinity = profile?.eraAffinity?.classic ?? 0;
      const yearFrom = classicAffinity > 0.20 ? 1970 : 2000;
      const dateGte = `${yearFrom}-01-01`;

      const watchedSet = buildWatchedSet(traktMovies, traktShows);

      const [mP1, mP2, tvP1, tvP2] = await Promise.all([
        tmdbApi.discoverMoviesTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300, releaseDateGte: dateGte, page: 1 }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverMoviesTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300, releaseDateGte: dateGte, page: 2 }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverShowsTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200, firstAirDateGte: dateGte, page: 1 }).then(r => r.map(normalizeTVShow)),
        tmdbApi.discoverShowsTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200, firstAirDateGte: dateGte, page: 2 }).then(r => r.map(normalizeTVShow)),
      ]);

      // Client-side ceiling keeps mainstream hits out
      const gemsMovies = [...mP1, ...mP2].filter(i => (i.voteCount ?? 0) <= voteCountMax);
      const gemsTV = [...tvP1, ...tvP2].filter(i => (i.voteCount ?? 0) <= voteCountMax);

      // Interleave to vary media type across the row
      const seen = new Set<number>();
      const merged: ContentItem[] = [];
      const maxLen = Math.max(gemsMovies.length, gemsTV.length);
      for (let i = 0; i < maxLen; i++) {
        if (gemsMovies[i] && !seen.has(gemsMovies[i].id)) { seen.add(gemsMovies[i].id); merged.push(gemsMovies[i]); }
        if (gemsTV[i] && !seen.has(gemsTV[i].id)) { seen.add(gemsTV[i].id); merged.push(gemsTV[i]); }
      }

      const items = merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .slice(0, 30);

      return { items };
    },
    enabled: gemGenreIds.length > 0 && traktReady,
    staleTime: 1000 * 60 * 60 * 6,
  });
}
