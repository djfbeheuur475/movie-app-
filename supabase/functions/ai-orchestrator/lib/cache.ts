import type { Fingerprints, WatchedMovie, WatchedShow } from "../types.ts";
import { CURRENT_CACHE_VERSION, DEFAULT_CACHE_TTL_HOURS } from "./constants.ts";

const REGEN_HISTORY_THRESHOLD = 3;
const REGEN_WATCHLIST_THRESHOLD = 5;

export function computeFingerprints(
  dnaUpdatedAt: string | null,
  watchedMovies: WatchedMovie[],
  watchedShows: WatchedShow[],
  watchlistIds: number[],
): Fingerprints {
  const dna = dnaUpdatedAt ?? "none";

  // Last 20 watched items (movies + shows), sorted newest-first, keyed by TMDB ID.
  // Stored as a comma-separated string so diff-counting is possible without hashing.
  const allWatched = [
    ...watchedMovies
      .filter((m) => m.movie.ids.tmdb)
      .map((m) => ({ id: String(m.movie.ids.tmdb), date: m.last_watched_at })),
    ...watchedShows
      .filter((s) => s.show.ids.tmdb)
      .map((s) => ({ id: String(s.show.ids.tmdb), date: s.last_watched_at })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20)
    .map((x) => x.id);

  const history = allWatched.join(",");
  const watchlist = [...watchlistIds].sort((a, b) => a - b).join(",");

  return { dna, history, watchlist };
}

export interface CacheRow {
  payload: unknown;
  dna_fingerprint: string;
  history_fingerprint: string;
  watchlist_fingerprint: string;
  model_used: string;
  engine_version: string;
  cache_version: number;
  generated_at: string;
  expires_at: string;
}

// deno-lint-ignore no-explicit-any
export async function readCache(admin: any, userId: string, action: string): Promise<CacheRow | null> {
  const { data } = await admin
    .from("ai_cache")
    .select(
      "payload, dna_fingerprint, history_fingerprint, watchlist_fingerprint, " +
      "model_used, engine_version, cache_version, generated_at, expires_at",
    )
    .eq("user_id", userId)
    .eq("action", action)
    .maybeSingle();
  return data ?? null;
}

export interface CacheValidation {
  valid: boolean;
  reason?: string;
}

export function isCacheValid(cached: CacheRow, current: Fingerprints): CacheValidation {
  if (new Date(cached.expires_at) < new Date()) {
    return { valid: false, reason: "expired" };
  }

  if (cached.cache_version !== CURRENT_CACHE_VERSION) {
    return { valid: false, reason: "version_mismatch" };
  }

  if (cached.dna_fingerprint !== current.dna) {
    return { valid: false, reason: "dna_changed" };
  }

  // Count genuinely new watches (not seen when cache was generated)
  const storedHistorySet = new Set(cached.history_fingerprint.split(",").filter(Boolean));
  const currentHistoryIds = current.history.split(",").filter(Boolean);
  const newWatches = currentHistoryIds.filter((id) => !storedHistorySet.has(id));
  if (newWatches.length >= REGEN_HISTORY_THRESHOLD) {
    return { valid: false, reason: `${newWatches.length}_new_watches` };
  }

  // Count new watchlist additions
  const storedWatchlistSet = new Set(cached.watchlist_fingerprint.split(",").filter(Boolean));
  const currentWatchlistIds = current.watchlist.split(",").filter(Boolean);
  const newWatchlistItems = currentWatchlistIds.filter((id) => !storedWatchlistSet.has(id));
  if (newWatchlistItems.length >= REGEN_WATCHLIST_THRESHOLD) {
    return { valid: false, reason: `${newWatchlistItems.length}_new_watchlist_items` };
  }

  return { valid: true };
}

export interface WriteCacheOptions {
  modelUsed: string;
  engineVersion: string;
  ttlHours?: number;
}

export async function writeCache(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  action: string,
  payload: unknown,
  fingerprints: Fingerprints,
  opts: WriteCacheOptions,
): Promise<void> {
  const now = new Date();
  const ttl = opts.ttlHours ?? DEFAULT_CACHE_TTL_HOURS;
  const expiresAt = new Date(now.getTime() + ttl * 3_600_000);

  const { error } = await admin.from("ai_cache").upsert(
    {
      user_id: userId,
      action,
      payload,
      dna_fingerprint: fingerprints.dna,
      history_fingerprint: fingerprints.history,
      watchlist_fingerprint: fingerprints.watchlist,
      model_used: opts.modelUsed,
      engine_version: opts.engineVersion,
      cache_version: CURRENT_CACHE_VERSION,
      generated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "user_id,action" },
  );
  if (error) throw new Error(`upsert failed: ${error.message} (code=${error.code})`);
}
