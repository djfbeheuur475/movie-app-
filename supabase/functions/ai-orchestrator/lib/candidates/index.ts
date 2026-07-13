// Candidate Builder — maps each SectionIntent to a real CandidatePool via TMDB.
// All TMDB calls run in parallel. Failed sections return empty pools (graceful degradation).
// Watched titles are filtered out client-side after fetching.

import type { ActionContext, CandidateItem, CandidatePool, CandidateSpec, SectionIntent } from "../../types.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";
const MIN_VOTES_MOVIE = 300;
const MIN_VOTES_TV = 100;
const MIN_VOTES_HIDDEN_GEM = 100; // lower bar for obscure titles

// ─── TMDB API helper ──────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>, key: string): Promise<any> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  // 8s hard timeout per TMDB request — prevents pool-builder from hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Result mappers ───────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function mapMovie(r: any): CandidateItem {
  return {
    tmdbId: r.id,
    mediaType: "movie",
    title: r.title ?? r.original_title ?? "",
    year: parseInt((r.release_date ?? "").split("-")[0]) || 0,
    voteAverage: r.vote_average ?? 0,
    popularity: r.popularity ?? 0,
    genres: r.genre_ids ?? [],
    overview: r.overview ?? "",
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
  };
}

// deno-lint-ignore no-explicit-any
function mapTV(r: any): CandidateItem {
  return {
    tmdbId: r.id,
    mediaType: "tv",
    title: r.name ?? r.original_name ?? "",
    year: parseInt((r.first_air_date ?? "").split("-")[0]) || 0,
    voteAverage: r.vote_average ?? 0,
    popularity: r.popularity ?? 0,
    genres: r.genre_ids ?? [],
    overview: r.overview ?? "",
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
  };
}

// ─── Source-specific fetchers ─────────────────────────────────────────────────

async function fetchDiscover(
  spec: CandidateSpec,
  mediaType: "movie" | "tv",
  key: string,
): Promise<CandidateItem[]> {
  const isHiddenGem = spec.source === "hidden_gem";
  const isNewRelease = spec.source === "new_releases";
  const isMovie = mediaType === "movie";

  const defaultSort = isNewRelease
    ? `${isMovie ? "primary_release_date" : "first_air_date"}.desc`
    : "vote_average.desc";
  const defaultVoteCount = isHiddenGem
    ? MIN_VOTES_HIDDEN_GEM
    : (isMovie ? MIN_VOTES_MOVIE : MIN_VOTES_TV);

  const params: Record<string, string> = {
    sort_by: spec.sortBy ?? defaultSort,
    "vote_average.gte": String(spec.minRating ?? 6.5),
    "vote_count.gte": String(spec.minVoteCount ?? defaultVoteCount),
    include_adult: "false",
    page: "1",
  };

  if (spec.genres?.length) {
    params.with_genres = spec.genres.join(",");
  }

  if (spec.excludeGenres?.length) {
    params.without_genres = spec.excludeGenres.join(",");
  }

  if (isHiddenGem && spec.maxPopularity) {
    params["popularity.lte"] = String(spec.maxPopularity);
  }

  const dateGteKey = isMovie ? "primary_release_date.gte" : "first_air_date.gte";
  const dateLteKey = isMovie ? "primary_release_date.lte" : "first_air_date.lte";
  if (spec.releaseDateGte) params[dateGteKey] = spec.releaseDateGte;
  if (spec.releaseDateLte) params[dateLteKey] = spec.releaseDateLte;

  const data = await tmdbGet(`/discover/${mediaType}`, params, key);
  // deno-lint-ignore no-explicit-any
  const results: any[] = data.results ?? [];
  return results.map(isMovie ? mapMovie : mapTV);
}

async function fetchTrending(
  _spec: CandidateSpec,
  mediaType: "movie" | "tv",
  key: string,
): Promise<CandidateItem[]> {
  const data = await tmdbGet(`/trending/${mediaType}/week`, {}, key);
  // deno-lint-ignore no-explicit-any
  const results: any[] = data.results ?? [];
  return results.map(mediaType === "movie" ? mapMovie : mapTV);
}

async function fetchSimilar(
  spec: CandidateSpec,
  mediaType: "movie" | "tv",
  key: string,
): Promise<CandidateItem[]> {
  if (!spec.seedTmdbId) return [];
  const data = await tmdbGet(`/${mediaType}/${spec.seedTmdbId}/similar`, { page: "1" }, key);
  // deno-lint-ignore no-explicit-any
  const results: any[] = data.results ?? [];
  const candidates = results.map(mediaType === "movie" ? mapMovie : mapTV);
  if (spec.minRating) {
    return candidates.filter((c) => c.voteAverage >= spec.minRating!);
  }
  return candidates;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function fetchForMediaType(
  spec: CandidateSpec,
  mediaType: "movie" | "tv",
  key: string,
): Promise<CandidateItem[]> {
  switch (spec.source) {
    case "trending":
      return fetchTrending(spec, mediaType, key);
    case "similar":
      return fetchSimilar(spec, mediaType, key);
    case "discover":
    case "new_releases":
    case "hidden_gem":
      return fetchDiscover(spec, mediaType, key);
    default:
      return [];
  }
}

async function fetchCandidates(spec: CandidateSpec, key: string): Promise<CandidateItem[]> {
  const mediaTypes: Array<"movie" | "tv"> =
    spec.mediaType === "both" ? ["movie", "tv"] : [spec.mediaType];

  // allSettled so a 404 on /movie/{tvId}/similar doesn't kill the whole pool
  const settled = await Promise.allSettled(mediaTypes.map((mt) => fetchForMediaType(spec, mt, key)));
  const merged = settled
    .filter((r): r is PromiseFulfilledResult<CandidateItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Sort by quality, dedup by tmdbId
  merged.sort((a, b) => b.voteAverage - a.voteAverage);
  const seen = new Set<number>();
  return merged.filter((c) => {
    if (seen.has(c.tmdbId)) return false;
    seen.add(c.tmdbId);
    return true;
  });
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function buildCandidatePools(
  intents: SectionIntent[],
  ctx: ActionContext,
  tmdbKey: string,
): Promise<CandidatePool[]> {
  // Build watched-ID sets for deduplication
  const watchedMovieIds = new Set<number>(
    ctx.watchedMovies.map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
  );
  const watchedShowIds = new Set<number>(
    ctx.watchedShows.map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
  );

  const pools = await Promise.all(
    intents.map(async (intent): Promise<CandidatePool> => {
      try {
        const raw = await fetchCandidates(intent.candidateSpec, tmdbKey);

        const unwatched = raw.filter((c) =>
          c.mediaType === "movie"
            ? !watchedMovieIds.has(c.tmdbId)
            : !watchedShowIds.has(c.tmdbId)
        );

        // If < 3 unwatched remain (user has seen most results), fall back to
        // unfiltered raw pool — better to show something than an empty section
        const source = unwatched.length >= 3 ? unwatched : raw;
        const candidates = source.slice(0, intent.targetCount);

        console.log(
          `[candidates] section=${intent.id} raw=${raw.length} unwatched=${unwatched.length} kept=${candidates.length}${unwatched.length < 3 ? " (fell back to raw)" : ""}`,
        );

        return { sectionIntent: intent, candidates };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[candidates] section=${intent.id} failed: ${msg}`);
        return { sectionIntent: intent, candidates: [] };
      }
    }),
  );

  return pools;
}
