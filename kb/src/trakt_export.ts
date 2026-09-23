import { readFileSync, readdirSync } from 'node:fs';

// Reads a Trakt data export (trakt.tv → Settings → Data → Export). Any family
// member can provide one; nothing needs to go through the app.

export interface WatchEvent { key: string; tmdb: number; isTv: boolean; title: string; year: number | null; at: string; season?: number; episode?: number }
export interface MemberHistory {
  name: string;
  events: WatchEvent[];                  // every play, chronological
  watchlist: { key: string; tmdb: number; isTv: boolean; listedAt: string }[];
  bulkKeys: Set<string>;                 // titles whose first play is a bulk-import timestamp
}

export const titleKey = (isTv: boolean, tmdb: number) => `${isTv ? 't' : 'm'}${tmdb}`;

// deno-lint-ignore no-explicit-any
const readJson = (dir: string, f: string): any[] => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));

export interface ExportOptions {
  /** UTC days (YYYY-MM-DD) to drop entirely — e.g. a day guests used the account. */
  excludeDates?: string[];
  /** Re-logs of the same film/episode within this many hours count as one play (duplicate scrobbles). */
  dedupeHours?: number;
}

export function loadTraktExport(name: string, dir: string, opts: ExportOptions = {}): MemberHistory {
  const files = readdirSync(dir).filter((f) => /^watched-history-\d+\.json$/.test(f));
  const events: WatchEvent[] = [];
  for (const f of files) {
    for (const e of readJson(dir, f)) {
      const isTv = e.type === 'episode';
      const item = isTv ? e.show : e.movie;
      const tmdb = item?.ids?.tmdb;
      if (!tmdb) continue;
      events.push({ key: titleKey(isTv, tmdb), tmdb, isTv, title: item.title, year: item.year ?? null, at: e.watched_at,
        season: e.episode?.season, episode: e.episode?.number });
    }
  }
  events.sort((a, b) => (a.at < b.at ? -1 : 1));

  // Hygiene: drop excluded days, then collapse duplicate scrobbles (Plex can
  // log one viewing several times within minutes, which otherwise reads as a
  // strong "rewatch" signal).
  const skip = new Set(opts.excludeDates ?? []);
  const window = (opts.dedupeHours ?? 3) * 3600_000;
  const lastPlay = new Map<string, number>();
  const cleaned = events.filter((e) => {
    if (skip.has(e.at.slice(0, 10))) return false;
    const id = e.isTv ? `${e.key}:${e.season}x${e.episode}` : e.key;
    const t = Date.parse(e.at), prev = lastPlay.get(id);
    if (prev != null && t - prev < window) return false;
    lastPlay.set(id, t);
    return true;
  });
  events.length = 0;
  events.push(...cleaned);

  // Bulk imports stamp many titles with one time — unusable as "what they watched next".
  const first = new Map<string, string>();
  for (const e of events) if (!first.has(e.key)) first.set(e.key, e.at);
  const perTs = new Map<string, number>();
  for (const t of first.values()) perTs.set(t, (perTs.get(t) ?? 0) + 1);
  const bulkKeys = new Set([...first].filter(([, t]) => (perTs.get(t) ?? 0) >= 3).map(([k]) => k));

  let watchlist: MemberHistory['watchlist'] = [];
  try {
    watchlist = readJson(dir, 'lists-watchlist.json')
      .filter((w) => (w.type === 'movie' || w.type === 'show') && (w.movie ?? w.show)?.ids?.tmdb)
      .map((w) => { const isTv = w.type === 'show'; const tmdb = (w.movie ?? w.show).ids.tmdb; return { key: titleKey(isTv, tmdb), tmdb, isTv, listedAt: w.listed_at }; });
  } catch { /* no watchlist file */ }

  return { name, events, watchlist, bulkKeys };
}

export interface Member { name: string; trakt_export: string; exclude_dates?: string[] }
export function loadMembers(configPath: string): MemberHistory[] {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { members: Member[] };
  return cfg.members.map((m) => loadTraktExport(m.name, m.trakt_export, { excludeDates: m.exclude_dates, dedupeHours: 3 }));
}
