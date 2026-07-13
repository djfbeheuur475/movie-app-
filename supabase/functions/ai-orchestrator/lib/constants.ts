export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const OR_SITE_HEADERS = {
  "HTTP-Referer": "https://nextup.app",
  "X-Title": "NextUp",
} as const;

export const DEFAULT_MODEL = "qwen/qwen3-14b";
export const FALLBACK_MODEL = "qwen/qwen3-8b";

export const CURRENT_CACHE_VERSION = 11; // bumped: trending movies fallback row, client caps at 4 rows, cache write error logging
export const DEFAULT_CACHE_TTL_HOURS = 6;

export const RATE_LIMITS: Record<string, number> = {
  ping: 1000,
  chat: 100,
  homepage: 10,
  recommendations: 50,
  taste_dna: 20,
  summaries: 50,
};

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

export const GENRE_NAMES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};
