// Curator Prompt — AI selects the best titles from pre-built TMDB candidate pools.
// AI only outputs tmdbIds from the supplied lists — hallucination is structurally impossible.
// Also outputs a one-line personalised reason per row shown to the viewer.

import type { ActionContext, ThemePool, ThemeSpec } from "../../types.ts";

function abbrevVotes(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

function formatPool(pool: ThemePool): string {
  const { themeSpec: spec, candidates } = pool;
  const header =
    `[${spec.id}] ${spec.display.heading} (${spec.retrieval.mediaType})` +
    (spec.slotType === "stretch" ? " ← STRETCH ROW" : "") +
    (spec.slotType === "discovery" ? " ← DISCOVERY ROW" : "");

  const rows = candidates
    .slice(0, 25) // 25 per pool × 6 pools = manageable context; curator only needs top candidates
    .map((c) => `${c.tmdbId}|${c.title}|${c.year}|★${c.voteAverage.toFixed(1)}|v:${abbrevVotes(c.voteCount)}`)
    .join("\n");

  return `${header}\n${rows}`;
}

function formatAllPools(pools: ThemePool[]): string {
  return pools
    .filter((p) => p.candidates.length > 0)
    .map(formatPool)
    .join("\n\n");
}

function formatRecentWatches(ctx: ActionContext): string {
  const movies = ctx.watchedMovies.slice(0, 12).map((m) => `${m.movie.title} (${m.movie.year})`);
  const shows = ctx.watchedShows.slice(0, 8).map((s) => `${s.show.title} (${s.show.year})`);
  return [...movies, ...shows].join(", ") || "nothing yet";
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildCuratorPrompt(
  themeSpecs: ThemeSpec[],
  pools: ThemePool[],
  ctx: ActionContext,
): { system: string; user: string } {
  const stretchId = themeSpecs.find((t) => t.slotType === "stretch")?.id;

  const system = `/no_think
You are the final curation layer of a film and TV recommendation engine. You have received pre-built pools of high-quality candidate titles for each themed row. Your job is to select the best 10 titles from each pool that will make the row feel cohesive, personally relevant, and editorially sharp.

STRICT RULES:
- You MUST output a row for EVERY pool listed below — do not skip any pool.
- Only output tmdbIds that appear in the supplied pool for that row. Any ID not in the pool will be silently discarded.
- Never repeat the same tmdbId across different rows.
- Order titles best-first within each row.
- Pick 10–12 titles per row (ordered best-first). If a pool has fewer than 10, pick all of them.
- For each row, write a single "reason" sentence (≤15 words) explaining in second-person why this row was chosen for the viewer. This is shown to the viewer and should feel personal.${stretchId ? `\n- For the STRETCH ROW [${stretchId}]: the reason must acknowledge it's intentionally outside their usual picks but explain why it will resonate with them specifically.` : ""}

OUTPUT: raw JSON only.

SCHEMA:
{"rows":[{"id":"t0","reason":"Because you gravitate toward morally complex narratives with slow-burn tension","tmdbIds":[12345,67890,...]},...]}`

  const taste = ctx.tasteDNA?.tasteProfile ?? "general film and TV enthusiast";

  const user = `VIEWER TASTE: ${taste}
RECENTLY WATCHED: ${formatRecentWatches(ctx)}

CANDIDATE POOLS (only pick tmdbIds from these lists):
${formatAllPools(pools)}

Curate each row. Pick titles that feel thematically coherent with the row heading, match the viewer's demonstrated taste level, and together tell a story about that row's editorial angle.`;

  return { system, user };
}
