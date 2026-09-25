// Resolve model-named titles ("Past Lives", 2023, movie) to real TMDB entries.
// Mirrors the client's searchTitleWithFallback: year-constrained search first,
// then without the year, then the other media type — small models regularly
// file a series under movies — accepting a hit only when the names agree.

const TMDB_BASE = "https://api.themoviedb.org/3";

export interface ResolvedTitle {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: number;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  voteCount: number;
  genres: number[];
  overview: string;
}

// deno-lint-ignore no-explicit-any
async function tmdbGet(path: string, params: Record<string, string>, key: string): Promise<any> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Partial containment ("Jurassic Park" in "The Real Jurassic Park") must never outrank an exact match.
  if (x.includes(y) || y.includes(x)) return Math.min(0.95, 0.5 + 0.45 * Math.min(x.length, y.length) / Math.max(x.length, y.length));
  const ta = new Set(x.split(" ")), tb = new Set(y.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size);
}

// deno-lint-ignore no-explicit-any
export function toResolved(d: any, mediaType: "movie" | "tv"): ResolvedTitle {
  const date = (mediaType === "movie" ? d.release_date : d.first_air_date) ?? "";
  return {
    tmdbId: d.id,
    mediaType,
    title: (mediaType === "movie" ? d.title : d.name) ?? "",
    year: parseInt(String(date).slice(0, 4)) || 0,
    posterPath: d.poster_path ?? null,
    backdropPath: d.backdrop_path ?? null,
    voteAverage: d.vote_average ?? 0,
    voteCount: d.vote_count ?? 0,
    genres: d.genre_ids ?? (d.genres ?? []).map((g: { id: number }) => g.id),
    overview: d.overview ?? "",
  };
}

async function search(title: string, year: number | null, type: "movie" | "tv", key: string): Promise<ResolvedTitle | null> {
  const yearParam = type === "movie" ? "year" : "first_air_date_year";
  const data = await tmdbGet(`/search/${type}`, { query: title, include_adult: "false", ...(year ? { [yearParam]: String(year) } : {}) }, key)
    .catch(() => null);
  // deno-lint-ignore no-explicit-any
  const results: any[] = data?.results ?? [];
  // Best name match among the top few; ties go to the more-voted (the famous one).
  const scored = results.slice(0, 6)
    .map((r) => ({ r, s: similarity(title, (type === "movie" ? r.title : r.name) ?? "") }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || (b.r.vote_count ?? 0) - (a.r.vote_count ?? 0));
  return scored.length ? toResolved(scored[0].r, type) : null;
}

export async function resolveTitle(
  title: string,
  year: number | null,
  type: "movie" | "tv",
  key: string,
): Promise<ResolvedTitle | null> {
  const other = type === "movie" ? "tv" : "movie";
  return (year ? await search(title, year, type, key) : null)
    ?? await search(title, null, type, key)
    ?? (year ? await search(title, year, other, key) : null)
    ?? await search(title, null, other, key);
}

/** Resolve many at once, a few in flight at a time (TMDB allows ~40 req/s). */
export async function resolveMany<T extends { title: string; year: number | null; type: "movie" | "tv" }>(
  items: T[],
  key: string,
  concurrency = 8,
): Promise<(ResolvedTitle | null)[]> {
  const out: (ResolvedTitle | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await resolveTitle(items[i].title, items[i].year, items[i].type, key).catch(() => null);
    }
  }));
  return out;
}

export async function tmdbDetails(tmdbId: number, type: "movie" | "tv", key: string): Promise<ResolvedTitle | null> {
  const d = await tmdbGet(`/${type}/${tmdbId}`, {}, key).catch(() => null);
  return d ? toResolved(d, type) : null;
}

/** Recent releases people are actually watching — the part of taste the models' training data can't cover. */
export async function recentReleasePool(key: string): Promise<ResolvedTitle[]> {
  const thisYear = new Date().getUTCFullYear();
  const pages = await Promise.all([
    tmdbGet("/trending/movie/week", {}, key).then((d) => ({ d, t: "movie" as const })),
    tmdbGet("/trending/tv/week", {}, key).then((d) => ({ d, t: "tv" as const })),
    tmdbGet("/trending/movie/week", { page: "2" }, key).then((d) => ({ d, t: "movie" as const })),
    tmdbGet("/trending/tv/week", { page: "2" }, key).then((d) => ({ d, t: "tv" as const })),
    tmdbGet("/movie/now_playing", {}, key).then((d) => ({ d, t: "movie" as const })),
  ].map((p) => p.catch(() => null)));
  const seen = new Set<string>();
  const pool: ResolvedTitle[] = [];
  for (const page of pages) {
    for (const r of page?.d?.results ?? []) {
      const item = toResolved(r, page!.t);
      const k = `${item.mediaType}:${item.tmdbId}`;
      if (seen.has(k) || item.year < thisYear - 1 || item.voteCount < 50 || !item.posterPath) continue;
      seen.add(k);
      pool.push(item);
    }
  }
  return pool;
}
