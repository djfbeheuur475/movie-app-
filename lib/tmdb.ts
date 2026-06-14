import axios from 'axios';
import { Config, ImageSizes } from '../constants/config';
import { useApiKeysStore } from '../store/apiKeysStore';
import type {
  TMDBMovie,
  TMDBTVShow,
  TMDBMovieDetail,
  TMDBTVDetail,
  TMDBSearchResult,
  Person,
  ContentItem,
} from '../types';

const tmdb = axios.create({
  baseURL: Config.TMDB_BASE_URL,
  params: { language: 'en-US' },
});

// Inject the TMDB key from secure store on every request
tmdb.interceptors.request.use((config) => {
  const key = useApiKeysStore.getState().tmdbKey;
  if (key) config.params = { ...config.params, api_key: key };
  return config;
});

// ─── Image helpers ────────────────────────────────────────────────────────────

export const getPosterUrl = (path: string | null, size: 'thumb' | 'medium' | 'large' | 'original' = 'medium') =>
  path ? `${ImageSizes.poster[size]}${path}` : null;

export const getBackdropUrl = (path: string | null, size: 'small' | 'medium' | 'large' | 'original' = 'large') =>
  path ? `${ImageSizes.backdrop[size]}${path}` : null;

export const getProfileUrl = (path: string | null, size: 'small' | 'medium' | 'large' = 'medium') =>
  path ? `${ImageSizes.profile[size]}${path}` : null;

export const getStillUrl = (path: string | null) =>
  path ? `${Config.TMDB_IMAGE_BASE}/w300${path}` : null;

// ─── Normalizers ──────────────────────────────────────────────────────────────

export const normalizeMovie = (m: TMDBMovie): ContentItem => ({
  id: m.id,
  mediaType: 'movie',
  title: m.title,
  posterPath: m.poster_path,
  backdropPath: m.backdrop_path,
  releaseDate: m.release_date,
  rating: m.vote_average,
  overview: m.overview,
  genres: m.genre_ids,
  voteCount: m.vote_count,
  popularity: m.popularity,
  originalLanguage: m.original_language,
});

export const normalizeTVShow = (s: TMDBTVShow): ContentItem => ({
  id: s.id,
  mediaType: 'tv',
  title: s.name,
  posterPath: s.poster_path,
  backdropPath: s.backdrop_path,
  releaseDate: s.first_air_date,
  rating: s.vote_average,
  overview: s.overview,
  genres: s.genre_ids,
  voteCount: s.vote_count,
  popularity: s.popularity,
  originalLanguage: s.original_language,
});

// ─── API calls ────────────────────────────────────────────────────────────────

export const tmdbApi = {
  // Trending
  getTrending: async (type: 'movie' | 'tv' | 'all' = 'all', window: 'day' | 'week' = 'week') => {
    const { data } = await tmdb.get(`/trending/${type}/${window}`);
    return data.results as (TMDBMovie | TMDBTVShow)[];
  },

  // Discover
  getPopularMovies: async (page = 1) => {
    const { data } = await tmdb.get('/movie/popular', { params: { page } });
    return data.results as TMDBMovie[];
  },

  getPopularShows: async (page = 1) => {
    const { data } = await tmdb.get('/tv/popular', { params: { page } });
    return data.results as TMDBTVShow[];
  },

  getTopRatedMovies: async (page = 1) => {
    const { data } = await tmdb.get('/movie/top_rated', { params: { page } });
    return data.results as TMDBMovie[];
  },

  getNowPlayingMovies: async (page = 1) => {
    const { data } = await tmdb.get('/movie/now_playing', { params: { page } });
    return data.results as TMDBMovie[];
  },

  getUpcomingMovies: async (page = 1) => {
    const { data } = await tmdb.get('/movie/upcoming', { params: { page } });
    return data.results as TMDBMovie[];
  },

  getAiringToday: async (page = 1) => {
    const { data } = await tmdb.get('/tv/airing_today', { params: { page } });
    return data.results as TMDBTVShow[];
  },

  getOnTheAir: async (page = 1) => {
    const { data } = await tmdb.get('/tv/on_the_air', { params: { page } });
    return data.results as TMDBTVShow[];
  },

  // Detail
  getMovieDetail: async (id: number): Promise<TMDBMovieDetail> => {
    const { data } = await tmdb.get(`/movie/${id}`, {
      params: {
        append_to_response: 'credits,videos,watch/providers,similar,recommendations',
      },
    });
    return data;
  },

  getTVDetail: async (id: number): Promise<TMDBTVDetail> => {
    const { data } = await tmdb.get(`/tv/${id}`, {
      params: {
        append_to_response: 'credits,videos,watch/providers,similar,recommendations,external_ids',
      },
    });
    return data;
  },

  // Person
  getPersonDetail: async (id: number): Promise<Person> => {
    const { data } = await tmdb.get(`/person/${id}`, {
      params: { append_to_response: 'movie_credits,tv_credits' },
    });
    return data;
  },

  // Search
  searchMulti: async (query: string, page = 1): Promise<TMDBSearchResult[]> => {
    const { data } = await tmdb.get('/search/multi', { params: { query, page } });
    return data.results;
  },

  searchMovies: async (query: string, page = 1): Promise<TMDBMovie[]> => {
    const { data } = await tmdb.get('/search/movie', { params: { query, page } });
    return data.results;
  },

  searchTVShows: async (query: string, page = 1): Promise<TMDBTVShow[]> => {
    const { data } = await tmdb.get('/search/tv', { params: { query, page } });
    return data.results;
  },

  // Discover with filters
  discoverMovies: async (params: Record<string, unknown> = {}): Promise<TMDBMovie[]> => {
    const { data } = await tmdb.get('/discover/movie', { params });
    return data.results;
  },

  discoverTV: async (params: Record<string, unknown> = {}): Promise<TMDBTVShow[]> => {
    const { data } = await tmdb.get('/discover/tv', { params });
    return data.results;
  },

  // Genres
  getMovieGenres: async () => {
    const { data } = await tmdb.get('/genre/movie/list');
    return data.genres as { id: number; name: string }[];
  },

  getTVGenres: async () => {
    const { data } = await tmdb.get('/genre/tv/list');
    return data.genres as { id: number; name: string }[];
  },

  // Recommendations by title id
  getMovieRecommendations: async (id: number): Promise<TMDBMovie[]> => {
    const { data } = await tmdb.get(`/movie/${id}/recommendations`);
    return data.results;
  },

  getTVRecommendations: async (id: number): Promise<TMDBTVShow[]> => {
    const { data } = await tmdb.get(`/tv/${id}/recommendations`);
    return data.results;
  },

  // Curated quality rows — return { results, total_pages } for infinite scroll
  getCriticallyAcclaimed: async (type: 'movie' | 'tv', page = 1) => {
    if (type === 'movie') {
      const { data } = await tmdb.get('/discover/movie', {
        params: {
          sort_by: 'vote_average.desc',
          'vote_count.gte': 500,
          'vote_average.gte': 7.5,
          page,
          with_original_language: 'en',
        },
      });
      return { results: data.results as TMDBMovie[], total_pages: data.total_pages as number };
    } else {
      const { data } = await tmdb.get('/discover/tv', {
        params: {
          sort_by: 'vote_average.desc',
          'vote_count.gte': 300,
          'vote_average.gte': 8.0,
          page,
        },
      });
      return { results: data.results as TMDBTVShow[], total_pages: data.total_pages as number };
    }
  },

  getHiddenGems: async (type: 'movie' | 'tv', page = 1) => {
    if (type === 'movie') {
      const { data } = await tmdb.get('/discover/movie', {
        params: {
          sort_by: 'vote_average.desc',
          'vote_count.gte': 100,
          'vote_average.gte': 7.0,
          'vote_count.lte': 8000,
          page,
        },
      });
      return { results: data.results as TMDBMovie[], total_pages: data.total_pages as number };
    } else {
      const { data } = await tmdb.get('/discover/tv', {
        params: {
          sort_by: 'vote_average.desc',
          'vote_count.gte': 100,
          'vote_average.gte': 7.5,
          'vote_count.lte': 5000,
          page,
        },
      });
      return { results: data.results as TMDBTVShow[], total_pages: data.total_pages as number };
    }
  },

  getByGenre: async (type: 'movie' | 'tv', genreId: number | string, page = 1) => {
    const endpoint = type === 'movie' ? '/discover/movie' : '/discover/tv';
    const { data } = await tmdb.get(endpoint, {
      params: {
        sort_by: 'popularity.desc',
        with_genres: String(genreId),
        'vote_count.gte': 150,
        'vote_average.gte': 6.0,
        page,
      },
    });
    return {
      results: type === 'movie'
        ? (data.results as TMDBMovie[])
        : (data.results as TMDBTVShow[]),
      total_pages: data.total_pages as number,
    };
  },

  // TV episode detail
  getTVEpisode: async (showId: number, season: number, episode: number): Promise<{
    id: number;
    name: string | null;
    overview: string | null;
    episode_number: number;
    season_number: number;
    air_date: string | null;
    runtime: number | null;
    still_path: string | null;
    vote_average: number;
    vote_count: number;
    crew: { id: number; name: string; job: string; profile_path: string | null }[];
    guest_stars: { id: number; name: string; character: string; profile_path: string | null }[];
  }> => {
    const { data } = await tmdb.get(`/tv/${showId}/season/${season}/episode/${episode}`);
    return data;
  },

  // TV season episodes
  getTVSeason: async (showId: number, seasonNumber: number): Promise<{
    episodes: {
      id: number;
      name: string | null;
      overview: string | null;
      episode_number: number;
      season_number: number;
      air_date: string | null;
      runtime: number | null;
      still_path: string | null;
      vote_average: number;
    }[];
  }> => {
    const { data } = await tmdb.get(`/tv/${showId}/season/${seasonNumber}`);
    return data;
  },

  // Indie & Critics Picks — high-quality drama/arthouse, excludes mainstream blockbusters
  getIndieCriticsPicks: async (page = 1): Promise<{ results: TMDBMovie[]; total_pages: number }> => {
    const { data } = await tmdb.get('/discover/movie', {
      params: {
        sort_by: 'vote_average.desc',
        'vote_average.gte': 7.4,
        'vote_count.gte': 300,
        'vote_count.lte': 450000,   // keeps out mega-blockbusters
        with_genres: '18',           // Drama — core of arthouse/indie
        without_genres: '10751,16',  // no Family, Animation
        page,
      },
    });
    return { results: data.results as TMDBMovie[], total_pages: data.total_pages as number };
  },

  getIndieCriticsPicksTV: async (page = 1): Promise<{ results: TMDBTVShow[]; total_pages: number }> => {
    const { data } = await tmdb.get('/discover/tv', {
      params: {
        sort_by: 'vote_average.desc',
        'vote_average.gte': 7.5,
        'vote_count.gte': 100,
        'vote_count.lte': 200000,    // keeps out mega-popular shows
        without_genres: '10751,10762,10763,10764,10766,10767', // no family/kids/news/reality/soap/talk
        page,
      },
    });
    return { results: data.results as TMDBTVShow[], total_pages: data.total_pages as number };
  },

  // Movies releasing in the next 365 days (paginated, sorted by popularity)
  getUpcomingYear: async (page = 1): Promise<{ results: TMDBMovie[]; total_pages: number }> => {
    const today = new Date().toISOString().slice(0, 10);
    const yearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await tmdb.get('/discover/movie', {
      params: {
        sort_by: 'popularity.desc',
        'primary_release_date.gte': today,
        'primary_release_date.lte': yearLater,
        page,
      },
    });
    return { results: data.results as TMDBMovie[], total_pages: data.total_pages as number };
  },

  getTrendingPage: async (type: 'movie' | 'tv', window: 'day' | 'week', page = 1) => {
    const { data } = await tmdb.get(`/trending/${type}/${window}`, { params: { page } });
    return {
      results: data.results as (TMDBMovie | TMDBTVShow)[],
      total_pages: data.total_pages as number,
    };
  },

  getNowPlayingPage: async (page = 1) => {
    const { data } = await tmdb.get('/movie/now_playing', { params: { page } });
    return { results: data.results as TMDBMovie[], total_pages: data.total_pages as number };
  },

  getAiringTodayPage: async (page = 1) => {
    const { data } = await tmdb.get('/tv/airing_today', { params: { page } });
    return { results: data.results as TMDBTVShow[], total_pages: data.total_pages as number };
  },
};
