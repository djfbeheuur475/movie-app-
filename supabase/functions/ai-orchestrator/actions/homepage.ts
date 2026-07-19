// Homepage Action — 5-step pipeline:
// 1. Cache check
// 2. Read Trakt list catalog from DB (or fetch live if not yet indexed)
// 3. AI picks 6 lists that best match the user's taste profile
// 4. Fetch each list's items from Trakt → TMDB enrich → return feed
// 5. AI rewrites heading + subheading from the actual fetched titles
//
// Row items = first 30 unwatched items from the list, in list order

import type {
  ActionContext,
  HomeFeed,
  RecommendationItem,
  RowSection,
  Section,
} from "../types.ts";
import { readCache, writeCache, isCacheValid } from "../lib/cache.ts";
import { callOpenRouter } from "../lib/openrouter.ts";
import { fetchPopularLists, fetchListItems, tmdbDetail } from "../lib/trakt/index.ts";
import type { TaggedList } from "../lib/trakt/index.ts";
import { readCatalogIndex, writeCatalogIndex } from "../lib/trakt/catalog.ts";
import { buildListPickerPrompt } from "../lib/prompts/list-picker.ts";
import { buildRowCopyPrompt, parseRowCopyResponse } from "../lib/prompts/row-copy.ts";
import { generateSectionIntents } from "../lib/brain/index.ts";
import { buildCandidatePools } from "../lib/candidates/index.ts";
import { CURRENT_CACHE_VERSION, CORS_HEADERS, RATE_LIMITS } from "../lib/constants.ts";

const ENGINE_VERSION = "v4-trakt-lists";
const CACHE_TTL_HOURS = 24;

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

// deno-lint-ignore no-explicit-any
function tryParseJSON(raw: string): any | null {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(stripped);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_2) { return null; }
    }
    return null;
  }
}

async function callWithFallback(
  ctx: ActionContext,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  label: string,
): Promise<{ raw: string; model: string }> {
  for (const model of ctx.modelCascade) {
    try {
      const raw = await callOpenRouter({ key: ctx.openRouterKey, model, messages, maxTokens });
      if (raw) {
        console.log(`[homepage] ${label} from ${model}: ${raw.length} chars`);
        return { raw, model };
      }
    } catch (e: unknown) {
      console.warn(`[homepage] ${label} model ${model} failed: ${(e as Error).message?.slice(0, 80)}`);
    }
  }
  return { raw: "", model: "none" };
}

// ─── Parse AI list picks ──────────────────────────────────────────────────────

interface ListPick {
  id: number;
  reason: string;
}

function parsePickerResponse(raw: string, catalog: TaggedList[]): ListPick[] {
  const parsed = tryParseJSON(raw);
  if (!parsed?.picks || !Array.isArray(parsed.picks)) return [];

  const validIds = new Set(catalog.map((l) => l.id));
  return (parsed.picks as unknown[])
    // deno-lint-ignore no-explicit-any
    .filter((p: any) => typeof p?.id === "number" && validIds.has(p.id))
    .slice(0, 6)
    // deno-lint-ignore no-explicit-any
    .map((p: any): ListPick => ({ id: p.id as number, reason: String(p.reason ?? "") }));
}

// ─── Build one row from a Trakt list ─────────────────────────────────────────

async function buildRowFromList(
  pick: ListPick,
  catalog: TaggedList[],
  tmdbKey: string,
): Promise<Section | null> {
  const list = catalog.find((l) => l.id === pick.id);
  if (!list) return null;

  // Fetch list items from Trakt (in curation order)
  const listItems = await fetchListItems(pick.id);

  // Take first 80 as candidates — watched items are included and shown with a tick on the client
  const candidates = listItems.slice(0, 80);

  if (candidates.length === 0) {
    console.log(`[homepage] list ${pick.id} "${list.name}": no unwatched items`);
    return null;
  }

  // TMDB enrich in parallel
  const enriched = await Promise.allSettled(
    candidates.map((item) => tmdbDetail(item.tmdbId, item.mediaType, tmdbKey)),
  );

  const items: RecommendationItem[] = enriched
    .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof tmdbDetail>>>> =>
      r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value!)
    .filter((c) => c.voteAverage >= 5.0 && c.year > 0)
    .slice(0, 30)
    .map((c, rank): RecommendationItem => ({
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.title,
      year: c.year,
      confidence: 0.9,
      novelty: 0.7,
      source: "discover",
      explanation: pick.reason,
      sectionId: `list-${pick.id}`,
      rank,
      engineVersion: ENGINE_VERSION,
      posterPath: c.posterPath,
      backdropPath: c.backdropPath,
      voteAverage: c.voteAverage,
      genres: c.genres,
    }));

  console.log(`[homepage] list ${pick.id} "${list.name}": ${items.length} items`);
  if (items.length < 3) return null;

  const section: RowSection = {
    id: `list-${pick.id}`,
    type: "row",
    heading: list.name,
    subheading: pick.reason || list.description || "",
    items,
  };

  return section;
}

// ─── New-user fallback (TMDB trending, no AI) ────────────────────────────────

async function handleNewUser(ctx: ActionContext, tmdbKey: string): Promise<Response> {
  const intents = generateSectionIntents(ctx);
  const pools = await buildCandidatePools(intents, ctx, tmdbKey);
  const now = new Date();
  const sections: Section[] = pools
    .filter((p) => p.candidates.length > 0)
    .map((p): Section => ({
      id: p.sectionIntent.id,
      type: p.sectionIntent.type === "hero" ? "hero" : "row",
      heading: p.sectionIntent.theme,
      subheading: "",
      items: p.candidates.slice(0, 10).map((c, rank): RecommendationItem => ({
        tmdbId: c.tmdbId, mediaType: c.mediaType, title: c.title, year: c.year,
        confidence: 0.7, novelty: 0.3, source: "trending",
        explanation: "", sectionId: p.sectionIntent.id, rank, engineVersion: `${ENGINE_VERSION}-newuser`,
        posterPath: c.posterPath, backdropPath: c.backdropPath,
        voteAverage: c.voteAverage, genres: c.genres,
      })),
    }));
  const feed: HomeFeed = {
    sections,
    generatedFor: now.toLocaleDateString("en-AU", { weekday: "long", month: "long", year: "numeric" }),
    cacheMetadata: {
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
      modelUsed: "none", engineVersion: `${ENGINE_VERSION}-newuser`,
      cacheVersion: CURRENT_CACHE_VERSION,
    },
  };
  return jsonOk(feed);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleHomepage(ctx: ActionContext): Promise<Response> {
  const { userId, admin, fingerprints, openRouterKey } = ctx;
  const tmdbKey = Deno.env.get("TMDB_API_KEY") ?? "";
  const clientDateKey = typeof ctx.rawBody.clientDateKey === "string" ? ctx.rawBody.clientDateKey : undefined;

  if (!openRouterKey) return jsonError("AI service not configured", 503);
  if (!tmdbKey) return jsonError("TMDB not configured", 503);

  // 1. Cache check
  const cached = await readCache(admin, userId, "homepage");
  if (cached) {
    const v = isCacheValid(cached, fingerprints, clientDateKey);
    if (v.valid) {
      console.log(`[homepage] cache hit user=${userId.slice(0, 8)}`);
      return jsonOk(cached.payload as HomeFeed);
    }
    console.log(`[homepage] cache stale: ${v.reason}`);
  }

  // Only a genuine regeneration consumes quota — cache hits above returned
  // already. Checked here (not in index.ts) specifically so routine repeat
  // opens can't burn through the daily limit before any real AI work runs.
  const { data: allowed, error: rlErr } = await admin.rpc("check_ai_rate_limit", {
    p_user_id: userId,
    p_action: "homepage",
    p_limit: RATE_LIMITS.homepage ?? 50,
  });
  if (rlErr) console.error(`[homepage] rate limit check error:`, rlErr.message);
  if (allowed === false) return jsonError("Daily limit reached for action 'homepage'", 429);

  const startMs = Date.now();
  const hasDNA = ctx.tasteDNA !== null &&
    (ctx.watchedMovies.length > 0 || ctx.watchedShows.length > 0);

  if (!hasDNA) {
    console.log(`[homepage] new user — serving trending content`);
    return handleNewUser(ctx, tmdbKey);
  }

  // 2. Get Trakt list catalog: pre-indexed DB first, live fetch fallback
  let catalog: TaggedList[] = [];
  const indexed = await readCatalogIndex(admin).catch(() => null);
  if (indexed && indexed.length > 0) {
    catalog = indexed;
    console.log(`[homepage] catalog: ${catalog.length} lists from DB (${Date.now() - startMs}ms)`);
  } else {
    console.log(`[homepage] catalog not indexed — fetching live from Trakt`);
    const lists = await fetchPopularLists().catch(() => []);
    catalog = lists.map((l) => ({ ...l, tags: [], mediaType: "mixed" as const }));
    if (catalog.length > 0) {
      // Write to DB in background — don't block the response
      writeCatalogIndex(admin, catalog).catch((e: Error) =>
        console.warn("[homepage] catalog write failed:", e.message)
      );
    }
    console.log(`[homepage] live catalog: ${catalog.length} lists (${Date.now() - startMs}ms)`);
  }

  if (catalog.length === 0) {
    console.warn("[homepage] no catalog available — returning new-user fallback");
    return handleNewUser(ctx, tmdbKey);
  }

  // Exclude whatever was shown across the last few cycles — a stable taste
  // profile makes the picker gravitate to the same handful of best-matching
  // lists every time otherwise. A single-cycle exclusion only stopped it from
  // repeating immediately, but let strong favourites bounce back every other
  // regeneration — so this carries a rolling history forward across cycles.
  const RECENT_LIST_HISTORY_SIZE = 24; // ~4 cycles of 6 picks
  const priorFeed = cached?.payload as HomeFeed | undefined;
  const priorRollingIds = priorFeed?.cacheMetadata?.recentListIds ?? [];
  const priorSectionIds = (priorFeed?.sections ?? [])
    .map((s) => (s.id.startsWith("list-") ? Number(s.id.slice(5)) : null))
    .filter((id): id is number => id !== null);
  const previousListIds = new Set([...priorRollingIds, ...priorSectionIds]);
  const freshCatalog = previousListIds.size > 0
    ? catalog.filter((l) => !previousListIds.has(l.id))
    : catalog;
  console.log(`[homepage] excluding ${previousListIds.size} recently-shown lists — ${freshCatalog.length}/${catalog.length} remain`);

  // 3. AI picks 6 lists from the catalog based on the user's taste profile
  const { system: pickerSystem, user: pickerUser } = buildListPickerPrompt(freshCatalog, ctx);
  const { raw: pickerRaw, model: pickerModel } = await callWithFallback(
    ctx,
    [{ role: "system", content: pickerSystem }, { role: "user", content: pickerUser }],
    300,
    "list-picker",
  );

  const picks = parsePickerResponse(pickerRaw, freshCatalog);
  console.log(`[homepage] AI picked ${picks.length} lists: [${picks.map((p) => p.id).join(",")}] (${Date.now() - startMs}ms)`);

  if (picks.length === 0) {
    console.warn("[homepage] no valid list picks — returning new-user fallback");
    return handleNewUser(ctx, tmdbKey);
  }

  // 4. Fetch + enrich all 6 lists in parallel
  const rowResults = await Promise.allSettled(
    picks.map((pick) => buildRowFromList(pick, catalog, tmdbKey)),
  );

  const sections: Section[] = rowResults
    .filter((r): r is PromiseFulfilledResult<Section | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s): s is Section => s !== null);

  if (sections.length === 0) {
    console.warn("[homepage] no sections built — returning new-user fallback");
    return handleNewUser(ctx, tmdbKey);
  }

  // 5. Rewrite each row's heading + subheading from its ACTUAL fetched titles.
  // The raw Trakt list name is often flat/generic ("Sci-Fi", "Comedy") or
  // mislabelled, so copy written from the name alone reads dull or describes
  // content that isn't really there. This grounds both lines in real titles.
  try {
    const rowSections = sections.filter((s): s is RowSection => s.type === "row");
    const copyInputs = rowSections.map((s) => ({
      id: s.id,
      listName: s.heading,
      titles: s.items.slice(0, 12).map((it) => it.title),
    }));
    if (copyInputs.length > 0) {
      const { system: copySystem, user: copyUser } = buildRowCopyPrompt(copyInputs);
      const { raw: copyRaw } = await callWithFallback(
        ctx,
        [{ role: "system", content: copySystem }, { role: "user", content: copyUser }],
        500,
        "row-copy",
      );
      const refined = parseRowCopyResponse(copyRaw);
      for (const s of rowSections) {
        const copy = refined[s.id];
        if (copy?.heading) s.heading = copy.heading;
        if (copy?.subheading) s.subheading = copy.subheading;
      }
    }
  } catch (e) {
    console.warn("[homepage] row copy refine failed, keeping original:", (e as Error).message);
  }

  // 6. Cache and return
  const now = new Date();
  const updatedRollingIds = [...new Set([...previousListIds, ...picks.map((p) => p.id)])]
    .slice(-RECENT_LIST_HISTORY_SIZE);
  const feed: HomeFeed = {
    sections,
    generatedFor: now.toLocaleDateString("en-AU", { weekday: "long", month: "long", year: "numeric" }),
    cacheMetadata: {
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CACHE_TTL_HOURS * 3_600_000).toISOString(),
      modelUsed: pickerModel,
      engineVersion: ENGINE_VERSION,
      cacheVersion: CURRENT_CACHE_VERSION,
      recentListIds: updatedRollingIds,
      clientDateKey,
    },
  };

  await writeCache(admin, userId, "homepage", feed, fingerprints, {
    modelUsed: pickerModel,
    engineVersion: ENGINE_VERSION,
    ttlHours: CACHE_TTL_HOURS,
  }).catch((e: Error) => console.warn("[homepage] cache write failed:", e.message));

  const totalItems = sections.reduce((s, r) => s + (r.type === "row" ? r.items.length : 0), 0);
  console.log(`[homepage] done in ${Date.now() - startMs}ms — ${sections.length} rows, ${totalItems} items`);
  return jsonOk(feed);
}
