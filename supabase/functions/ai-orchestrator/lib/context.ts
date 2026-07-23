import type { ActionContext, DNARow, TasteDNA, WatchedMovie, WatchedShow } from "../types.ts";
import { computeFingerprints } from "./cache.ts";
import { DEFAULT_MODEL, FALLBACK_MODEL } from "./constants.ts";

export async function assembleContext(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  body: Record<string, unknown>,
  openRouterKey: string,
): Promise<ActionContext> {
  // Sorted newest-first — the client sends raw Trakt order, which isn't
  // guaranteed to be recency order, so every downstream consumer that slices
  // "the first N" to mean "the most recent N" (prompts, fingerprinting) needs
  // this to actually be true.
  const byRecency = <T extends { last_watched_at: string }>(items: T[]) =>
    [...items].sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());

  const watchedMovies = byRecency((body.watchedMovies as WatchedMovie[]) ?? []);
  const watchedShows = byRecency((body.watchedShows as WatchedShow[]) ?? []);
  const watchlistIds = (body.watchlistIds as number[]) ?? [];
  const favoriteGenres = (body.favoriteGenres as number[]) ?? [];
  const modelOverride = typeof body.model === "string" ? body.model.trim() : undefined;

  const { data: dnaRow } = await admin
    .from("taste_dna")
    .select("taste_profile, genre_affinity, profile_metadata, rows, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  // The old system stored genre data in `rows[].genreIds` but never populated
  // `genre_affinity`. If it's empty, synthesize weights from the rows column.
  // deno-lint-ignore no-explicit-any
  function syntheticGenreAffinity(dnaRows: any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of dnaRows ?? []) {
      for (const gId of row.genreIds ?? []) {
        counts[String(gId)] = (counts[String(gId)] ?? 0) + 1;
      }
    }
    return counts;
  }

  const rawAffinity: Record<string, number> = dnaRow?.genre_affinity ?? {};
  const genreAffinity = Object.keys(rawAffinity).length > 0
    ? rawAffinity
    : syntheticGenreAffinity(dnaRow?.rows ?? []);

  const tasteDNA: TasteDNA | null = dnaRow
    ? {
        tasteProfile: dnaRow.taste_profile ?? "",
        genreAffinity,
        profile: dnaRow.profile_metadata?.profile ?? null,
        thematicInterests: dnaRow.profile_metadata?.thematicInterests ?? [],
        recentShift: dnaRow.profile_metadata?.recentShift ?? undefined,
      }
    : null;

  const tasteDNARows: DNARow[] = (dnaRow?.rows ?? []).filter(
    // deno-lint-ignore no-explicit-any
    (r: any) => r?.genreIds?.length && r?.title,
  ) as DNARow[];

  const dnaUpdatedAt: string | null = dnaRow?.updated_at ?? null;

  const fingerprints = computeFingerprints(dnaUpdatedAt, watchedMovies, watchedShows, watchlistIds);

  const primaryModel = modelOverride ?? DEFAULT_MODEL;
  const modelCascade = primaryModel === FALLBACK_MODEL ? [primaryModel] : [primaryModel, FALLBACK_MODEL];

  return {
    userId,
    admin,
    tasteDNA,
    tasteDNARows,
    dnaUpdatedAt,
    watchedMovies,
    watchedShows,
    watchlistIds,
    favoriteGenres,
    fingerprints,
    openRouterKey,
    primaryModel,
    modelCascade,
    rawBody: body,
  };
}
