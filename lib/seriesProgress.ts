import type { TraktWatchedShow } from './trakt';

export interface SeriesProgress {
  /** Watched ÷ aired episodes (0–1). */
  fraction: number;
  /** "Next S2 · E4", or "Up to date" when every aired episode is watched. */
  label: string;
}

/** The subset of TMDB /tv/{id} this needs. */
export interface TmdbShowForProgress {
  id: number;
  seasons?: { season_number: number; episode_count: number }[];
  last_episode_to_air?: { season_number: number; episode_number: number } | null;
}

/**
 * Series progress for "Continue Watching": episodes watched vs. aired (specials
 * excluded) and the next episode after the furthest one watched. Needs Trakt's
 * per-episode data (extended=progress).
 */
export function computeSeriesProgress(
  traktShow: Pick<TraktWatchedShow, 'seasons'>,
  tmdbShow: TmdbShowForProgress,
): SeriesProgress | undefined {
  const lastAired = tmdbShow.last_episode_to_air;
  if (!lastAired) return undefined;

  let watched = 0;
  let last: { season: number; episode: number } | null = null;
  for (const season of traktShow.seasons ?? []) {
    if (season.number <= 0) continue;
    for (const ep of season.episodes) {
      if (ep.plays <= 0) continue;
      watched++;
      if (!last || season.number > last.season || (season.number === last.season && ep.number > last.episode)) {
        last = { season: season.number, episode: ep.number };
      }
    }
  }
  if (!last) return undefined;

  const seasons = tmdbShow.seasons ?? [];
  let aired = 0;
  for (const se of seasons) {
    if (se.season_number <= 0) continue;
    if (se.season_number < lastAired.season_number) aired += se.episode_count;
    else if (se.season_number === lastAired.season_number) aired += lastAired.episode_number;
  }
  if (aired <= 0) return undefined;

  const seasonLen = seasons.find((se) => se.season_number === last.season)?.episode_count ?? 0;
  const next = last.episode < seasonLen
    ? { s: last.season, e: last.episode + 1 }
    : { s: last.season + 1, e: 1 };
  const nextAired =
    next.s < lastAired.season_number ||
    (next.s === lastAired.season_number && next.e <= lastAired.episode_number);

  return {
    fraction: Math.min(1, watched / aired),
    label: nextAired ? `Next S${next.s} · E${next.e}` : 'Up to date',
  };
}
