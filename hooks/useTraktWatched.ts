import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiKeysStore } from '../store/apiKeysStore';
import { traktApi } from '../lib/trakt';

interface WatchedData {
  movieIds: Set<number>;
  showIds: Set<number>;
  // showTmdbId -> Set of "season_episode" keys
  episodes: Map<number, Set<string>>;
}

const EMPTY: WatchedData = {
  movieIds: new Set(),
  showIds: new Set(),
  episodes: new Map(),
};

function epKey(season: number, episode: number): string {
  return `${season}_${episode}`;
}

export function useTraktWatched() {
  const { traktClientId, traktAccessToken, traktUsername } = useApiKeysStore();

  const hasAuth = !!traktClientId && (!!traktAccessToken || !!traktUsername);

  const { data = EMPTY } = useQuery({
    queryKey: ['trakt-watched', traktClientId, traktAccessToken || traktUsername],
    queryFn: async (): Promise<WatchedData> => {
      const [movies, shows] = await Promise.all([
        traktAccessToken
          ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
          : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
        traktAccessToken
          ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
          : traktApi.getUserWatchedShows(traktUsername, traktClientId),
      ]);

      const movieIds = new Set(
        movies.map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id)
      );

      const showIds = new Set(
        shows.map((s) => s.show.ids.tmdb).filter((id): id is number => !!id)
      );

      const episodes = new Map<number, Set<string>>();
      for (const s of shows) {
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
    },
    enabled: hasAuth,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: 1,
  });

  const isWatched = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
    if (!hasAuth) return false;
    return type === 'movie' ? data.movieIds.has(id) : data.showIds.has(id);
  }, [data, hasAuth]);

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

  return { isWatched, isEpisodeWatched, watchedInSeason };
}
