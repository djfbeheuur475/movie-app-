// ─── Trakt types ──────────────────────────────────────────────────────────────

export interface TraktIds {
  tmdb?: number;
  trakt?: number;
  imdb?: string;
}

export interface WatchedMovie {
  movie: { title: string; year: number; ids: TraktIds };
  plays: number;
  last_watched_at: string;
}

export interface WatchedShow {
  show: { title: string; year: number; ids: TraktIds };
  plays: number;
  last_watched_at: string;
}

// ─── Taste DNA ────────────────────────────────────────────────────────────────

export interface TasteProfile {
  eraAffinity: Record<string, number>;
  darknessScore: number;
  prestigeScore: number;
  noveltyTolerance: number;
  pacingPreference: "slow" | "medium" | "fast";
  emotionalProfile?: string[];
  indieAffinity?: number;
}

export interface TasteDNA {
  tasteProfile?: string;
  genreAffinity?: Record<string, number>;
  profile?: TasteProfile | null;
  thematicInterests?: string[];
  recentShift?: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export interface Fingerprints {
  dna: string;
  history: string;
  watchlist: string;
}

export interface CacheMetadata {
  generatedAt: string;
  expiresAt: string;
  modelUsed: string;
  engineVersion: string;
  cacheVersion: number;
}

// ─── Recommendation types ─────────────────────────────────────────────────────

export type CandidateSource =
  | "discover"
  | "trending"
  | "new_releases"
  | "similar"
  | "hidden_gem"
  | "watchlist"
  | "search";

export interface RecommendationItem {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: number;
  confidence: number;
  novelty: number;
  source: CandidateSource;
  explanation: string;
  reason?: string;
  sectionId: string;
  rank: number;
  engineVersion: string;
  // Display fields carried from TMDB — client needs these for rendering
  posterPath?: string | null;
  backdropPath?: string | null;
  voteAverage?: number;
  genres?: number[];
}

// ─── Feed section types ───────────────────────────────────────────────────────

export type SectionType = "hero" | "row" | "spotlight";

export interface HeroSection {
  id: string;
  type: "hero";
  items: RecommendationItem[];
}

export interface RowSection {
  id: string;
  type: "row";
  heading: string;
  subheading: string;
  items: RecommendationItem[];
}

export interface SpotlightSection {
  id: string;
  type: "spotlight";
  heading: string;
  subheading: string;
  item: RecommendationItem;
}

export type Section = HeroSection | RowSection | SpotlightSection;

export interface HomeFeed {
  sections: Section[];
  generatedFor: string;
  cacheMetadata: CacheMetadata;
}

// ─── Brain → Candidate Builder types ─────────────────────────────────────────

export interface CandidateSpec {
  source: CandidateSource;
  mediaType: "movie" | "tv" | "both";
  genres?: number[];
  excludeGenres?: number[];
  keywords?: string[];
  minRating?: number;
  minVoteCount?: number;
  maxPopularity?: number;
  sortBy?: string;
  releaseDateGte?: string;
  releaseDateLte?: string;
  seedTmdbId?: number;
  era?: "classic" | "nineties" | "contemporary";
}

export interface SectionIntent {
  id: string;
  type: SectionType;
  theme: string;
  rationale: string;
  targetCount: number;
  candidateSpec: CandidateSpec;
}

export interface CandidateItem {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: number;
  voteAverage: number;
  popularity: number;
  genres: number[];
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
}

export interface CandidatePool {
  sectionIntent: SectionIntent;
  candidates: CandidateItem[];
}

// ─── Taste DNA row spec (from taste_dna.rows column) ─────────────────────────

export interface DNARow {
  title: string;
  subtitle: string;
  type: "movie" | "tv";
  genreIds: number[];
  sortBy: string;
  voteAverageGte: number;
  voteCountGte?: number;
}

// ─── Action context ───────────────────────────────────────────────────────────

export interface ActionContext {
  userId: string;
  // deno-lint-ignore no-explicit-any
  admin: any;
  tasteDNA: TasteDNA | null;
  tasteDNARows: DNARow[];
  dnaUpdatedAt: string | null;
  watchedMovies: WatchedMovie[];
  watchedShows: WatchedShow[];
  watchlistIds: number[];
  favoriteGenres: number[];
  fingerprints: Fingerprints;
  openRouterKey: string;
  primaryModel: string;
  modelCascade: string[];
  rawBody: Record<string, unknown>;
}
