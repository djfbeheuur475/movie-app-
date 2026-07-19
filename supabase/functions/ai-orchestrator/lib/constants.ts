export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const OR_SITE_HEADERS = {
  "HTTP-Referer": "https://nextup.app",
  "X-Title": "NextUp",
} as const;

export const DEFAULT_MODEL = "qwen/qwen3-14b";
export const FALLBACK_MODEL = "qwen/qwen3-8b";

export const CURRENT_CACHE_VERSION = 38; // v4-trakt-lists: AI picks 6 Trakt lists by name+description, personal_picks removed
export const DEFAULT_CACHE_TTL_HOURS = 24;

// ─── Candidate quality floors ─────────────────────────────────────────────────

export const QUALITY = {
  movie: { minVoteCount: 10_000, minRating: 7.0 },
  tv:    { minVoteCount:  5_000, minRating: 7.0 },
  // widening pass — relaxed but still credible
  wide:  { minVoteCount:  3_000, minRating: 6.5 },
} as const;

export const POOL_TARGET_SIZE = 60;          // desired candidates per theme before curation
export const DISCOVERY_VOTE_CAP = 150_000;  // max votes for "overlooked" themes

// ─── TMDB genre name → ID (AI outputs names, backend maps to IDs) ─────────────

export const GENRE_IDS: Record<string, number> = {
  "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35,
  "Crime": 80, "Documentary": 99, "Drama": 18, "Family": 10751,
  "Fantasy": 14, "History": 36, "Horror": 27, "Music": 10402,
  "Mystery": 9648, "Romance": 10749, "Science Fiction": 878,
  "Sci-Fi": 878, "Thriller": 53, "War": 10752, "Western": 37,
  "Action & Adventure": 10759, "Kids": 10762, "Reality": 10764,
  "Sci-Fi & Fantasy": 10765, "War & Politics": 10768,
};

export const RATE_LIMITS: Record<string, number> = {
  ping: 1000,
  chat: 100,
  homepage: 50,
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
