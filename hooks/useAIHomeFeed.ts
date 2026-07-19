import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePreferencesStore } from '../store/preferencesStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { getTemporalContext } from '../lib/tasteDna';
import type { ContentItem } from '../types';

export interface AISection {
  id: string;
  type: 'hero' | 'row' | 'spotlight';
  heading?: string;
  subheading?: string;
  items: ContentItem[];
  item?: ContentItem;       // spotlight only
  heroReason?: string;      // hero/spotlight: AI-generated personal reason for first item
}

export interface AIFeedResult {
  sections: AISection[];
  generatedFor: string;
  cacheMetadata: { modelUsed: string; generatedAt: string };
}

// deno-lint-ignore no-explicit-any
function recToContentItem(rec: any): ContentItem {
  return {
    id: rec.tmdbId,
    mediaType: rec.mediaType,
    title: rec.title,
    posterPath: rec.posterPath ?? null,
    backdropPath: rec.backdropPath ?? null,
    releaseDate: rec.year ? `${rec.year}-01-01` : '',
    rating: rec.voteAverage ?? 0,
    // Use AI explanation as overview — more personal than TMDB's generic blurb
    overview: rec.reason || rec.explanation || '',
    genres: rec.genres ?? [],
  };
}

interface UseAIHomeFeedOptions {
  watchedMovies: any[];
  watchedShows: any[];
  enabled: boolean;
}

export function useAIHomeFeed({ watchedMovies, watchedShows, enabled }: UseAIHomeFeedOptions) {
  const { favoriteGenres } = usePreferencesStore();
  const { items: watchlistItems } = useWatchlistStore();
  const watchlistIds = watchlistItems.map((i) => i.tmdb_id);

  // Query key includes first 5 watched IDs — changes trigger a refetch which
  // hits the server cache (instant if fingerprints match, regenerates if stale)
  const movieFingerprint = watchedMovies.slice(0, 5).map((m: any) => m.movie?.ids?.tmdb).join(',');
  const showFingerprint = watchedShows.slice(0, 5).map((s: any) => s.show?.ids?.tmdb).join(',');

  // Device-local calendar date (YYYY-MM-DD) — lets the server expire the
  // cache at the user's own midnight instead of a fixed 24h-from-generation
  // window, so "today's" feed doesn't drift into the next day for people who
  // open the app late or in a different timezone from the server.
  const clientDateKey = getTemporalContext().dateKey.slice(0, 10);

  return useQuery({
    queryKey: ['ai-home-feed-v1', movieFingerprint, showFingerprint, clientDateKey],
    queryFn: async (): Promise<AIFeedResult> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 40_000); // 40s — pipeline takes ~25-35s on cold cache

      let res: Response;
      try {
        res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-orchestrator`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
            },
            body: JSON.stringify({
              action: 'homepage',
              watchedMovies,
              watchedShows,
              watchlistIds,
              favoriteGenres,
              clientDateKey,
            }),
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${res.status}`);
      }

      const feed = await res.json();

      const sections: AISection[] = (feed.sections ?? []).map((s: any): AISection => {
        if (s.type === 'hero') {
          const items = (s.items ?? []).map(recToContentItem);
          return {
            id: s.id,
            type: 'hero',
            items,
            heroReason: s.items?.[0]?.reason || s.items?.[0]?.explanation,
          };
        }
        if (s.type === 'spotlight') {
          const item = s.item ? recToContentItem(s.item) : null;
          return {
            id: s.id,
            type: 'spotlight',
            heading: s.heading,
            subheading: s.subheading,
            items: item ? [item] : [],
            item: item ?? undefined,
            heroReason: s.item?.reason || s.item?.explanation,
          };
        }
        return {
          id: s.id,
          type: 'row',
          heading: s.heading,
          subheading: s.subheading,
          items: (s.items ?? []).map(recToContentItem),
        };
      }).filter((s: AISection) => s.items.length > 0 || s.item);

      return {
        sections,
        generatedFor: feed.generatedFor ?? '',
        cacheMetadata: feed.cacheMetadata ?? { modelUsed: '', generatedAt: '' },
      };
    },
    enabled,
    staleTime: 1000 * 60 * 30,  // 30 min client-side — real expiry is server-managed
    retry: 1,
    retryDelay: 2000,
  });
}
