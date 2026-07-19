// ─── TMDB Types ───────────────────────────────────────────────────────────────

export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  adult: boolean;
  video: boolean;
  original_language: string;
}

export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  origin_country: string[];
  original_language: string;
}

export interface TMDBMovieDetail extends TMDBMovie {
  runtime: number;
  budget: number;
  revenue: number;
  status: string;
  tagline: string;
  genres: Genre[];
  production_companies: ProductionCompany[];
  credits: Credits;
  videos: { results: Video[] };
  'watch/providers': WatchProviders;
  similar: { results: TMDBMovie[] };
  recommendations: { results: TMDBMovie[] };
  imdb_id: string | null;
}

export interface TMDBTVDetail extends TMDBTVShow {
  number_of_episodes: number;
  number_of_seasons: number;
  status: string;
  tagline: string;
  genres: Genre[];
  seasons: Season[];
  credits: Credits;
  videos: { results: Video[] };
  'watch/providers': WatchProviders;
  similar: { results: TMDBTVShow[] };
  recommendations: { results: TMDBTVShow[] };
  created_by: Creator[];
  episode_run_time: number[];
  networks: Network[];
  external_ids?: { imdb_id: string | null; tvdb_id: number | null };
  next_episode_to_air?: {
    air_date: string;
    season_number: number;
    episode_number: number;
    name: string | null;
  } | null;
}

export interface Genre {
  id: number;
  name: string;
}

export interface Credits {
  cast: CastMember[];
  crew: CrewMember[];
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface Video {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface WatchProviders {
  results: Record<string, CountryProviders>;
}

export interface CountryProviders {
  link: string;
  flatrate?: Provider[];
  rent?: Provider[];
  buy?: Provider[];
}

export interface Provider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

export interface Season {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  air_date: string | null;
  overview: string;
  poster_path: string | null;
}

export interface Creator {
  id: number;
  name: string;
  profile_path: string | null;
}

export interface Network {
  id: number;
  name: string;
  logo_path: string | null;
}

export interface ProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface Person {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  profile_path: string | null;
  known_for_department: string;
  popularity: number;
  movie_credits: { cast: TMDBMovie[] };
  tv_credits: { cast: TMDBTVShow[] };
}

export interface TMDBSearchResult {
  id: number;
  media_type: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  poster_path?: string | null;
  profile_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
  known_for_department?: string;
}

// ─── Trakt Types ──────────────────────────────────────────────────────────────

export interface TraktMovie {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
  };
}

export interface TraktShow {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
    tvdb: number;
  };
}

export interface TraktEpisode {
  season: number;
  number: number;
  title: string;
  ids: {
    trakt: number;
    tvdb: number;
    imdb: string;
    tmdb: number;
  };
  first_aired?: string;
  overview?: string;
  runtime?: number;
}

export interface TraktCalendarEntry {
  first_aired: string;
  episode: TraktEpisode;
  show: TraktShow;
}

export interface TraktWatchedMovie {
  plays: number;
  last_watched_at: string;
  movie: TraktMovie;
}

export interface TraktWatchedShow {
  plays: number;
  last_watched_at: string;
  show: TraktShow;
  seasons: TraktWatchedSeason[];
}

export interface TraktWatchedSeason {
  number: number;
  episodes: { number: number; plays: number }[];
}

// ─── App Types ────────────────────────────────────────────────────────────────

export type MediaType = 'movie' | 'tv';

export interface ContentItem {
  id: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string;
  rating: number;
  overview: string;
  genres?: number[];
  voteCount?: number;
  popularity?: number;
  originalLanguage?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  recommendations?: ContentItem[];
  aiTitleMap?: Record<string, ContentItem>;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  trakt_connected: boolean;
  trakt_username: string | null;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  added_at: string;
  title: string;
  poster_path: string | null;
}

// A watch the user marked manually in-app, for titles Trakt has no record of
// (watched somewhere that doesn't scrobble to Trakt, watched before they
// connected their account, etc).
export interface ManualWatchedItem {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  watched_at: string;
  title: string;
  poster_path: string | null;
}

export interface HomeRow {
  id: string;
  title: string;
  items: ContentItem[];
  loading?: boolean;
}
