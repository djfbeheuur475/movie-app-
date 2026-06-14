import type { ContentItem } from '../types';

export type IndieBadge = { label: string; color: string };

export function getIndieBadge(item: ContentItem): IndieBadge | null {
  const votes = item.voteCount ?? 0;
  const rating = item.rating ?? 0;
  const lang = item.originalLanguage;

  // Non-English films first — they're the festival circuit mainstay
  if (lang && lang !== 'en' && rating >= 7.5 && votes >= 150) {
    return { label: '🌍 Festival Fave', color: '#22D3EE' };
  }
  // Award-season heavyweights
  if (rating >= 8.0 && votes >= 3000) {
    return { label: '🏆 Award Winner', color: '#F59E0B' };
  }
  // Strong critical consensus
  if (rating >= 7.7 && votes >= 800) {
    return { label: '✦ Critics Pick', color: '#C084FC' };
  }
  return null;
}

const GLOBAL_AVG_RATING = 6.5;
const MIN_VOTE_THRESHOLD = 150;

const BANNED_KEYWORDS = [
  'erotic', 'porn', 'pornograph', 'fetish', 'softcore', 'xxx',
  'sex film', 'adult film', 'explicit content', 'nudity film',
];

const PREFERRED_LANGUAGES = ['en', 'es', 'fr', 'ko', 'ja'];

export type QualityContext = 'default' | 'discover' | 'trending' | 'acclaimed' | 'hidden_gems';

function isBanned(item: ContentItem): boolean {
  const text = (item.title + ' ' + item.overview).toLowerCase();
  return BANNED_KEYWORDS.some((kw) => text.includes(kw));
}

function hasRequiredMetadata(item: ContentItem): boolean {
  return (
    !!item.posterPath &&
    !!item.overview &&
    item.overview.trim().length >= 50
  );
}

export function bayesianRating(
  R: number,
  v: number,
  m: number = MIN_VOTE_THRESHOLD,
  C: number = GLOBAL_AVG_RATING
): number {
  if (v === 0) return 0;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

export function passesQualityFilter(item: ContentItem, context: QualityContext = 'default'): boolean {
  if (isBanned(item)) return false;
  if (!hasRequiredMetadata(item)) return false;

  const votes = item.voteCount ?? 0;
  const rating = item.rating ?? 0;

  if (context === 'trending') return votes >= 1000;
  if (context === 'discover') return rating >= 6.5 && votes >= 250;
  if (context === 'acclaimed') return rating >= 7.5 && votes >= 500;
  if (context === 'hidden_gems') return rating >= 7.0 && votes >= 100 && votes <= 8000;

  // default
  return rating >= 5.5 && votes >= 80;
}

export function finalScore(
  item: ContentItem,
  similarityScore: number = 0,
  maxPopularity: number = 1000
): number {
  const votes = item.voteCount ?? 0;
  const bayesian = bayesianRating(item.rating, votes);
  const normalizedRating = bayesian / 10;
  const normalizedPop = Math.min((item.popularity ?? 0) / maxPopularity, 1);
  const voteConfidence = Math.min(votes / 10000, 1);

  return (
    similarityScore * 0.35 +
    normalizedRating * 0.25 +
    normalizedPop * 0.25 +
    voteConfidence * 0.15
  );
}

export function isPreferredLanguage(lang: string | undefined): boolean {
  if (!lang) return true;
  return PREFERRED_LANGUAGES.includes(lang);
}

export function hasGoodMetadata(item: ContentItem): boolean {
  return !!item.posterPath && !!item.overview && item.overview.trim().length >= 50;
}

export function filterAndRankContent(
  items: ContentItem[],
  context: QualityContext = 'default',
  limit?: number
): ContentItem[] {
  const maxPop = Math.max(...items.map((i) => i.popularity ?? 0), 1);
  const ranked = items
    .filter((item) => passesQualityFilter(item, context))
    .map((item) => ({ item, score: finalScore(item, 0, maxPop) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);

  return limit ? ranked.slice(0, limit) : ranked;
}
