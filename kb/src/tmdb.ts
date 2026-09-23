import { requireEnv } from './env.ts';

// Only what the profile/recommendation layers need is extracted; the raw TMDB
// response is discarded.

const BASE = 'https://api.themoviedb.org/3';

export interface CatalogueTitle {
  tmdb_id: number;
  is_tv: boolean;
  imdb_num: number | null;
  title: string;
  original_title: string | null;
  year: number | null;
  runtime: number | null;
  seasons: number | null;
  overview: string | null;
  genre_ids: number[];
  genre_names: string[];          // not stored (ids are); used for Jev state
  creators: string[];
  cast_names: string[];
  keywords: { id: number; name: string }[];
  lang: string | null;
  countries: string[];
  cert: string | null;
  popularity: number | null;
  vote_avg: number | null;
  vote_count: number | null;
  poster_path: string | null;
}

async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', requireEnv('TMDB_API_KEY'));
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`TMDB ${res.status} ${path}`);
  }
}

/**
 * Resolve title + year to a TMDB id. Requires an exact (normalised) title or
 * original-title match within ±1 year — TMDB often dates films by a later
 * wide release (Casablanca 1942 → 1943). Returns null rather than guess.
 */
export async function searchTitle(query: string, year: number, isTv: boolean): Promise<number | null> {
  type Hit = { id: number; title?: string; name?: string; original_title?: string; original_name?: string; release_date?: string; first_air_date?: string; vote_count: number };
  const data = await tmdb<{ results: Hit[] }>(isTv ? '/search/tv' : '/search/movie', { query });
  const norm = (s?: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const q = norm(query);
  const matches = data.results.filter((r) => {
    const y = Number((r.release_date ?? r.first_air_date ?? '').slice(0, 4));
    const titleOk = [r.title, r.name, r.original_title, r.original_name].some((t) => norm(t) === q);
    return titleOk && y && Math.abs(y - year) <= 1;
  });
  return matches.sort((a, b) => b.vote_count - a.vote_count)[0]?.id ?? null;
}

export async function fetchTitle(id: number, isTv: boolean): Promise<CatalogueTitle> {
  // deno-lint-ignore no-explicit-any
  const d: any = await tmdb(isTv ? `/tv/${id}` : `/movie/${id}`, {
    append_to_response: isTv ? 'credits,external_ids,keywords,content_ratings' : 'credits,external_ids,keywords,release_dates',
  });

  const title: string = isTv ? d.name : d.title;
  const original: string = isTv ? d.original_name : d.original_title;
  const date: string | undefined = isTv ? d.first_air_date : d.release_date;
  const imdb: string | undefined = d.external_ids?.imdb_id ?? d.imdb_id;

  const creators: string[] = isTv
    ? (d.created_by ?? []).map((c: { name: string }) => c.name)
    : (d.credits?.crew ?? []).filter((c: { job: string }) => c.job === 'Director').map((c: { name: string }) => c.name);

  const cert = isTv
    ? pickTvRating(d.content_ratings?.results ?? [])
    : pickMovieCert(d.release_dates?.results ?? []);

  const keywords: { id: number; name: string }[] = (isTv ? d.keywords?.results : d.keywords?.keywords) ?? [];

  return {
    tmdb_id: d.id,
    is_tv: isTv,
    imdb_num: imdb?.startsWith('tt') ? Number(imdb.slice(2)) || null : null,
    title,
    original_title: original && original !== title ? original : null,
    year: date ? Number(date.slice(0, 4)) || null : null,
    runtime: isTv ? (d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime ?? null) : (d.runtime || null),
    seasons: isTv ? (d.number_of_seasons ?? null) : null,
    overview: d.overview?.trim() || null,
    genre_ids: (d.genres ?? []).map((g: { id: number }) => g.id),
    genre_names: (d.genres ?? []).map((g: { name: string }) => g.name),
    creators: [...new Set(creators)].slice(0, 2),
    cast_names: (d.credits?.cast ?? []).slice(0, 5).map((c: { name: string }) => c.name),
    keywords: keywords.slice(0, 15).map((k) => ({ id: k.id, name: k.name })),
    lang: d.original_language ?? null,
    countries: (isTv ? d.origin_country : (d.production_countries ?? []).map((c: { iso_3166_1: string }) => c.iso_3166_1) ?? []).slice(0, 3),
    cert,
    popularity: d.popularity ?? null,
    vote_avg: d.vote_average != null ? Math.round(d.vote_average * 10) : null,
    vote_count: d.vote_count ?? null,
    poster_path: d.poster_path ?? null,
  };
}

function pickMovieCert(results: { iso_3166_1: string; release_dates: { certification: string }[] }[]): string | null {
  for (const country of ['US', 'GB']) {
    const r = results.find((x) => x.iso_3166_1 === country);
    const c = r?.release_dates.map((x) => x.certification).find((x) => x?.trim());
    if (c) return `${country}:${c.trim()}`;
  }
  return null;
}

function pickTvRating(results: { iso_3166_1: string; rating: string }[]): string | null {
  for (const country of ['US', 'GB']) {
    const r = results.find((x) => x.iso_3166_1 === country && x.rating?.trim());
    if (r) return `${country}:${r.rating.trim()}`;
  }
  return null;
}

// TMDB genre ids → names, for building Jev state from stored rows.
export const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};
