// "New episodes" for Home — pure, so it's unit-testable under plain Node.
//
// For shows watched recently (default: last 14 days), surface episodes that
// either came out recently (default: last 14 days) and haven't been watched,
// or air in the coming week. One entry per show: an unwatched released
// episode beats an upcoming one (it's watchable now).

export interface EpisodeAirInfo {
  season_number: number;
  episode_number: number;
  air_date: string | null; // YYYY-MM-DD (TMDB, local calendar date)
}

export interface ShowForNewEpisodes {
  showId: number;
  lastWatchedAt: string | null; // Trakt last_watched_at for the show
  /** Episodes of the most recent season(s), from TMDB. */
  episodes: EpisodeAirInfo[];
  next: EpisodeAirInfo | null; // TMDB next_episode_to_air
}

export type NewEpisodeStatus = 'out' | 'today' | 'upcoming';

export interface NewEpisodeEntry {
  showId: number;
  status: NewEpisodeStatus;
  season: number;
  episode: number;
  airDate: string;
  /** Unwatched episodes released in the lookback window (≥1 when status is 'out'/'today'). */
  unwatchedCount: number;
}

export interface NewEpisodeOptions {
  activeDays?: number;   // show counts as "being watched" if played within this many days
  lookbackDays?: number; // released episodes this recent still count as new
  aheadDays?: number;    // upcoming episodes within this many days
}

const DAY = 24 * 60 * 60 * 1000;

function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function buildNewEpisodes(
  shows: ShowForNewEpisodes[],
  isWatched: (showId: number, season: number, episode: number) => boolean,
  now: Date,
  { activeDays = 14, lookbackDays = 14, aheadDays = 7 }: NewEpisodeOptions = {},
): NewEpisodeEntry[] {
  const today = startOfDay(now);
  const activeSince = now.getTime() - activeDays * DAY;
  const lookbackFrom = today.getTime() - lookbackDays * DAY;
  const aheadTo = today.getTime() + aheadDays * DAY;

  const entries: NewEpisodeEntry[] = [];
  for (const show of shows) {
    if (!show.lastWatchedAt || new Date(show.lastWatchedAt).getTime() < activeSince) continue;

    const released = show.episodes
      .filter((e) => e.season_number > 0 && e.air_date)
      .filter((e) => {
        const t = localDate(e.air_date!).getTime();
        return t >= lookbackFrom && t <= today.getTime();
      })
      .filter((e) => !isWatched(show.showId, e.season_number, e.episode_number))
      .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);

    if (released.length) {
      const first = released[0];
      const newest = released.reduce((m, e) => (e.air_date! > m ? e.air_date! : m), first.air_date!);
      entries.push({
        showId: show.showId,
        status: localDate(newest).getTime() === today.getTime() ? 'today' : 'out',
        season: first.season_number,
        episode: first.episode_number,
        airDate: newest,
        unwatchedCount: released.length,
      });
      continue;
    }

    const next = show.next;
    if (next?.air_date && next.season_number > 0) {
      const t = localDate(next.air_date).getTime();
      if (t >= today.getTime() && t <= aheadTo && !isWatched(show.showId, next.season_number, next.episode_number)) {
        entries.push({
          showId: show.showId,
          status: t === today.getTime() ? 'today' : 'upcoming',
          season: next.season_number,
          episode: next.episode_number,
          airDate: next.air_date,
          unwatchedCount: t === today.getTime() ? 1 : 0,
        });
      }
    }
  }

  // Watchable now first (freshest release first), then upcoming soonest first.
  const rank: Record<NewEpisodeStatus, number> = { today: 0, out: 1, upcoming: 2 };
  return entries.sort((a, b) =>
    rank[a.status] - rank[b.status]
    || (a.status === 'upcoming' ? a.airDate.localeCompare(b.airDate) : b.airDate.localeCompare(a.airDate)));
}

/** Which seasons to fetch episode lists for: any whose latest episode aired inside the lookback window. */
export function seasonsToFetch(
  lastAired: EpisodeAirInfo | null | undefined,
  now: Date,
  lookbackDays = 14,
): number[] {
  if (!lastAired?.air_date || lastAired.season_number <= 0) return [];
  const aired = localDate(lastAired.air_date).getTime();
  return aired >= startOfDay(now).getTime() - lookbackDays * DAY ? [lastAired.season_number] : [];
}
