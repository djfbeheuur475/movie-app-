import { createClient } from '@supabase/supabase-js';
import { db, must } from './db.ts';
import { requireEnv } from './env.ts';
import type { CompiledFramework } from './framework.ts';
import { resolveLikeApp, tmdbRecommendations, GENRE_NAMES } from './tmdb.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { titleKey, type MemberHistory, type WatchEvent } from './trakt_export.ts';

// Offline recommendation experiment (see kb/DESIGN.md §7 Stage B).
//
// Time-split folds per member: each fold picks a cut-off in their viewing
// timeline. Systems see ONLY what was first watched before it (plays and dates
// computed from pre-cut-off events), and must rediscover the next 20 titles the
// member actually started. No system ever sees held-out titles as watched.

// ── Catalogue ───────────────────────────────────────────────────────────────

export interface CatTitle {
  id: number; key: string; tmdb: number; isTv: boolean; title: string; year: number | null;
  voteAvg: number | null; voteCount: number | null; popularity: number | null; genreIds: number[];
  poster: string | null; vec: number[] | null; familiarity: number | null; agreement: number | null; nameConf: number | null; traits: string[];  // vec/familiarity/traits: Jev-derived, null/[] if unprofiled
}

export async function loadCatalogue(fw: CompiledFramework, fwId: number): Promise<Map<string, CatTitle>> {
  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db().from('kb_sets').select('title_id').eq('name', 'catalogue').range(from, from + 999), 'set');
    ids.push(...page.map((r) => r.title_id));
    if (page.length < 1000) break;
  }
  // Every catalogue title is loaded (E and D need no profile); Jev profiles are
  // attached where present — only A and B use them.
  type Meta = { id: number; tmdb_id: number; is_tv: boolean; title: string; year: number | null; vote_avg: number | null; vote_count: number | null; popularity: number | null; genre_ids: number[] | null; poster_path: string | null };
  type Prof = { title_id: number; vals: (number | null)[]; familiarity: number | null; agreement: number | null; name_conf: number | null };
  const metas: Meta[] = [], profs = new Map<number, Prof>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    metas.push(...(must(await db().from('kb_titles').select('id, tmdb_id, is_tv, title, year, vote_avg, vote_count, popularity, genre_ids, poster_path').in('id', chunk), 'titles') as Meta[]));
    for (const p of must(await db().from('kb_title_profiles').select('title_id, vals, familiarity, agreement, name_conf').eq('framework_id', fwId).in('title_id', chunk), 'profiles') as Prof[]) profs.set(p.title_id, p);
  }
  const rows = [...profs.values()];

  // Feature vector: every slot of dimensions that apply to both formats,
  // z-scored across the catalogue; choice-option slots at half weight.
  const slots: { idx: number; w: number; key: string; scalar: boolean }[] = [];
  for (const d of fw.dimensions) {
    if (d.appliesTo !== 'all') continue;
    for (let k = 0; k < d.slotCount; k++) slots.push({ idx: d.slotStart - 1 + k, w: d.type === 'choice' ? 0.5 : 1, key: d.type === 'choice' ? `${d.key}:${d.options[k]}` : d.key, scalar: d.type !== 'choice' });
  }
  const n = rows.length || 1;
  const mu = slots.map((s) => rows.reduce((a, r) => a + (r.vals[s.idx] ?? 0), 0) / n);
  const sd = slots.map((s, j) => Math.sqrt(rows.reduce((a, r) => a + ((r.vals[s.idx] ?? 0) - mu[j]) ** 2, 0) / n) || 1);

  const out = new Map<string, CatTitle>();
  for (const t of metas) {
    const r = profs.get(t.id);
    const z = r ? slots.map((s, j) => (((r.vals[s.idx] ?? mu[j]) - mu[j]) / sd[j]) * s.w) : null;
    const traits = z ? slots.map((s, j) => ({ s, z: z[j] })).filter((x) => x.s.scalar && x.z > 1).sort((a, b) => b.z - a.z).slice(0, 5).map((x) => x.s.key.replace(/^(genre|theme|content)_/, '').replace(/_/g, ' ')) : [];
    const key = titleKey(t.is_tv, t.tmdb_id);
    out.set(key, { id: t.id, key, tmdb: t.tmdb_id, isTv: t.is_tv, title: t.title, year: t.year, voteAvg: t.vote_avg, voteCount: t.vote_count, popularity: t.popularity, genreIds: t.genre_ids ?? [], poster: t.poster_path, vec: z, familiarity: r?.familiarity ?? null, agreement: r?.agreement ?? null, nameConf: r?.name_conf ?? null, traits });
  }
  return out;
}

const cosine = (a: number[], b: number[]) => { let n = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { n += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return x && y ? n / Math.sqrt(x * y) : 0; };

// ── History & folds ─────────────────────────────────────────────────────────

export interface TitleStat { key: string; tmdb: number; isTv: boolean; title: string; year: number | null; firstAt: string; lastAt: string; plays: number; episodes: number }

export function statsBefore(events: WatchEvent[], cutoff: string): Map<string, TitleStat> {
  const m = new Map<string, TitleStat & { eps: Set<string> }>();
  for (const e of events) {
    if (e.at >= cutoff) break;
    let s = m.get(e.key);
    if (!s) { s = { key: e.key, tmdb: e.tmdb, isTv: e.isTv, title: e.title, year: e.year, firstAt: e.at, lastAt: e.at, plays: 0, episodes: 0, eps: new Set() }; m.set(e.key, s); }
    s.plays++; s.lastAt = e.at;
    if (e.isTv) s.eps.add(`${e.season}x${e.episode}`);
  }
  return new Map([...m].map(([k, { eps, ...s }]) => [k, { ...s, episodes: eps.size }]));
}

export interface Fold { index: number; cutoff: string; heldOut: TitleStat[]; visible: Map<string, TitleStat>; later: Set<string> }

export function buildFolds(h: MemberHistory, catalogue: Map<string, CatTitle>, nFolds: number, size: number): Fold[] {
  const all = statsBefore(h.events, '9999');
  // Eligible to hold out: a real (non-bulk-import) first watch of a profiled title.
  const clean = [...all.values()].filter((s) => !h.bulkKeys.has(s.key) && s.firstAt >= '2005' && catalogue.has(s.key)).sort((a, b) => (a.firstAt < b.firstAt ? -1 : 1));
  const folds: Fold[] = [];
  for (let f = 0; f < nFolds; f++) {
    const end = clean.length - size * f, start = end - size;
    if (start < 50) break;
    const heldOut = clean.slice(start, end);
    const cutoff = heldOut[0].firstAt;
    const visible = statsBefore(h.events, cutoff);
    const later = new Set([...all.values()].filter((s) => s.firstAt >= cutoff).map((s) => s.key));
    folds.push({ index: f + 1, cutoff, heldOut, visible, later });
  }
  return folds;
}

// ── Systems ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Familiarity used as a trust weight — except for recent releases, where low
 * familiarity just means "newer than the model's knowledge", not "unreliable
 * profile"; those get a neutral 75 so new titles aren't systematically buried. */
function trustFam(c: CatTitle, cutoffYear: number): number {
  if (c.year != null && c.year >= cutoffYear - 1) return 75;
  return c.familiarity ?? 70;
}

/** A — knowledge base only: weighted item-kNN over Jev attribute profiles. */
export function rankKB(visible: Map<string, TitleStat>, catalogue: Map<string, CatTitle>, cutoff: string, bulk: Set<string>): { ranked: string[]; scores: Map<string, number> } {
  const now = Date.parse(cutoff);
  const cutoffYear = Number(cutoff.slice(0, 4));
  const items: { vec: number[]; w: number; fam: number }[] = [];
  for (const s of visible.values()) {
    const c = catalogue.get(s.key);
    if (!c?.vec) continue;
    const ageDays = (now - Date.parse(s.lastAt)) / DAY;
    const recency = bulk.has(s.key) || s.lastAt < '2005' ? 0.3 : Math.exp(-ageDays / 365);
    const damp = 0.35 + 0.65 * recency;
    const dropped = s.isTv && s.episodes <= 2 && ageDays > 60;           // sampled and abandoned
    const engagement = s.isTv ? Math.min(1.5, 0.4 + s.episodes / 10) : 1 + 0.5 * Math.min(s.plays - 1, 2);
    items.push({ vec: c.vec!, w: dropped ? -0.4 * damp : engagement * damp, fam: trustFam(c, cutoffYear) });
  }
  const pos = items.filter((i) => i.w > 0), neg = items.filter((i) => i.w < 0);
  const ratings = [...catalogue.values()].map((c) => c.voteAvg ?? 65);
  const rMu = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const rSd = Math.sqrt(ratings.reduce((a, b) => a + (b - rMu) ** 2, 0) / ratings.length) || 1;

  const scores = new Map<string, number>();
  for (const c of catalogue.values()) {
    if (!c.vec || visible.has(c.key) || (c.voteCount ?? 0) < 30) continue;
    const cv = c.vec;
    const sims = pos.map((i) => ({ i, s: cosine(cv, i.vec) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 20);
    let score = sims.reduce((a, { i, s }) => a + i.w * s * s * (0.6 + 0.4 * i.fam / 100), 0);
    const nsims = neg.map((i) => ({ w: i.w, s: cosine(cv, i.vec) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
    score -= nsims.reduce((a, { w, s }) => a + Math.abs(w) * s * s, 0);
    const trust = 0.6 + 0.4 * (trustFam(c, cutoffYear) / 100);
    const quality = 1 + 0.1 * Math.max(-2, Math.min(2, ((c.voteAvg ?? rMu) - rMu) / rSd));
    scores.set(c.key, score * trust * quality);
  }
  return { ranked: [...scores].sort((a, b) => b[1] - a[1]).map(([k]) => k), scores };
}

/** Reference baseline: most-voted unwatched titles in the catalogue. */
export function rankPopular(visible: Map<string, TitleStat>, catalogue: Map<string, CatTitle>): string[] {
  return [...catalogue.values()].filter((c) => !visible.has(c.key)).sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0)).map((c) => c.key);
}

async function llm(messages: { role: string; content: string }[], maxTokens = 1500) {
  const res = await fetch(`${requireEnv('SUPABASE_URL')}/functions/v1/kb-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${requireEnv('KB_LLM_TOKEN')}` },
    body: JSON.stringify({ model: 'qwen/qwen3-14b', messages, max_tokens: maxTokens }),
  });
  const j = await res.json() as { content?: string; usage?: { prompt_tokens: number; completion_tokens: number; cost?: number }; error?: string };
  if (!res.ok) throw new Error(`kb-llm ${res.status}: ${j.error}`);
  return j;
}

/** Same history view the app gives the control: Trakt order (newest first), 50 films / 30 shows. */
function traktArrays(visible: Map<string, TitleStat>) {
  const byRecent = [...visible.values()].sort((a, b) => (a.lastAt > b.lastAt ? -1 : 1));
  const watchedMovies = byRecent.filter((s) => !s.isTv).map((s) => ({ plays: s.plays, last_watched_at: s.lastAt, movie: { title: s.title, year: s.year, ids: { tmdb: s.tmdb } } }));
  const watchedShows = byRecent.filter((s) => s.isTv).map((s) => ({ plays: s.plays, last_watched_at: s.lastAt, show: { title: s.title, year: s.year, ids: { tmdb: s.tmdb } }, seasons: [] }));
  return { watchedMovies, watchedShows };
}

/** Viewer history exactly as B and E both see it (same wording, same caps). */
function historyBlock(visible: Map<string, TitleStat>): string {
  const { watchedMovies, watchedShows } = traktArrays(visible);
  const recentM = watchedMovies.slice(0, 50).map((m) => `${m.movie.title} (${m.movie.year})`).join(', ');
  const recentS = watchedShows.slice(0, 30).map((s) => `${s.show.title} (${s.show.year}, ${visible.get(titleKey(true, s.show.ids.tmdb))?.episodes ?? 0} eps)`).join(', ');
  const lovedM = watchedMovies.filter((m) => m.plays > 1).sort((a, b) => b.plays - a.plays).slice(0, 15).map((m) => `${m.movie.title} (×${m.plays})`).join(', ');
  return `VIEWER HISTORY (newest first)
- Films: ${recentM || 'none'}
- TV: ${recentS || 'none'}
${lovedM ? `- Rewatched films: ${lovedM}` : ''}`;
}

/** E — direct Qwen over the same catalogue universe, with NO Jev input:
 * no retrieval, no traits, no familiarity. Candidates are every unwatched
 * catalogue title (title, year, format only), shuffled with a fixed seed so
 * list order carries no ranking signal. Same model, history and rules as B. */
export async function rankDirectQwen(visible: Map<string, TitleStat>, catalogue: Map<string, CatTitle>, seed: number): Promise<{ ranked: string[]; costUsd: number; tokens: number; poolSize: number }> {
  let x = seed >>> 0 || 1;
  const rand = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pool = [...catalogue.values()].filter((c) => !visible.has(c.key));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cands = pool.map((c, i) => `${i + 1}. ${c.title} (${c.year}) · ${c.isTv ? 'TV' : 'film'}`).join('\n');
  const prompt = `/no_think
You are a recommendation engine for one viewer. From the CANDIDATES below, choose the 20 they are most likely to actually watch next, best first.

${historyBlock(visible)}

CANDIDATES
${cands}

Rules: only pick from the candidates; use their numbers; balance films and TV the way this viewer does; prefer genuine taste matches over famous titles.
Output ONLY JSON: {"picks":[numbers, best first]}`;
  const r = await llm([{ role: 'user', content: prompt }], 400);
  const nums = (r.content?.match(/\[([\d,\s]+)\]/)?.[1] ?? '').split(',').map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= pool.length);
  const ranked = [...new Set(nums)].map((n) => pool[n - 1].key);
  return { ranked, costUsd: r.usage?.cost ?? 0, tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0), poolSize: pool.length };
}

// TMDB "recommendations" per title, cached on disk so every run and fold sees
// the same lists (TMDB's lists drift over time).
const RECS_CACHE = new URL('../experiment/tmdb-recs-cache.json', import.meta.url).pathname;
let recsCache: Record<string, number[]> | null = null;
async function cachedRecs(key: string, tmdb: number, isTv: boolean): Promise<number[]> {
  recsCache ??= existsSync(RECS_CACHE) ? JSON.parse(readFileSync(RECS_CACHE, 'utf8')) : {};
  if (!recsCache![key]) {
    recsCache![key] = await tmdbRecommendations(tmdb, isTv).catch(() => []);
    writeFileSync(RECS_CACHE, JSON.stringify(recsCache));
  }
  return recsCache![key];
}

/** E2 — Qwen re-ranking a NON-Jev shortlist: the 60 unwatched catalogue titles
 * most recommended by TMDB for the viewer's 25 most recent pre-cut-off titles
 * (weighted by recency rank and engagement). Same prompt, model and history as
 * B, minus the Jev trait column. B vs E2 isolates what Jev adds over a generic
 * shortlist; E2 vs E isolates what shortlisting adds for a small model. */
export async function rankShortlistQwen(visible: Map<string, TitleStat>, catalogue: Map<string, CatTitle>): Promise<{ ranked: string[]; costUsd: number; tokens: number; shortlist: number }> {
  const recent = [...visible.values()].sort((a, b) => (a.lastAt > b.lastAt ? -1 : 1)).slice(0, 25);
  const score = new Map<string, number>();
  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    const engagement = s.isTv ? Math.min(1.5, 0.4 + s.episodes / 10) : 1 + 0.5 * Math.min(s.plays - 1, 2);
    const w = engagement / (1 + 0.1 * i);
    const recs = await cachedRecs(s.key, s.tmdb, s.isTv);
    recs.forEach((id, pos) => {
      const k = titleKey(s.isTv, id);
      if (!catalogue.has(k) || visible.has(k)) return;
      score.set(k, (score.get(k) ?? 0) + w * (1 - pos / 40));   // earlier in TMDB's list counts more
    });
  }
  const shortlist = [...score].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const pool = shortlist.slice(0, 60).map((k) => catalogue.get(k)!);
  const cands = pool.map((c, i) => `${i + 1}. ${c.title} (${c.year}) · ${c.isTv ? 'TV' : 'film'}`).join('\n');
  const prompt = `/no_think
You are a recommendation engine for one viewer. From the CANDIDATES below, choose the 20 they are most likely to actually watch next, best first.

${historyBlock(visible)}

CANDIDATES
${cands}

Rules: only pick from the candidates; use their numbers; balance films and TV the way this viewer does; prefer genuine taste matches over famous titles.
Output ONLY JSON: {"picks":[numbers, best first]}`;
  const r = await llm([{ role: 'user', content: prompt }], 400);
  const nums = (r.content?.match(/\[([\d,\s]+)\]/)?.[1] ?? '').split(',').map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= pool.length);
  const picked = [...new Set(nums)].map((n) => pool[n - 1].key);
  const ranked = [...picked, ...shortlist.filter((k) => !picked.includes(k))];
  return { ranked, costUsd: r.usage?.cost ?? 0, tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0), shortlist: pool.length };
}

/** B — knowledge base retrieval (A's top 60) re-ranked by the same LLM the control uses. */
export async function rankKBPlusAI(visible: Map<string, TitleStat>, aRanked: string[], catalogue: Map<string, CatTitle>): Promise<{ ranked: string[]; costUsd: number; tokens: number }> {
  const pool = aRanked.slice(0, 60).map((k) => catalogue.get(k)!);
  const history = historyBlock(visible);
  const cands = pool.map((c, i) => `${i + 1}. ${c.title} (${c.year}) · ${c.isTv ? 'TV' : 'film'} · ${c.traits.join(', ') || 'no standout traits'}`).join('\n');
  const prompt = `/no_think
You are a recommendation engine for one viewer. From the CANDIDATES below, choose the 20 they are most likely to actually watch next, best first.

${history}

CANDIDATES (with their most distinctive traits)
${cands}

Rules: only pick from the candidates; use their numbers; balance films and TV the way this viewer does; prefer genuine taste matches over famous titles.
Output ONLY JSON: {"picks":[numbers, best first]}`;
  const r = await llm([{ role: 'user', content: prompt }], 400);
  const nums = (r.content?.match(/\[([\d,\s]+)\]/)?.[1] ?? '').split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= pool.length);
  const picked = [...new Set(nums)].map((n) => pool[n - 1].key);
  const ranked = [...picked, ...aRanked.filter((k) => !picked.includes(k))];
  return { ranked, costUsd: r.usage?.cost ?? 0, tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0) };
}

/** C — control: the deployed ai-chat function, unmodified, called exactly as the app does. */
export interface ControlStats { calls: number; emptyReplies: number; failedCalls: number; rawTitles: number; repeats: number; unresolved: number }

export async function rankDirectAI(visible: Map<string, TitleStat>, rounds: number, log: (m: string) => void): Promise<{ picks: { title: string; year: number | null; isTv: boolean; key: string | null }[]; calls: number; stats: ControlStats }> {
  // Instrumentation only — counts what the control returns; behaviour unchanged.
  const stats: ControlStats = { calls: 0, emptyReplies: 0, failedCalls: 0, rawTitles: 0, repeats: 0, unresolved: 0 };
  const anon = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: requireEnv('EXPERIMENT_USER_EMAIL'), password: requireEnv('EXPERIMENT_USER_PASSWORD') });
  if (error || !data.session) throw new Error(`experiment sign-in: ${error?.message}`);
  const { watchedMovies, watchedShows } = traktArrays(visible);
  const messages: { role: string; content: string }[] = [];
  const picks: { title: string; year: number | null; isTv: boolean; key: string | null }[] = [];
  const asks = ['What should I watch next?', 'Give me more recommendations — different titles.'];

  for (let round = 0; round < rounds; round++) {
    messages.push({ role: 'user', content: asks[Math.min(round, 1)] });
    const res = await fetch(`${requireEnv('SUPABASE_URL')}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({
        action: 'ask', messages,
        watchedMovies: watchedMovies.slice(0, 50), watchedShows: watchedShows.slice(0, 30),
        favoriteGenres: [], inSessionTitles: picks.map((p) => p.title),
      }),
    });
    stats.calls++;
    const text = await res.text();
    const done = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).find((e) => e?.t === 'd');
    if (!done) { stats.failedCalls++; log(`    C round ${round + 1}: no result (${res.status} ${text.slice(0, 120)})`); messages.pop(); continue; }
    if (!(done.m?.length || done.s?.length)) stats.emptyReplies++;
    messages.push({ role: 'assistant', content: done.r });
    if (process.env.KB_DEBUG) log(`    C round ${round + 1}: movies=${JSON.stringify(done.m)} shows=${JSON.stringify(done.s)}`);
    const add = async (titles: string[], years: (number | null)[], isTv: boolean) => {
      for (let i = 0; i < titles.length; i++) {
        const title = titles[i].replace(/\s*\(\d{4}\)\s*$/, '').trim();
        const stated = titles[i].match(/\((\d{4})\)/)?.[1];
        const year = years?.[i] ?? (stated ? Number(stated) : null);
        stats.rawTitles++;
        if (picks.some((p) => p.title.toLowerCase() === title.toLowerCase())) { stats.repeats++; continue; }  // the control repeats itself across rounds
        // Resolve exactly as the app does (ported searchTitleWithFallback).
        const hit = await resolveLikeApp(title, year, isTv ? 'tv' : 'movie').catch(() => null);
        if (!hit) stats.unresolved++;
        picks.push({ title, year: year || null, isTv: hit?.isTv ?? isTv, key: hit ? titleKey(hit.isTv, hit.id) : null });
      }
    };
    // Like the app: at most 10 of each type per reply.
    await add((done.m ?? []).slice(0, 10), done.my ?? [], false);
    await add((done.s ?? []).slice(0, 10), done.sy ?? [], true);
  }
  return { picks, calls: rounds, stats };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface SystemResult {
  system: string; top: (string | null)[];  // keys (null = unresolvable title)
  labels: string[];                        // human-readable top list
  fullRanks?: Map<string, number>;         // rank of every candidate (A/B/P)
  costUsd: number; tokens: number;
}

export function metrics(r: SystemResult, fold: Fold, catalogue: Map<string, CatTitle>, watchlist: Set<string>) {
  const held = new Set(fold.heldOut.map((h) => h.key));
  const top = r.top.filter((k) => !k || !fold.visible.has(k)).slice(0, 20);
  const hitsAt = (k: number) => top.slice(0, k).filter((x) => x && held.has(x)).length;
  const hitRanks = top.map((k, i) => (k && held.has(k) ? i + 1 : 0)).filter(Boolean);
  const relevant = top.filter((k) => k && (held.has(k) || fold.later.has(k) || watchlist.has(k))).length;
  const known = top.map((k) => (k ? catalogue.get(k) : undefined)).filter((c): c is CatTitle => !!c);
  const genres = new Map<number, number>();
  for (const c of known) for (const g of c.genreIds.slice(0, 2)) genres.set(g, (genres.get(g) ?? 0) + 1);
  const tot = [...genres.values()].reduce((a, b) => a + b, 0);
  const entropy = tot ? -[...genres.values()].reduce((a, n) => a + (n / tot) * Math.log2(n / tot), 0) : 0;
  let pd = 0, pn = 0;
  const vecs = known.map((c) => c.vec).filter((v): v is number[] => !!v);
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { pd += 1 - cosine(vecs[i], vecs[j]); pn++; }
  const votes = known.map((c) => c.voteCount ?? 0).sort((a, b) => a - b);
  const bad = top.filter((k) => !k).length + known.filter((c) => (c.voteAvg ?? 0) < 60 || (c.voteCount ?? 0) < 100).length;
  const fullRank = r.fullRanks ? fold.heldOut.map((h) => r.fullRanks!.get(h.key) ?? Infinity).filter(Number.isFinite) : [];
  return {
    hits5: hitsAt(5), hits10: hitsAt(10), hits20: hitsAt(20), hitRanks, relevant, n: top.length,
    genreEntropy: entropy, profileDiversity: pn ? pd / pn : null, coverage: known.length,
    medianVotes: votes.length ? votes[Math.floor(votes.length / 2)] : null,
    longTailShare: known.length ? known.filter((c) => (c.voteCount ?? 0) < 2000).length / known.length : null,
    bad, tvShare: top.length ? top.filter((k) => k?.startsWith('t')).length / top.length : 0,
    medianHeldOutRank: fullRank.length ? fullRank.sort((a, b) => a - b)[Math.floor(fullRank.length / 2)] : null,
  };
}

export const label = (c: CatTitle | undefined, fallback: string) => (c ? `${c.title} (${c.year})${c.isTv ? ' [TV]' : ''}` : fallback);
export { GENRE_NAMES };
