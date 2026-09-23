import { db, must } from './db.ts';
import { fetchTitle, tmdbDiscover, tmdbRecommendations } from './tmdb.ts';
import { titleKey, type MemberHistory } from './trakt_export.ts';

// Experiment catalogue (~2–3k titles), centred on the family's histories:
//   seed    — everything any member watched or watchlisted
//   related — TMDB recommendations of seed titles, most-recommended first
//             (look-alikes: hard negatives for the held-out test)
//   broad   — widely-seen + long-tail + recent titles across genres, so the
//             pool isn't only "things near what they already watch"

type Pick = { tmdb: number; isTv: boolean; source: 'seed' | 'related' | 'broad' };

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await fn(x); }));
}

export async function buildCatalogue(members: MemberHistory[], target: number, log: (m: string) => void) {
  const picks = new Map<string, Pick>();
  const add = (tmdb: number, isTv: boolean, source: Pick['source']) => { const k = titleKey(isTv, tmdb); if (!picks.has(k)) picks.set(k, { tmdb, isTv, source }); };

  for (const m of members) {
    for (const e of m.events) add(e.tmdb, e.isTv, 'seed');
    for (const w of m.watchlist) add(w.tmdb, w.isTv, 'seed');
  }
  const seeds = [...picks.values()];
  log(`Seed: ${seeds.length} watched/watchlisted titles from ${members.length} member(s)`);

  // Related: count how often each title is recommended across the seed set.
  const counts = new Map<string, { tmdb: number; isTv: boolean; n: number }>();
  let done = 0;
  await pool(seeds, 6, async (s) => {
    for (const r of await tmdbRecommendations(s.tmdb, s.isTv).catch(() => [])) {
      const k = titleKey(s.isTv, r);
      if (picks.has(k)) continue;
      const c = counts.get(k) ?? { tmdb: r, isTv: s.isTv, n: 0 };
      c.n++; counts.set(k, c);
    }
    if (++done % 200 === 0) log(`  related: ${done}/${seeds.length} seeds scanned`);
  });
  const broadBudget = Math.round(target * 0.3);
  const relatedBudget = Math.max(0, target - picks.size - broadBudget);
  for (const c of [...counts.values()].sort((a, b) => b.n - a.n).slice(0, relatedBudget)) add(c.tmdb, c.isTv, 'related');
  log(`Related: +${picks.size - seeds.length} (of ${counts.size} candidates)`);

  // Broad: widely seen, long-tail acclaimed, and recent — films and TV.
  const before = picks.size;
  const queries: [boolean, Record<string, string | number>, number][] = [
    [false, { sort_by: 'vote_count.desc' }, 12],
    [true, { sort_by: 'vote_count.desc' }, 6],
    [false, { sort_by: 'vote_average.desc', 'vote_count.gte': 300, 'vote_count.lte': 3000 }, 6],
    [true, { sort_by: 'vote_average.desc', 'vote_count.gte': 100, 'vote_count.lte': 1500 }, 4],
    [false, { sort_by: 'popularity.desc', 'primary_release_date.gte': '2024-01-01', 'vote_count.gte': 100 }, 3],
    [true, { sort_by: 'popularity.desc', 'first_air_date.gte': '2024-01-01', 'vote_count.gte': 50 }, 3],
  ];
  outer: for (const [isTv, params, pages] of queries) {
    for (let p = 1; p <= pages; p++) {
      for (const id of await tmdbDiscover(isTv, { ...params, page: p })) {
        if (picks.size - before >= broadBudget) break outer;
        add(id, isTv, 'broad');
      }
    }
  }
  log(`Broad: +${picks.size - before}. Total catalogue: ${picks.size}`);

  // Fetch + store (skip titles already in kb_titles).
  const existing = new Set((must(await db().from('kb_titles').select('tmdb_id, is_tv').gt('tmdb_id', 0), 'existing') as { tmdb_id: number; is_tv: boolean }[]).map((r) => titleKey(r.is_tv, r.tmdb_id)));
  let stored = 0, failed = 0;
  const all = [...picks.values()];
  await pool(all, 6, async (p) => {
    try {
      let id: number;
      if (existing.has(titleKey(p.isTv, p.tmdb))) {
        id = must(await db().from('kb_titles').select('id').eq('tmdb_id', p.tmdb).eq('is_tv', p.isTv).single(), 'id').id;
      } else {
        const t = await fetchTitle(p.tmdb, p.isTv);
        if (t.keywords.length) must(await db().from('kb_keywords').upsert(t.keywords, { onConflict: 'id' }), 'keywords');
        const { genre_names: _g, keywords, ...row } = t;
        id = must(await db().from('kb_titles').upsert({ ...row, keyword_ids: keywords.map((k) => k.id), fetched_at: new Date().toISOString().slice(0, 10) }, { onConflict: 'tmdb_id,is_tv' }).select('id').single(), 'upsert').id;
      }
      must(await db().from('kb_sets').upsert({ name: 'catalogue', title_id: id, label: p.source }, { onConflict: 'name,title_id' }), 'set');
      if (++stored % 250 === 0) log(`  stored ${stored}/${all.length}`);
    } catch (e) {
      failed++;
      log(`  ✗ ${p.isTv ? 'tv' : 'movie'} ${p.tmdb}: ${(e as Error).message}`);
    }
  });
  log(`Catalogue stored: ${stored} titles (${failed} failed) in set 'catalogue'.`);
}
