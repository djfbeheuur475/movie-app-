import type { ContentItem } from '../types';
import type { GenreAffinity, TasteProfile } from './tasteDna';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface WatchSeed {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  watchedAt: string;
  score: number;
}

/** Common recommendation context passed into each row module hook. */
export interface RecsContext {
  traktMovies: TraktWatchedMovie[] | undefined;
  traktShows: TraktWatchedShow[] | undefined;
  genreAffinity: GenreAffinity;
  profile: TasteProfile | undefined;
  traktReady: boolean;
}

// ─── Niche content mismatch filter ───────────────────────────────────────────
// Niche genres and eras bleed into broad queries because TMDB applies them as
// secondary tags. Suppress content outside these niches unless the user's
// history shows real affinity for them. Default: assume NOT interested.

export function isMismatchedNiche(
  item: ContentItem,
  templateGenreIds: number[],
  genreAffinity: GenreAffinity,
  profile?: TasteProfile,
  templateEraFit?: 'classic' | 'nineties' | 'modern',
  preferredLanguage?: string | null,
): boolean {
  const itemGenres = new Set(item.genres ?? []);
  const templateGenres = new Set(templateGenreIds);
  const hasHistory = Object.keys(genreAffinity).length > 0;

  // Animation (16): filter unless user has real affinity (>5% of history).
  if (itemGenres.has(16) && !templateGenres.has(16)) {
    if (!hasHistory || (genreAffinity[16] ?? 0) < 0.05) return true;
  }
  // Family (10751): filter unless user watches family content (>3% of history).
  if (itemGenres.has(10751) && !templateGenres.has(10751)) {
    if (!hasHistory || (genreAffinity[10751] ?? 0) < 0.03) return true;
  }
  // Kids TV (10762): always filter unless explicitly requested.
  if (itemGenres.has(10762) && !templateGenres.has(10762)) {
    return true;
  }

  // Classic era (pre-1980): suppress unless user has demonstrated classic affinity.
  if (templateEraFit !== 'classic') {
    const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2020;
    if (year < 1980) {
      const classicAffinity = profile?.eraAffinity.classic ?? 0;
      if (!hasHistory || classicAffinity < 0.15) return true;
    }
  }

  return false;
}

// ─── Behavioural ranking ──────────────────────────────────────────────────────
// Re-ranks TMDB Discover results by taste fit rather than generic quality sort.
// Quality becomes a floor (via voteAverageGte) rather than the ranking mechanism.

export function rankItemsByProfile(
  items: ContentItem[],
  profile: TasteProfile | undefined,
  genreAffinity: GenreAffinity,
  tasteNeighborhood: Set<number>,
): ContentItem[] {
  if (!profile && Object.keys(genreAffinity).length === 0) return items;

  const affinityEntries = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id, w]) => [Number(id), w] as [number, number]);
  const totalAffinity = affinityEntries.reduce((s, [, w]) => s + w, 0);

  const darkness  = profile?.darknessScore    ?? 0.3;
  const novelty   = profile?.noveltyTolerance ?? 0.3;
  const prestige  = profile?.prestigeScore    ?? 0.5;
  const eraAff    = profile?.eraAffinity      ?? { classic: 0.1, nineties: 0.15, modern: 0.75 };

  const scored = items.map(item => {
    const genres = new Set(item.genres ?? []);

    // 1. Genre affinity match (normalised 0–1)
    const matched = affinityEntries.reduce((s, [id, w]) => s + (genres.has(id) ? w : 0), 0);
    const affinityScore = totalAffinity > 0 ? matched / totalAffinity : 0;

    // 2. Era fit
    const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2010;
    const era = year < 1990 ? 'classic' : year < 2000 ? 'nineties' : 'modern';
    const eraScore = eraAff[era] ?? 0.3;

    // 3. Quality fit — calibrated by prestige preference
    const rating = item.rating ?? 0;
    const ratingNorm = Math.max(0, Math.min((rating - 6.0) / 4.0, 1));
    const qualityScore = ratingNorm * (0.4 + prestige * 0.6);

    // 4. Novelty fit
    const votes = Math.max(item.voteCount ?? 0, 1);
    const popularityRatio = Math.min(Math.log10(votes) / Math.log10(100000), 1);
    const noveltyScore = novelty > 0.50 ? (1 - popularityRatio) : popularityRatio;

    // 5. Darkness fit
    const isDark = genres.has(27) || genres.has(53) || genres.has(80) || genres.has(9648);
    const darknessScore = isDark ? darkness : Math.max(0, 1 - darkness * 2);

    // 6. Taste neighbourhood bonus
    const neighborBonus = tasteNeighborhood.has(item.id) ? 1 : 0;

    return {
      item,
      score: affinityScore  * 0.30
           + qualityScore   * 0.20
           + eraScore       * 0.12
           + noveltyScore   * 0.13
           + darknessScore  * 0.10
           + neighborBonus  * 0.15,
    };
  });

  return scored.sort((a, b) => b.score - a.score).map(x => x.item);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Set of all TMDB IDs the user has played (movies + shows). */
export function buildWatchedSet(
  traktMovies: TraktWatchedMovie[] | undefined,
  traktShows: TraktWatchedShow[] | undefined,
): Set<number> {
  const ids = new Set<number>();
  for (const m of traktMovies ?? []) {
    if (m.movie.ids.tmdb) ids.add(m.movie.ids.tmdb);
  }
  for (const s of traktShows ?? []) {
    if (s.show.ids.tmdb) ids.add(s.show.ids.tmdb);
  }
  return ids;
}
