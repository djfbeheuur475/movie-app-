// Smoke-test action: verifies auth, context assembly, cache I/O, fingerprinting,
// Brain intent generation, and Candidate Builder all work end-to-end.
// Pass "withCandidates": true in the body to also hit TMDB.

import type { ActionContext } from "../types.ts";
import { readCache, writeCache, isCacheValid } from "../lib/cache.ts";
import { GENRE_NAMES } from "../lib/constants.ts";
import { generateSectionIntents } from "../lib/brain/index.ts";
import { buildCandidatePools } from "../lib/candidates/index.ts";

export async function handlePing(ctx: ActionContext): Promise<Response> {
  const { userId, admin, tasteDNA, fingerprints } = ctx;

  const cached = await readCache(admin, userId, "ping");
  const cacheStatus = cached
    ? (isCacheValid(cached, fingerprints).valid ? "hit" : `stale:${isCacheValid(cached, fingerprints).reason}`)
    : "miss";

  // Write a short-lived entry to confirm upsert works
  await writeCache(admin, userId, "ping", { ok: true }, fingerprints, {
    modelUsed: "none",
    engineVersion: "v1",
    ttlHours: 1 / 60, // 1 minute
  });

  const topGenres = tasteDNA?.genreAffinity
    ? Object.entries(tasteDNA.genreAffinity)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 5)
        .map(([id, weight]) => ({ id: Number(id), name: GENRE_NAMES[Number(id)] ?? `genre-${id}`, weight }))
    : [];

  const sectionIntents = generateSectionIntents(ctx);

  // Optional: hit TMDB to verify candidate fetching (pass withCandidates: true)
  const withCandidates = ctx.rawBody.withCandidates === true;
  const tmdbKey = Deno.env.get("TMDB_API_KEY") ?? "";
  // deno-lint-ignore no-explicit-any
  let candidateSummary: any[] = [];

  if (withCandidates && tmdbKey) {
    const pools = await buildCandidatePools(sectionIntents, ctx, tmdbKey);
    candidateSummary = pools.map((p) => ({
      sectionId: p.sectionIntent.id,
      candidateCount: p.candidates.length,
      topThree: p.candidates.slice(0, 3).map((c) => `${c.title} (${c.year}) ${c.voteAverage.toFixed(1)}`),
    }));
  }

  return new Response(
    JSON.stringify({
      ok: true,
      userId,
      hasTasteDNA: !!tasteDNA,
      tasteProfileSnippet: tasteDNA?.tasteProfile?.slice(0, 120) ?? null,
      topGenres,
      fingerprintSummary: {
        dna: fingerprints.dna.slice(0, 24),
        historyCount: fingerprints.history ? fingerprints.history.split(",").length : 0,
        watchlistCount: fingerprints.watchlist ? fingerprints.watchlist.split(",").length : 0,
      },
      cacheStatus,
      sectionIntents: sectionIntents.map((s) => ({
        id: s.id,
        type: s.type,
        theme: s.theme,
        targetCount: s.targetCount,
        source: s.candidateSpec.source,
        mediaType: s.candidateSpec.mediaType,
        rationale: s.rationale,
      })),
      ...(withCandidates ? { candidateSummary, tmdbKeyPresent: !!tmdbKey } : {}),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
