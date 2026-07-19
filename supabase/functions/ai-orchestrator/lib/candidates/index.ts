// Candidate Pool Builder — multi-source, per-theme.
//
// For EDITORIAL themes (festival, hidden, awards): Trakt public lists are the primary pool.
//   Community-curated lists give precision that algorithmic TMDB filtering cannot.
// For GENRE-BASED themes: TMDB discover with strategy-specific sort and quality filters.
//   sortStrategy controls which combination of popularity/quality/recency sorts to run.
//
// Both paths merge into a composite-scored candidate list for the curation AI.

import type {
  ActionContext,
  CandidateItem,
  CandidatePool,
  CandidateSpec,
  SectionIntent,
  ThemePool,
  ThemeSpec,
} from "../../types.ts";
import { QUALITY, POOL_TARGET_SIZE, DISCOVERY_VOTE_CAP, GENRE_IDS } from "../constants.ts";
import { resolveGenreIds, eraToDateParams } from "../themes/index.ts";
import { buildTraktPool } from "../trakt/index.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";

// ─── TMDB helper ──────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>, key: string): Promise<any> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 9_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

// ─── Result mappers ───────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function mapMovie(r: any): CandidateItem {
  return {
    tmdbId: r.id, mediaType: "movie",
    title: r.title ?? r.original_title ?? "",
    year: parseInt((r.release_date ?? "").split("-")[0]) || 0,
    voteAverage: r.vote_average ?? 0, voteCount: r.vote_count ?? 0,
    popularity: r.popularity ?? 0, genres: r.genre_ids ?? [],
    overview: r.overview ?? "", posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
  };
}

// deno-lint-ignore no-explicit-any
function mapTV(r: any): CandidateItem {
  return {
    tmdbId: r.id, mediaType: "tv",
    title: r.name ?? r.original_name ?? "",
    year: parseInt((r.first_air_date ?? "").split("-")[0]) || 0,
    voteAverage: r.vote_average ?? 0, voteCount: r.vote_count ?? 0,
    popularity: r.popularity ?? 0, genres: r.genre_ids ?? [],
    overview: r.overview ?? "", posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
  };
}

// ─── Composite score ──────────────────────────────────────────────────────────
// Primary signal: quality (vote_average)
// Credibility: log-compressed vote count (diminishing returns above ~100k votes)
// Recency nudge: small popularity bonus so newer quality films aren't buried

function compositeScore(c: CandidateItem): number {
  const quality = c.voteAverage;
  const credibility = Math.log10(Math.max(c.voteCount, 1));
  const recencyNudge = 1 + 0.05 * Math.min(c.popularity / 200, 1);
  return quality * credibility * recencyNudge;
}

// ─── Discover fetcher (single page) ──────────────────────────────────────────

async function discoverPage(
  mediaType: "movie" | "tv",
  params: Record<string, string>,
  page: number,
  key: string,
): Promise<CandidateItem[]> {
  try {
    const data = await tmdbGet(`/discover/${mediaType}`, { ...params, page: String(page) }, key);
    // deno-lint-ignore no-explicit-any
    return (data.results ?? []).map(mediaType === "movie" ? mapMovie : mapTV);
  } catch (e) {
    console.warn(`[candidates] discover/${mediaType} p${page} failed: ${(e as Error).message?.slice(0, 60)}`);
    return [];
  }
}

async function discoverPages(
  mediaType: "movie" | "tv",
  params: Record<string, string>,
  pages: number[],
  key: string,
): Promise<CandidateItem[]> {
  const settled = await Promise.allSettled(pages.map((p) => discoverPage(mediaType, params, p, key)));
  return settled
    .filter((r): r is PromiseFulfilledResult<CandidateItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

// ─── Trending fetcher (for hero / new-user path) ──────────────────────────────

async function fetchTrending(mediaType: "movie" | "tv", key: string): Promise<CandidateItem[]> {
  try {
    const data = await tmdbGet(`/trending/${mediaType}/week`, {}, key);
    // deno-lint-ignore no-explicit-any
    return (data.results ?? []).map(mediaType === "movie" ? mapMovie : mapTV);
  } catch (e) {
    console.warn(`[candidates] trending/${mediaType} failed: ${(e as Error).message?.slice(0, 60)}`);
    return [];
  }
}

// ─── Merge + dedup ────────────────────────────────────────────────────────────

function mergeAndDedup(lists: CandidateItem[][]): CandidateItem[] {
  const seen = new Set<number>();
  const result: CandidateItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.tmdbId)) {
        seen.add(item.tmdbId);
        result.push(item);
      }
    }
  }
  return result;
}

// ─── Per-theme pool fetch ─────────────────────────────────────────────────────

async function fetchThemePool(
  spec: ThemeSpec,
  watchedIds: Set<number>,
  watchlistIds: Set<number>,
  tmdbKey: string,
  floors: { minVoteCount: number; minRating: number },
  wide = false,
): Promise<CandidateItem[]> {
  const { retrieval } = spec;
  const mt = retrieval.mediaType;
  const isMovie = mt === "movie";

  const primaryIds = resolveGenreIds(retrieval.primaryGenres);
  const secondaryIds = resolveGenreIds(retrieval.secondaryGenres);
  const excludeIds = spec.slotType === "stretch"
    ? (spec as ThemeSpec & { excludeTopGenreIds?: number[] })
      // excludeTopGenreIds is on SlotDefinition, not ThemeSpec — pass it as extra field
      // or handle at caller level
      ? [] : []
    : [];

  const allGenreIds = wide
    ? [...new Set([...primaryIds, ...secondaryIds])]
    : primaryIds;

  const dateParams = eraToDateParams(retrieval.era, mt);

  const baseParams: Record<string, string> = {
    include_adult: "false",
    "vote_count.gte": String(floors.minVoteCount),
    "vote_average.gte": String(floors.minRating),
    ...dateParams,
  };

  if (allGenreIds.length > 0) {
    baseParams.with_genres = allGenreIds.join(",");
  }

  if (excludeIds.length > 0) {
    baseParams.without_genres = excludeIds.join(",");
  }

  if (retrieval.discovery) {
    baseParams["vote_count.lte"] = String(DISCOVERY_VOTE_CAP);
  }

  // Strategy A: popularity.desc (currently relevant quality films)
  const paramsA = { ...baseParams, sort_by: "popularity.desc" };

  // Strategy B: acclaimed (sort by rating among high-vote-count titles)
  const acclaimedVoteFloor = isMovie ? "50000" : "20000";
  const paramsB = {
    ...baseParams,
    sort_by: "vote_average.desc",
    "vote_count.gte": String(Math.max(floors.minVoteCount, Number(acclaimedVoteFloor))),
  };
  // Discovery themes: use vote_count.desc to find most-reviewed hidden gems
  const paramsC = retrieval.discovery
    ? { ...baseParams, sort_by: "vote_count.desc" }
    : null;

  // Fetch pages in parallel — Strategy A gets 3 pages, B gets 2, C (discovery) gets 2
  const [rawA, rawB, rawC] = await Promise.all([
    discoverPages(mt, paramsA, [1, 2, 3], tmdbKey),
    discoverPages(mt, paramsB, [1, 2], tmdbKey),
    paramsC ? discoverPages(mt, paramsC, [1, 2], tmdbKey) : Promise.resolve([]),
  ]);

  const merged = mergeAndDedup([rawA, rawB, rawC]);

  // Apply quality floor + remove watched + remove watchlist
  const filtered = merged.filter(
    (c) =>
      c.voteAverage >= floors.minRating &&
      c.voteCount >= floors.minVoteCount &&
      !watchedIds.has(c.tmdbId) &&
      !watchlistIds.has(c.tmdbId),
  );

  // Composite-score and sort
  filtered.sort((a, b) => compositeScore(b) - compositeScore(a));

  return filtered;
}

// ─── Genre query variants ─────────────────────────────────────────────────────
// TMDB's with_genres uses AND logic — `53,18` returns only films tagged as BOTH
// Thriller AND Drama, which cuts the pool dramatically for narrow themes.
// We run separate queries per genre combination and merge the results.

function genreQueryVariants(primaryIds: number[], secondaryIds: number[]): number[][] {
  const variants: number[][] = [];

  // AND of all primaries (most specific — use if multiple primaries)
  if (primaryIds.length > 1) variants.push([...primaryIds]);

  // Each primary genre independently (broadest reach)
  for (const id of primaryIds) variants.push([id]);

  // First primary + first secondary (cross-genre blend)
  if (primaryIds.length > 0 && secondaryIds.length > 0) {
    variants.push([primaryIds[0], secondaryIds[0]]);
  }

  // Each secondary independently (additional coverage)
  for (const id of secondaryIds.slice(0, 2)) {
    if (!primaryIds.includes(id)) variants.push([id]);
  }

  // Deduplicate by stringified form
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = [...v].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return v.length > 0;
  });
}

// ─── Theme pool builder (main export) ────────────────────────────────────────

export async function buildThemePools(
  themeSpecs: ThemeSpec[],
  watchedIds: Set<number>,
  watchlistIds: Set<number>,
  tmdbKey: string,
  excludeGenresByThemeId: Map<string, number[]> = new Map(),
): Promise<ThemePool[]> {
  const pools = await Promise.all(
    themeSpecs.map(async (spec): Promise<ThemePool> => {
      const mt = spec.retrieval.mediaType;
      const isMovie = mt === "movie";
      const qualFloors = mt === "movie" ? QUALITY.movie : QUALITY.tv;
      const excludeIds = excludeGenresByThemeId.get(spec.id) ?? [];

      try {
        // ─── Trakt path: AI selected specific curated lists ───────────────────
        // Use Trakt exclusively — the list IS the editorial curation, no TMDB mixing.
        // Fall through to TMDB discover only if Trakt returns too few items.
        if ((spec.retrieval.traktListIds?.length ?? 0) > 0) {
          const traktCandidates = await buildTraktPool(
            spec.retrieval.traktListIds!,
            mt,
            spec.retrieval.minRating,
            watchedIds,
            watchlistIds,
            tmdbKey,
          );
          if (traktCandidates.length >= 5) {
            // Preserve list order (buildTraktPool returns items in the order they
            // appear in the source Trakt lists) — sorting by rating here caused
            // the same acclaimed titles to dominate the top-25 slice every time.
            console.log(`[candidates] ${spec.id} (${spec.slotType}/trakt): ${traktCandidates.length} candidates`);
            return { themeSpec: spec, candidates: traktCandidates };
          }
          console.warn(`[candidates] ${spec.id} Trakt returned only ${traktCandidates.length} — falling back to TMDB discover`);
        }

        // ─── TMDB Discover path ───────────────────────────────────────────────
        const primaryIds = resolveGenreIds(spec.retrieval.primaryGenres);
        const secondaryIds = resolveGenreIds(spec.retrieval.secondaryGenres);
        const dateParams = eraToDateParams(spec.retrieval.era, mt);
        const sortStrat = spec.retrieval.sortStrategy ?? "popular";

        // Vote floor — theme spec can lower for truly obscure content
        const voteFloor = spec.retrieval.minVoteCount ?? qualFloors.minVoteCount;

        // Vote cap — explicit maxVoteCount wins, then discovery flag, then none
        const voteCap = spec.retrieval.maxVoteCount ??
          (spec.retrieval.discovery ? DISCOVERY_VOTE_CAP : undefined);

        // Base params shared by all strategies for this theme
        // Popularity cap: AI-specified maxPopularity OR strategy defaults for hidden content.
        // TMDB popularity is a rolling score (decays with inactivity), making it far more
        // reliable than vote_count for detecting "currently overlooked" content.
        const popularityCap = spec.retrieval.maxPopularity ??
          (sortStrat === "hidden" ? 30 : undefined);

        const baseParams: Record<string, string> = {
          include_adult: "false",
          "vote_count.gte": String(voteFloor),
          "vote_average.gte": String(spec.retrieval.minRating),
          ...dateParams,
        };
        if (voteCap !== undefined) baseParams["vote_count.lte"] = String(voteCap);
        if (popularityCap !== undefined) baseParams["popularity.lte"] = String(popularityCap);
        if (excludeIds.length > 0) baseParams.without_genres = excludeIds.join(",");
        if (spec.retrieval.originalLanguage) {
          baseParams.with_original_language = spec.retrieval.originalLanguage;
        }

        const variants = genreQueryVariants(primaryIds, secondaryIds);
        const allFetches: Promise<CandidateItem[]>[] = [];

        // Acclaimed floor: only raised for non-hidden strategies
        const acclaimedFloor = sortStrat === "hidden"
          ? voteFloor
          : Math.max(voteFloor, isMovie ? 50_000 : 20_000);

        for (const genreIds of variants) {
          const variantBase = { ...baseParams, with_genres: genreIds.join(",") };

          if (sortStrat === "popular") {
            // Popularity first, acclaimed as supplement
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "popularity.desc" }, [1, 2, 3], tmdbKey));
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "vote_average.desc", "vote_count.gte": String(acclaimedFloor) }, [1, 2], tmdbKey));

          } else if (sortStrat === "acclaimed") {
            // Critical quality: skip popularity, sort by vote_average with high vote floor
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "vote_average.desc", "vote_count.gte": String(acclaimedFloor) }, [1, 2, 3, 4], tmdbKey));
            // vote_count.desc catches acclaimed but niche titles
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "vote_count.desc" }, [1, 2], tmdbKey));

          } else if (sortStrat === "hidden") {
            // Overlooked gems: quality sort within vote cap — no popularity signal
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "vote_average.desc" }, [1, 2, 3, 4], tmdbKey));
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "vote_count.desc" }, [1, 2, 3], tmdbKey));

          } else if (sortStrat === "recent") {
            // Newest releases: date-descending primary, popularity supplement
            const dateSort = isMovie ? "primary_release_date.desc" : "first_air_date.desc";
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: dateSort }, [1, 2, 3], tmdbKey));
            allFetches.push(discoverPages(mt, { ...variantBase, sort_by: "popularity.desc" }, [1, 2], tmdbKey));
          }
        }

        const settled = await Promise.allSettled(allFetches);

        const rawResults = settled
          .filter((r): r is PromiseFulfilledResult<CandidateItem[]> => r.status === "fulfilled")
          .map((r) => r.value);

        let candidates = mergeAndDedup(rawResults).filter((c) =>
          c.voteAverage >= spec.retrieval.minRating &&
          c.voteCount >= voteFloor &&
          (voteCap === undefined || c.voteCount <= voteCap) &&
          (popularityCap === undefined || c.popularity <= popularityCap) &&
          !watchedIds.has(c.tmdbId) &&
          !watchlistIds.has(c.tmdbId),
        );

        // Adaptive widening — relax quality floors if pool is thin
        if (candidates.length < POOL_TARGET_SIZE) {
          console.log(`[candidates] ${spec.id} thin (${candidates.length}) — widening`);
          const allIds = [...new Set([...primaryIds, ...secondaryIds])];
          // For hidden themes, widening floor is the theme's own minVoteCount (may be low)
          // For others, widen to QUALITY.wide floors
          const wideVoteFloor = sortStrat === "hidden"
            ? voteFloor
            : Math.min(voteFloor, QUALITY.wide.minVoteCount);
          const wideSort = (sortStrat === "hidden" || sortStrat === "acclaimed")
            ? "vote_average.desc"
            : "popularity.desc";

          const wideBase: Record<string, string> = {
            include_adult: "false",
            "vote_count.gte": String(wideVoteFloor),
            "vote_average.gte": String(QUALITY.wide.minRating),
            sort_by: wideSort,
            ...dateParams,
          };
          if (voteCap !== undefined) wideBase["vote_count.lte"] = String(voteCap);
          if (excludeIds.length > 0) wideBase.without_genres = excludeIds.join(",");
          if (spec.retrieval.originalLanguage) wideBase.with_original_language = spec.retrieval.originalLanguage;

          const wideFetches = await Promise.allSettled([
            ...allIds.slice(0, 3).map((id) =>
              discoverPages(mt, { ...wideBase, with_genres: String(id) }, [1, 2, 3, 4], tmdbKey)
            ),
            allIds.length > 1
              ? discoverPages(mt, { ...wideBase, with_genres: allIds.join(",") }, [1, 2, 3], tmdbKey)
              : Promise.resolve([]),
          ]);

          const wideFiltered = wideFetches
            .filter((r): r is PromiseFulfilledResult<CandidateItem[]> => r.status === "fulfilled")
            .flatMap((r) => r.value)
            .filter((c) =>
              c.voteAverage >= QUALITY.wide.minRating &&
              c.voteCount >= wideVoteFloor &&
              (voteCap === undefined || c.voteCount <= voteCap) &&
              (popularityCap === undefined || c.popularity <= popularityCap) &&
              !watchedIds.has(c.tmdbId) &&
              !watchlistIds.has(c.tmdbId),
            );

          candidates = mergeAndDedup([candidates, wideFiltered]);
        }

        candidates.sort((a, b) => compositeScore(b) - compositeScore(a));
        const traktLabel = "";
        console.log(`[candidates] ${spec.id} (${spec.slotType}/${sortStrat}${traktLabel}): ${candidates.length} candidates`);

        return { themeSpec: spec, candidates };
      } catch (e) {
        console.warn(`[candidates] ${spec.id} failed: ${(e as Error).message?.slice(0, 80)}`);
        return { themeSpec: spec, candidates: [] };
      }
    }),
  );

  return pools;
}

// ─── Cross-pool deduplication ─────────────────────────────────────────────────
// No-op: pre-curation pool dedup was too aggressive — it stripped titles from
// pools that shared popular genres (Drama, Thriller), leaving many pools with
// fewer than 2 candidates. Post-curation dedup (postDeduplicateAndBackfill)
// handles cross-row uniqueness after the AI makes its selections.

// deno-lint-ignore no-unused-vars
export function deduplicatePools(_pools: ThemePool[]): void {
  // Intentionally empty — pools may overlap; curator is instructed not to repeat
}

// ─── Legacy pool builder (kept for new-user path) ─────────────────────────────

export async function buildCandidatePools(
  intents: SectionIntent[],
  ctx: ActionContext,
  tmdbKey: string,
): Promise<CandidatePool[]> {
  const watchedMovieIds = new Set<number>(
    ctx.watchedMovies.map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
  );
  const watchedShowIds = new Set<number>(
    ctx.watchedShows.map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
  );

  return Promise.all(
    intents.map(async (intent): Promise<CandidatePool> => {
      try {
        const mt: "movie" | "tv" = intent.candidateSpec.mediaType === "both"
          ? "movie"
          : intent.candidateSpec.mediaType;

        const spec = intent.candidateSpec;
        const params: Record<string, string> = {
          sort_by: spec.sortBy ?? "popularity.desc",
          "vote_average.gte": String(spec.minRating ?? 6.5),
          "vote_count.gte": String(spec.minVoteCount ?? 500),
          include_adult: "false",
        };
        if (spec.genres?.length) params.with_genres = spec.genres.join(",");
        if (spec.releaseDateGte) {
          params[mt === "movie" ? "primary_release_date.gte" : "first_air_date.gte"] = spec.releaseDateGte;
        }

        let raw: CandidateItem[];
        if (spec.source === "trending") {
          raw = await fetchTrending(mt, tmdbKey);
        } else {
          const data = await tmdbGet(`/discover/${mt}`, params, tmdbKey);
          // deno-lint-ignore no-explicit-any
          raw = (data.results ?? []).map(mt === "movie" ? mapMovie : mapTV);
        }

        const watchedIds = mt === "movie" ? watchedMovieIds : watchedShowIds;
        const unwatched = raw.filter((c) => !watchedIds.has(c.tmdbId));
        const candidates = (unwatched.length >= 3 ? unwatched : raw).slice(0, intent.targetCount);
        return { sectionIntent: intent, candidates };
      } catch (e) {
        console.warn(`[candidates] legacy ${intent.id} failed: ${(e as Error).message?.slice(0, 60)}`);
        return { sectionIntent: intent, candidates: [] };
      }
    }),
  );
}

// Re-export fetchTrending for hero section
export { fetchTrending };
