import { useCallback, useMemo } from 'react';
import { useManualWatchedStore } from '../store/manualWatchedStore';
import { useTraktHistory } from './useTraktHistory';

interface WatchedData {
  movieIds: Set<number>;
  showIds: Set<number>;
  // showTmdbId -> Set of "season_episode" keys
  episodes: Map<number, Set<string>>;
}

function epKey(season: number, episode: number): string {
  return `${season}_${episode}`;
}

export function useTraktWatched() {
  // Shared history source — keeps watched ticks accurate from the cached copy
  // even while Trakt is disconnected, and handles token refresh itself.
  const { movies, shows, hasHistory: hasAuth } = useTraktHistory();

  const data = useMemo((): WatchedData => {
    const movieIds = new Set(
      (movies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id)
    );

    const showIds = new Set(
      (shows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id)
    );

    const episodes = new Map<number, Set<string>>();
    for (const s of shows ?? []) {
      const tmdbId = s.show.ids.tmdb;
      if (!tmdbId) continue;
      const epSet = new Set<string>();
      for (const season of s.seasons ?? []) {
        for (const ep of season.episodes) {
          if (ep.plays > 0) epSet.add(epKey(season.number, ep.number));
        }
      }
      episodes.set(tmdbId, epSet);
    }

    return { movieIds, showIds, episodes };
  }, [movies, shows]);

  const isManuallyWatched = useManualWatchedStore((s) => s.isManuallyWatched);

  // Trakt's own record only — no manual-mark fallback. Callers that need to
  // distinguish "Trakt itself says watched" from "I marked this watched
  // in-app" (e.g. to decide whether a manual mark can still be toggled back
  // off) need this, not the combined isWatched below.
  const isTraktWatched = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
    if (!hasAuth) return false;
    return type === 'movie' ? data.movieIds.has(id) : data.showIds.has(id);
  }, [data, hasAuth]);

  const isWatched = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
    if (isManuallyWatched(id, type)) return true;
    return isTraktWatched(id, type);
  }, [isManuallyWatched, isTraktWatched]);

  const isEpisodeWatched = useCallback((showId: number, season: number, episode: number): boolean => {
    if (!hasAuth) return false;
    return data.episodes.get(showId)?.has(epKey(season, episode)) ?? false;
  }, [data, hasAuth]);

  const watchedInSeason = useCallback((showId: number, season: number): number => {
    if (!hasAuth) return 0;
    const epSet = data.episodes.get(showId);
    if (!epSet) return 0;
    const prefix = `${season}_`;
    let count = 0;
    for (const key of epSet) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  }, [data, hasAuth]);

  return { isWatched, isTraktWatched, isEpisodeWatched, watchedInSeason };
}
