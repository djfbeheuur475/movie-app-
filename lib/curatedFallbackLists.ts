// Curated fallback lists — real, community-vetted Trakt lists used wherever
// there's no taste signal to personalize against: guests (no account) here,
// and brand-new accounts (no watch history yet) via the equivalent
// CURATED_FALLBACK_LISTS in supabase/functions/ai-orchestrator/actions/homepage.ts.
// Keep both lists in sync — picked from the top of the indexed Trakt catalog
// by community likes, favouring broad, universally-recognizable appeal over
// niche/fandom-specific lists (Marvel, Star Wars, etc. scored just as high
// but aren't a good "everyone" default).
//
// Not tied to a specific screen — imported by the Home screen for guests.

import { tmdbApi, normalizeMovie, normalizeTVShow } from './tmdb';
import { getListItemsPage } from './trakt';
import { hasGoodMetadata } from './quality';
import type { ContentItem } from '../types';

export interface CuratedFallbackList {
  id: number;
  name: string;
  subtitle: string;
}

export const CURATED_FALLBACK_LISTS: CuratedFallbackList[] = [
  { id: 2142753, name: 'IMDB: Top Rated Movies', subtitle: 'The 250 highest-rated films, as voted by millions of viewers.' },
  { id: 2143363, name: 'IMDB: Top Rated TV Shows', subtitle: 'The 250 highest-rated shows, ranked by IMDB voters.' },
  { id: 832943, name: 'Academy Awards — Best Picture Winners', subtitle: 'Every Best Picture winner in Oscar history.' },
  { id: 805405, name: '1001 Movies You Must See Before You Die', subtitle: 'The definitive checklist of essential cinema.' },
  { id: 808094, name: 'Great Movies You May Have Never Heard Of', subtitle: 'Quietly brilliant films that flew under the radar.' },
  { id: 2748259, name: "Rolling Stone's 100 Greatest TV Shows of All Time", subtitle: 'The magazine’s definitive ranking of TV’s best.' },
];

function dayNumber(dateKey: string): number {
  return Math.floor(new Date(`${dateKey}T00:00:00Z`).getTime() / 86_400_000);
}

// Sliding window over the shortlist — shifts by one list per day, so opening
// the app tomorrow shows a refreshed (not identical, not fully reshuffled)
// set of rows. Matches the rotation used server-side for new accounts.
export function pickDailyCuratedLists(dateKey: string, count = 4): CuratedFallbackList[] {
  const n = CURATED_FALLBACK_LISTS.length;
  const start = ((dayNumber(dateKey) % n) + n) % n;
  return Array.from({ length: Math.min(count, n) }, (_, i) => CURATED_FALLBACK_LISTS[(start + i) % n]);
}

export interface CuratedListPage {
  items: ContentItem[];
  nextPage: number | null;
}

// Public list browsing (client-id only, no user auth) — safe for guests.
export async function fetchCuratedListPage(listId: number, page: number, limit = 20): Promise<CuratedListPage> {
  const { items: listItems, pageCount } = await getListItemsPage(listId, page, limit);

  const refs = listItems
    .map((i) => {
      const mediaType = i.type === 'movie' ? ('movie' as const) : ('tv' as const);
      const tmdbId = (i.type === 'movie' ? i.movie : i.show)?.ids.tmdb;
      return tmdbId ? { mediaType, tmdbId } : null;
    })
    .filter((r): r is { mediaType: 'movie' | 'tv'; tmdbId: number } => r !== null);

  const enriched = await Promise.allSettled(
    refs.map((r) =>
      r.mediaType === 'movie'
        ? tmdbApi.getMovieBasic(r.tmdbId).then(normalizeMovie)
        : tmdbApi.getTVBasic(r.tmdbId).then(normalizeTVShow)
    )
  );
  const items = enriched
    .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter(hasGoodMetadata);

  return { items, nextPage: page < pageCount ? page + 1 : null };
}
