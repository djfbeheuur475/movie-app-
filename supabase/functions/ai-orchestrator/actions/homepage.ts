import type {
  ActionContext,
  CandidateItem,
  CandidatePool,
  HomeFeed,
  RecommendationItem,
  Section,
} from "../types.ts";
import { readCache, writeCache, isCacheValid } from "../lib/cache.ts";
import { generateSectionIntents } from "../lib/brain/index.ts";
import { buildCandidatePools } from "../lib/candidates/index.ts";
import { callOpenRouter } from "../lib/openrouter.ts";
import { buildHomepagePrompt } from "../lib/prompts/homepage.ts";
import { CURRENT_CACHE_VERSION, CORS_HEADERS } from "../lib/constants.ts";

const ENGINE_VERSION = "v1";
const CACHE_TTL_HOURS = 6;

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonError(msg: string, status: number): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ─── Candidate pool → Section (no AI curation, raw top-N candidates) ─────────

function poolToSection(pool: CandidatePool, evSuffix = ""): Section {
  const intent = pool.sectionIntent;
  const makeItem = (c: CandidateItem, rank: number): RecommendationItem => ({
    tmdbId: c.tmdbId,
    mediaType: c.mediaType,
    title: c.title,
    year: c.year,
    confidence: 0.7,
    novelty: c.popularity < 20 ? 0.8 : 0.3,
    source: intent.candidateSpec.source,
    explanation: "",
    sectionId: intent.id,
    rank,
    engineVersion: `${ENGINE_VERSION}${evSuffix}`,
    posterPath: c.posterPath,
    backdropPath: c.backdropPath,
    voteAverage: c.voteAverage,
    genres: c.genres,
  });

  if (intent.type === "hero") {
    return { id: intent.id, type: "hero", items: pool.candidates.slice(0, 3).map(makeItem) };
  }
  if (intent.type === "spotlight") {
    return {
      id: intent.id, type: "spotlight",
      heading: intent.theme, subheading: "",
      item: makeItem(pool.candidates[0], 0),
    };
  }
  return {
    id: intent.id, type: "row",
    heading: intent.theme, subheading: "",
    items: pool.candidates.slice(0, 8).map(makeItem),
  };
}

// ─── Fallback feed (used when AI parsing completely fails) ────────────────────

function buildFallbackFeed(pools: CandidatePool[], modelUsed: string): HomeFeed {
  const now = new Date();
  const sections = pools.filter((p) => p.candidates.length > 0).map((p) => poolToSection(p, "-fallback"));

  return {
    sections,
    generatedFor: now.toLocaleDateString("en-AU", { weekday: "long", month: "long", year: "numeric" }),
    cacheMetadata: {
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_HOURS * 3_600_000).toISOString(),
      modelUsed: `${modelUsed}-fallback`,
      engineVersion: `${ENGINE_VERSION}-fallback`,
      cacheVersion: CURRENT_CACHE_VERSION,
    },
  };
}

// ─── Parse AI curator response into HomeFeed ──────────────────────────────────

// deno-lint-ignore no-explicit-any
interface CuratorSection { id: string; type: string; heading?: string; reason?: string; tmdbIds?: number[]; [k: string]: any; }
interface CuratorResponse { sections: CuratorSection[] }

function parseCuratorResponse(
  raw: string,
  pools: CandidatePool[],
  modelUsed: string,
): HomeFeed {
  // tmdbId → CandidateItem (any media type), and pool lookup
  const candidateById = new Map<number, CandidateItem>();
  const poolMap = new Map<string, CandidatePool>();
  for (const pool of pools) {
    poolMap.set(pool.sectionIntent.id, pool);
    for (const c of pool.candidates) candidateById.set(c.tmdbId, c);
  }

  let parsed: CuratorResponse | null = null;
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    parsed = JSON.parse(stripped);
  } catch (e) {
    console.warn("[homepage] parse failed:", (e as Error).message.slice(0, 80));
  }

  const sections: Section[] = [];

  for (const s of parsed?.sections ?? []) {
    const pool = poolMap.get(s.id);
    if (!pool) continue;
    const intent = pool.sectionIntent;

    // AI returns tmdbIds array — look up each in the pool's candidates
    const poolCandidateIds = new Set(pool.candidates.map((c) => c.tmdbId));
    const selectedIds: number[] = (s.tmdbIds ?? []).filter((id: number) => poolCandidateIds.has(id));

    // Fall back to pool order if AI returned nothing valid
    const orderedIds = selectedIds.length > 0
      ? selectedIds
      : pool.candidates.map((c) => c.tmdbId);

    const items: RecommendationItem[] = orderedIds
      .slice(0, intent.type === "hero" ? 3 : 8)
      .map((id, rank): RecommendationItem | null => {
        const c = candidateById.get(id);
        if (!c) return null;
        return {
          tmdbId: c.tmdbId, mediaType: c.mediaType, title: c.title, year: c.year,
          confidence: 0.8, novelty: c.popularity < 20 ? 0.8 : 0.3,
          source: intent.candidateSpec.source,
          explanation: "", reason: intent.type !== "row" ? (s.reason ?? "") : undefined,
          sectionId: intent.id, rank, engineVersion: ENGINE_VERSION,
          posterPath: c.posterPath, backdropPath: c.backdropPath,
          voteAverage: c.voteAverage, genres: c.genres,
        };
      })
      .filter((i): i is RecommendationItem => i !== null);

    if (!items.length) continue;

    const heading = s.heading ?? intent.theme;
    if (intent.type === "hero") {
      sections.push({ id: s.id, type: "hero", items });
    } else if (intent.type === "row") {
      sections.push({ id: s.id, type: "row", heading, subheading: s.reason ?? "", items });
    } else if (intent.type === "spotlight") {
      sections.push({ id: s.id, type: "spotlight", heading, subheading: "", item: items[0] });
    }
  }

  if (!sections.length) {
    console.warn("[homepage] no valid sections from AI, using full fallback");
    return buildFallbackFeed(pools, modelUsed);
  }

  // Guarantee every pool is represented — fill in anything AI skipped
  const curatedIds = new Set(sections.map((s) => s.id));
  let supplemented = 0;
  for (const pool of pools) {
    if (!curatedIds.has(pool.sectionIntent.id) && pool.candidates.length > 0) {
      sections.push(poolToSection(pool, "-supplemented"));
      supplemented++;
    }
  }
  if (supplemented > 0) console.log(`[homepage] supplemented ${supplemented} sections`);

  const now = new Date();
  return {
    sections,
    generatedFor: now.toLocaleDateString("en-AU", { weekday: "long", month: "long", year: "numeric" }),
    cacheMetadata: {
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_HOURS * 3_600_000).toISOString(),
      modelUsed, engineVersion: ENGINE_VERSION, cacheVersion: CURRENT_CACHE_VERSION,
    },
  };
}

function buildItem(
  item: CuratorItem,
  candidate: CandidateItem,
  sectionId: string,
  source: RecommendationItem["source"],
  rank: number,
): RecommendationItem {
  return {
    tmdbId: candidate.tmdbId,
    mediaType: candidate.mediaType,
    title: candidate.title,
    year: candidate.year,
    confidence: Math.min(1, Math.max(0, item.confidence ?? 0.7)),
    novelty: Math.min(1, Math.max(0, item.novelty ?? 0.4)),
    source,
    explanation: (item.explanation ?? "").trim(),
    reason: item.reason?.trim(),
    sectionId,
    rank,
    engineVersion: ENGINE_VERSION,
    posterPath: candidate.posterPath,
    backdropPath: candidate.backdropPath,
    voteAverage: candidate.voteAverage,
    genres: candidate.genres,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleHomepage(ctx: ActionContext): Promise<Response> {
  const { userId, admin, fingerprints, openRouterKey, tasteDNA } = ctx;

  const tmdbKey = Deno.env.get("TMDB_API_KEY") ?? "";
  if (!openRouterKey) return jsonError("AI service not configured", 503);
  if (!tmdbKey) return jsonError("TMDB not configured", 503);

  // 1. Cache check
  const cached = await readCache(admin, userId, "homepage");
  if (cached) {
    const v = isCacheValid(cached, fingerprints);
    if (v.valid) {
      console.log(`[homepage] cache hit user=${userId.slice(0, 8)}`);
      return jsonOk(cached.payload as HomeFeed);
    }
    console.log(`[homepage] cache stale: ${v.reason}`);
  }

  const startMs = Date.now();

  // 2. Brain → SectionIntents
  const intents = generateSectionIntents(ctx);
  console.log(`[homepage] brain produced ${intents.length} section intents`);

  // 3. Candidate Builder → CandidatePools (parallel TMDB calls)
  const allPools = await buildCandidatePools(intents, ctx, tmdbKey);
  const pools = allPools.filter((p) => p.candidates.length > 0);
  console.log(`[homepage] ${pools.length}/${allPools.length} pools have candidates (${Date.now() - startMs}ms)`);

  if (!pools.length) {
    return jsonError("No candidates available", 503);
  }

  // 4. AI Curator — one OpenRouter call with all pools
  const { system, user } = buildHomepagePrompt(pools, tasteDNA);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let rawResponse = "";
  let modelUsed = ctx.primaryModel;

  for (const model of ctx.modelCascade) {
    try {
      rawResponse = await callOpenRouter({
        key: openRouterKey,
        model,
        messages,
        maxTokens: 800,
      });
      modelUsed = model;
      console.log(`[homepage] curator response ${rawResponse.length} chars (${Date.now() - startMs}ms total)`);
      break;
    } catch (e: unknown) {
      console.warn(`[homepage] model ${model} failed: ${(e as Error).message?.slice(0, 120)}`);
    }
  }

  if (!rawResponse) {
    console.warn("[homepage] all models failed, returning fallback feed");
    return jsonOk(buildFallbackFeed(pools, "none"));
  }

  // 5. Parse into HomeFeed
  const feed = parseCuratorResponse(rawResponse, pools, modelUsed);

  // 6. Store to cache (synchronous — fire-and-forget gets killed with the request)
  await writeCache(admin, userId, "homepage", feed, fingerprints, {
    modelUsed,
    engineVersion: ENGINE_VERSION,
    ttlHours: CACHE_TTL_HOURS,
  }).catch((e: Error) => console.warn("[homepage] cache write failed:", e.message));

  console.log(`[homepage] done in ${Date.now() - startMs}ms sections=${feed.sections.length}`);
  return jsonOk(feed);
}
