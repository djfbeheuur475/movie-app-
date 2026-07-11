import { useQuery } from '@tanstack/react-query';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../lib/tmdb';
import { passesQualityFilter } from '../lib/quality';
import {
  isMismatchedNiche,
  buildWatchedSet,
  type RecsContext,
  type WatchSeed,
} from '../lib/recommendations';
import type { ContentItem } from '../types';

export interface BywRow {
  seed: WatchSeed;
  items: ContentItem[];
}

/**
 * "Because You Watched" rows. Each seed gets its own row; cross-seed dedup
 * is applied inside this hook so the same title can't appear twice.
 */
export function useBecauseYouWatched(seeds: WatchSeed[], ctx: RecsContext) {
  const { traktMovies, traktShows, genreAffinity, profile, traktReady } = ctx;
  const affinityKey = Object.keys(genreAffinity).length > 0 ? 'history' : 'empty';
  const seedKey = seeds.map(s => `${s.tmdbId}-${s.mediaType}`).join(',');

  return useQuery({
    queryKey: ['because-you-watched-v2', seedKey, affinityKey],
    queryFn: async (): Promise<BywRow[]> => {
      if (seeds.length === 0) return [];

      const watchedSet = buildWatchedSet(traktMovies, traktShows);
      const dominant = Object.entries(genreAffinity)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 4)
        .map(([id]) => Number(id));

      async function fetchSeedItems(seed: WatchSeed): Promise<ContentItem[]> {
        const [similarRaw, recsRaw] = await Promise.all(
          seed.mediaType === 'movie'
            ? [
                tmdbApi.getMovieSimilar(seed.tmdbId).then(r => r.map(normalizeMovie)),
                tmdbApi.getMovieRecommendations(seed.tmdbId).then(r => r.map(normalizeMovie)),
              ]
            : [
                tmdbApi.getTVSimilar(seed.tmdbId).then(r => r.map(normalizeTVShow)),
                tmdbApi.getTVRecommendations(seed.tmdbId).then(r => r.map(normalizeTVShow)),
              ]
        );

        const seen = new Set<number>([seed.tmdbId]);
        const merged: ContentItem[] = [];
        for (const item of [...similarRaw, ...recsRaw]) {
          if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
        }

        const filtered = merged
          .filter(item => !watchedSet.has(item.id))
          .filter(item => passesQualityFilter(item, 'discover'))
          .filter(item => !isMismatchedNiche(item, [], genreAffinity, profile));

        if (dominant.length === 0) return filtered.slice(0, 20);

        return filtered
          .map(item => {
            const itemGenres = new Set(item.genres ?? []);
            const genreMatch = dominant.filter(g => itemGenres.has(g)).length / dominant.length;
            const prestige = profile?.prestigeScore ?? 0.5;
            const qualityBonus = prestige > 0.45 ? Math.max(0, ((item.rating ?? 0) - 7.0) / 3.0) * prestige : 0;
            return { item, score: genreMatch * 0.6 + qualityBonus * 0.4 };
          })
          .sort((a, b) => b.score - a.score)
          .map(x => x.item)
          .slice(0, 20);
      }

      const rowData = await Promise.all(seeds.map(fetchSeedItems));

      const seenAcrossRows = new Set<number>();
      return seeds.map((seed, i) => ({
        seed,
        items: rowData[i].filter(item => {
          if (seenAcrossRows.has(item.id)) return false;
          seenAcrossRows.add(item.id);
          return true;
        }),
      })).filter(r => r.items.length >= 3);
    },
    enabled: seeds.length > 0 && traktReady,
    staleTime: 1000 * 60 * 60,
  });
}
