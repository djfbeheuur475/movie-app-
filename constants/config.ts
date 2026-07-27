// All sensitive keys live in .env — never hardcode here
export const Config = {
  TMDB_BASE_URL: 'https://api.themoviedb.org/3',
  TMDB_IMAGE_BASE: 'https://image.tmdb.org/t/p',
  TRAKT_BASE_URL: 'https://api.trakt.tv',
  BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3001',
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  PRIVACY_POLICY_URL: 'https://djfbeheuur475.github.io/movie-app-/privacy-policy.html',
} as const;

export const ImageSizes = {
  poster: {
    thumb: `${Config.TMDB_IMAGE_BASE}/w185`,
    medium: `${Config.TMDB_IMAGE_BASE}/w342`,
    large: `${Config.TMDB_IMAGE_BASE}/w500`,
    original: `${Config.TMDB_IMAGE_BASE}/original`,
  },
  backdrop: {
    small: `${Config.TMDB_IMAGE_BASE}/w300`,
    medium: `${Config.TMDB_IMAGE_BASE}/w780`,
    large: `${Config.TMDB_IMAGE_BASE}/w1280`,
    original: `${Config.TMDB_IMAGE_BASE}/original`,
  },
  profile: {
    small: `${Config.TMDB_IMAGE_BASE}/w45`,
    medium: `${Config.TMDB_IMAGE_BASE}/w185`,
    large: `${Config.TMDB_IMAGE_BASE}/h632`,
  },
} as const;
