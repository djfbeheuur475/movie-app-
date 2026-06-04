import axios from 'axios';
import { Config, ImageSizes } from '../constants/config';
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
  params: {
    api_key: process.env.EXPO_PUBLIC_TMDB_API_KEY,
    language: 'en-US',
  },
});

// ─── Image helpers ────────────────────────────────────────────────────────────

export const getPosterUrl = (path: string | null, size: 'thumb' | 'medium' | 'large' | 'original' = 'medium') =>
  path ? `${ImageSizes.poster[size]}${path}` : null;

export const getBackdropUrl = (path: string | null, size: 'small' | 'medium' | 'large' | 'original' = 'large') =>
  path ? `${ImageSizes.backdrop[size]}${path}` : null;

export const getProfileUrl = (path: string | null, size: 'small' | 'medium' | 'large' = 'medium') =>
  path ? `${ImageSizes.profile[size]}${path}` : null;

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
        append_to_response: 'credits,videos,watch/providers,similar,recommendations',
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
};
