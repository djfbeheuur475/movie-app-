import { GENRE_NAMES } from './tmdb.ts';

// The Jev `state` is built ONLY from stored kb_titles fields, so any title can
// be re-profiled under a new framework version without re-fetching TMDB.

export interface StoredTitle {
  id: number;
  tmdb_id: number;
  is_tv: boolean;
  title: string;
  original_title: string | null;
  year: number | null;
  runtime: number | null;
  seasons: number | null;
  overview: string | null;
  genre_ids: number[] | null;
  creators: string[] | null;
  cast_names: string[] | null;
  keyword_ids: number[] | null;
  lang: string | null;
  countries: string[] | null;
  cert: string | null;
  meta_version: number;
}

export function buildState(t: StoredTitle, keywordNames: Map<number, string>): string {
  const kind = t.is_tv ? 'TV series' : 'Film';
  const facts = [
    kind,
    t.runtime ? `${t.runtime} min${t.is_tv ? ' episodes' : ''}` : null,
    t.seasons ? `${t.seasons} season${t.seasons === 1 ? '' : 's'}` : null,
    t.cert ? `rated ${t.cert.split(':')[1]}` : null,
    t.lang ? `language: ${t.lang}` : null,
    t.countries?.length ? `country: ${t.countries.join(', ')}` : null,
  ].filter(Boolean).join(' · ');

  const lines = [
    'Profile this title for a film & TV recommendation engine. Use what you know about it as well as the details below.',
    `Title: ${t.title}${t.year ? ` (${t.year})` : ''}${t.original_title ? ` — original title: ${t.original_title}` : ''}`,
    facts,
    t.genre_ids?.length ? `Genres: ${t.genre_ids.map((g) => GENRE_NAMES[g] ?? g).join(', ')}` : null,
    t.creators?.length ? `${t.is_tv ? 'Created by' : 'Directed by'}: ${t.creators.join(', ')}` : null,
    t.cast_names?.length ? `Starring: ${t.cast_names.join(', ')}` : null,
    t.keyword_ids?.length ? `Keywords: ${t.keyword_ids.map((k) => keywordNames.get(k)).filter(Boolean).join(', ')}` : null,
    t.overview ? `Overview: ${t.overview}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Familiarity probe: deliberately ONLY title, year and format — no evidence. */
export function buildNameOnlyState(t: Pick<StoredTitle, 'title' | 'year' | 'is_tv'>): string {
  return [
    'Profile this title for a film & TV recommendation engine. Use what you know about it.',
    `Title: ${t.title}${t.year ? ` (${t.year})` : ''}`,
    t.is_tv ? 'TV series' : 'Film',
  ].join('\n');
}
