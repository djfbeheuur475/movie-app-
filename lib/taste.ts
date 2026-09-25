import { supabase } from './supabase';
import { Config } from '../constants/config';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';
import type { ContentItem, MediaType } from '../types';

// Client for the taste pipeline (ai-orchestrator actions taste_seed /
// taste_profile / for_you) plus direct rating writes (RLS: own rows only).

export type TasteRating = 2 | 1 | 0 | -1 | null; // loved · liked · meh · disliked · haven't seen

export interface TasteProfileDoc {
  summary: string;
  loves: string[];
  avoids: string[];
  acclaim: string;
  moods: { label: string; description: string }[];
  blindSpots: string[];
}

export interface StoredTasteProfile {
  profile: TasteProfileDoc | null;
  userNotes: string;
  ratingsCount: number;
  builtAt: string | null;
}

export interface TasteTitle {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  voteCount: number;
  genres: number[];
  overview: string;
}

export interface SeedItem extends TasteTitle {
  prompt: string;       // why it's being asked ("You stopped after 2 episodes", "cynical vs warm comedy")
  fromHistory: boolean;
}

export interface ForYouItem extends TasteTitle { reason: string }
export interface ForYouRow { id: string; heading: string; subheading: string; items: ForYouItem[] }

export function toContentItem(t: TasteTitle, overview?: string): ContentItem {
  return {
    id: t.tmdbId,
    mediaType: t.mediaType,
    title: t.title,
    posterPath: t.posterPath,
    backdropPath: t.backdropPath,
    releaseDate: t.year ? `${t.year}-01-01` : '',
    rating: t.voteAverage,
    overview: overview ?? t.overview,
    genres: t.genres,
    voteCount: t.voteCount,
  };
}

/**
 * History in the shape the orchestrator reads, minus per-episode detail.
 * Episodes watched is kept as a count — finishing a show vs dropping it after
 * two episodes is the strongest like/dislike signal the history has.
 */
export function compactHistory(movies: TraktWatchedMovie[] = [], shows: TraktWatchedShow[] = []) {
  return {
    watchedMovies: movies.map((m) => ({ movie: m.movie, plays: m.plays, last_watched_at: m.last_watched_at })),
    watchedShows: shows.map((s) => ({
      show: s.show,
      plays: s.plays,
      last_watched_at: s.last_watched_at,
      episodes_watched: (s.seasons ?? [])
        .filter((season) => season.number > 0)
        .reduce((n, season) => n + season.episodes.length, 0),
    })),
  };
}

async function orchestrator<T>(action: string, body: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to use your taste profile');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/ai-orchestrator`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: Config.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchTasteSeed(history: ReturnType<typeof compactHistory>) {
  return orchestrator<{ items: SeedItem[]; ratedCount: number }>('taste_seed', history);
}

export function buildTasteProfile(history: ReturnType<typeof compactHistory>, userNotes?: string) {
  return orchestrator<{ profile: TasteProfileDoc; userNotes: string; ratingsCount: number; builtAt: string }>(
    'taste_profile', { ...history, ...(userNotes !== undefined && { userNotes }) },
  );
}

export function fetchForYou(history: ReturnType<typeof compactHistory>, clientDateKey: string, force = false) {
  return orchestrator<{ rows: ForYouRow[]; needsProfile?: boolean; builtAt?: string }>(
    'for_you', { ...history, clientDateKey, force }, 90_000,
  );
}

export async function loadTasteProfile(userId: string): Promise<StoredTasteProfile> {
  const [{ data }, { count }] = await Promise.all([
    supabase.from('taste_profiles').select('profile, user_notes, profile_built_at').eq('user_id', userId).maybeSingle(),
    supabase.from('title_ratings').select('tmdb_id', { count: 'exact', head: true }).eq('user_id', userId).not('rating', 'is', null),
  ]);
  return {
    profile: (data?.profile as TasteProfileDoc | null) ?? null,
    userNotes: data?.user_notes ?? '',
    ratingsCount: count ?? 0,
    builtAt: data?.profile_built_at ?? null,
  };
}

export async function rateTitle(
  userId: string,
  t: Pick<TasteTitle, 'tmdbId' | 'mediaType' | 'title' | 'year' | 'posterPath'>,
  rating: TasteRating,
  source: 'rater' | 'recommendation' | 'detail' = 'rater',
) {
  const { error } = await supabase.from('title_ratings').upsert({
    user_id: userId,
    tmdb_id: t.tmdbId,
    media_type: t.mediaType,
    title: t.title,
    year: t.year || null,
    poster_path: t.posterPath,
    rating,
    source,
    rated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function saveTasteNotes(userId: string, userNotes: string) {
  const { error } = await supabase.from('taste_profiles').upsert({ user_id: userId, user_notes: userNotes, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
