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

export interface IylRow {
  seed: WatchSeed;
  items: ContentItem[];
}

/**
 * "If You Liked…" rows. Takes two diverse seeds (computed by the caller) and
 * produces one row per seed. Cross-seed dedup is applied inside this hook.
 */
export function useIfYouLiked(
  seed1: WatchSeed | null,
  seed2: WatchSeed | null,
  ctx: RecsContext,
) {
  const { traktMovies, traktShows, genreAffinity, profile, traktReady } = ctx;
  const affinityKey = Object.keys(genreAffinity).length > 0 ? 'history' : 'empty';

  return useQuery({
    queryKey: ['if-you-liked-v1', seed1?.tmdbId, seed2?.tmdbId, affinityKey],
    queryFn: async (): Promise<IylRow[]> => {
      const seeds = [seed1, seed2].filter((s): s is WatchSeed => s != null);
      if (seeds.length === 0) return [];

      const watchedSet = buildWatchedSet(traktMovies, traktShows);
      const dominant = Object.entries(genreAffinity)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 4)
        .map(([id]) => Number(id));

      async function fetchSimilarItems(seed: WatchSeed): Promise<ContentItem[]> {
        // /similar uses genre+keyword metadata; /recommendations uses collaborative filtering.
        // Merge with /similar prioritised — more accurate for niche content.
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

        const seen = new Set<number>();
        const merged: ContentItem[] = [];
        for (const item of [...similarRaw, ...recsRaw]) {
          if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
        }

        const filtered = merged
          .filter(item => !watchedSet.has(item.id))
          .filter(item => passesQualityFilter(item, 'discover'))
          .filter(item => !isMismatchedNiche(item, [], genreAffinity, profile));

        if (dominant.length === 0) return filtered.slice(0, 30);

        const ranked = filtered.map(item => {
          const itemGenres = new Set(item.genres ?? []);
          const genreMatch = dominant.filter(g => itemGenres.has(g)).length / dominant.length;
          const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2010;
          const era = profile?.eraAffinity ?? { classic: 0.1, nineties: 0.15, modern: 0.75 };
          const eraScore = year < 1990 ? era.classic : year < 2000 ? era.nineties : era.modern;
          const prestige = profile?.prestigeScore ?? 0.5;
          const qualityBonus = prestige > 0.45 ? Math.max(0, ((item.rating ?? 0) - 7.0) / 3.0) * prestige : 0;
          const novelty = profile?.noveltyTolerance ?? 0.3;
          const popularityFit = novelty > 0.5
            ? Math.max(0, 1 - (item.voteCount ?? 0) / 8000) * 0.1
            : Math.min((item.voteCount ?? 0) / 5000, 1) * 0.1;
          return { item, score: genreMatch * 0.5 + eraScore * 0.15 + qualityBonus * 0.25 + popularityFit };
        });

        return ranked.sort((a, b) => b.score - a.score).map(x => x.item).slice(0, 30);
      }

      const rowData = await Promise.all(seeds.map(fetchSimilarItems));

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
    enabled: !!seed1 && traktReady,
    staleTime: 1000 * 60 * 60,
  });
}
