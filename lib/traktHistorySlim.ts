import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

// Pure helpers for the Trakt history cache — no storage/network imports, so
// they're unit-testable under plain Node.

export interface SlimHistory {
  movies: TraktWatchedMovie[];
  shows: TraktWatchedShow[];
}

// Trakt returns a lot we never read (per-episode timestamps, reset_at, slugs…).
// Keeping only what the app uses keeps a heavy history well under Android
// AsyncStorage's ~2MB per-entry limit.
export function slimHistory(
  movies: TraktWatchedMovie[],
  shows: TraktWatchedShow[],
): SlimHistory {
  return {
    movies: movies.map((m) => ({
      plays: m.plays,
      last_watched_at: m.last_watched_at,
      movie: { title: m.movie.title, year: m.movie.year, ids: m.movie.ids },
    })),
    shows: shows.map((s) => ({
      plays: s.plays,
      last_watched_at: s.last_watched_at,
      show: { title: s.show.title, year: s.show.year, ids: s.show.ids },
      seasons: (s.seasons ?? []).map((season) => ({
        number: season.number,
        episodes: season.episodes.map((ep) => ({ number: ep.number, plays: ep.plays })),
      })),
    })),
  };
}

// Cheap change detector so an unchanged history isn't re-uploaded every sync.
export function historySignature(h: SlimHistory): string {
  let latest = '';
  let plays = 0;
  let episodes = 0;
  for (const m of h.movies) { plays += m.plays; if (m.last_watched_at > latest) latest = m.last_watched_at; }
  for (const s of h.shows) {
    plays += s.plays;
    if (s.last_watched_at > latest) latest = s.last_watched_at;
    for (const season of s.seasons ?? []) episodes += season.episodes.length;
  }
  return `${h.movies.length}:${h.shows.length}:${plays}:${episodes}:${latest}`;
}
