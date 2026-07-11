import { useQuery } from '@tanstack/react-query';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../lib/tmdb';
import { passesQualityFilter } from '../lib/quality';
import { isMismatchedNiche, buildWatchedSet, type RecsContext } from '../lib/recommendations';
import { GENRE_LABELS } from '../lib/templateSelector';
import type { ContentItem } from '../types';

/**
 * Trending content filtered to the user's top genre preferences.
 * Interleaves movies and TV for variety. Title is dynamic:
 * "Trending in Crime & Thriller".
 */
export function useTrendingInGenre(topGenreEntries: number[], ctx: RecsContext) {
  const { traktMovies, traktShows, genreAffinity, profile, traktReady } = ctx;

  return useQuery({
    queryKey: ['trending-in-genre-v1', topGenreEntries.join(',')],
    queryFn: async (): Promise<{ title: string; items: ContentItem[] }> => {
      const genreLabel = topGenreEntries
        .map(id => GENRE_LABELS[id])
        .filter(Boolean)
        .map(l => l!.charAt(0).toUpperCase() + l!.slice(1))
        .join(' & ');

      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      const dateGte = threeYearsAgo.toISOString().slice(0, 10);

      const watchedSet = buildWatchedSet(traktMovies, traktShows);

      const [movieResults, tvResults] = await Promise.all([
        tmdbApi.discoverMoviesTyped({
          genreIds: topGenreEntries,
          sortBy: 'popularity.desc',
          voteAverageGte: 6.5,
          voteCountGte: 500,
          releaseDateGte: dateGte,
        }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverShowsTyped({
          genreIds: topGenreEntries,
          sortBy: 'popularity.desc',
          voteAverageGte: 7.0,
          voteCountGte: 200,
          firstAirDateGte: dateGte,
        }).then(r => r.map(normalizeTVShow)),
      ]);

      const seen = new Set<number>();
      const merged: ContentItem[] = [];
      const maxLen = Math.max(movieResults.length, tvResults.length);
      for (let i = 0; i < maxLen; i++) {
        if (movieResults[i] && !seen.has(movieResults[i].id)) {
          seen.add(movieResults[i].id);
          merged.push(movieResults[i]);
        }
        if (tvResults[i] && !seen.has(tvResults[i].id)) {
          seen.add(tvResults[i].id);
          merged.push(tvResults[i]);
        }
      }

      const items = merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .filter(item => !isMismatchedNiche(item, topGenreEntries, genreAffinity, profile))
        .slice(0, 24);

      return { title: `Trending in ${genreLabel || 'Your Genre'}`, items };
    },
    enabled: topGenreEntries.length > 0 && traktReady,
    staleTime: 1000 * 60 * 60 * 4,
  });
}
