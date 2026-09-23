import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { db, must } from './db.ts';

// Final experiment report → kb/experiment/report.md (gitignored: personal data).
// Data sections are generated; the recommendation section is appended by hand
// from kb/experiment/conclusions.md if present.

type HeldPos = { title: string; year: number | null; recent: boolean; fam: number | null; pos: number | null; pct: number | null };
type RecItem = { title: string | null; year?: number | null; tv?: boolean; genres?: number[]; votes?: number | null; rating?: number | null; fam?: number | null; agreement?: number | null; nameConf?: number | null; unresolvedOrOutsideCatalogue?: string | null };
type ControlStats = { calls: number; emptyReplies: number; failedCalls: number; rawTitles: number; repeats: number; unresolved: number };
type Row = {
  member: string; fold: number; cutoff: string; system: string; top: string[]; heldOut: string[]; hits: string[]; costUsd: number; tokens: number;
  fullRanking?: boolean; listLen?: number; heldOutPos?: HeldPos[]; recItems?: RecItem[]; controlStats?: ControlStats;
  metrics: { hits5: number; hits10: number; hits20: number; relevant: number; n: number; genreEntropy: number; profileDiversity: number | null };
};
type Choice = { roundId: string; member: string; pick: 'left' | 'right' | 'none'; reason?: string };
type KeyRow = { id: string; member: string; left: string; right: string; band: string };
type Round = { id: string; left: { title: string; year: number | null; tv: boolean }[]; right: { title: string; year: number | null; tv: boolean }[] };

export const NAMES: Record<string, string> = {
  A_kb: 'A · Jev KB only', B_kb_ai: 'B · Jev KB + Qwen', C_direct_ai: 'C · Today\'s AI (control)', D_popular: 'D · Most popular',
  E_direct_qwen: 'E · Qwen, whole catalogue', E2_shortlist_qwen: 'E2 · TMDB shortlist + Qwen',
};
const ORDER = ['B_kb_ai', 'A_kb', 'E2_shortlist_qwen', 'E_direct_qwen', 'C_direct_ai', 'D_popular'];
const GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy',
  36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War',
  37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '–');
const n0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '–');

/** P(X ≥ k) for X ~ Binomial(n, p). */
function binomTail(k: number, n: number, p: number): number {
  const lg = [0]; for (let i = 1; i <= n; i++) lg[i] = lg[i - 1] + Math.log(i);
  let t = 0;
  for (let i = k; i <= n; i++) t += Math.exp(lg[n] - lg[i] - lg[n - i] + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, t);
}
/** Two-sided sign test on paired wins/losses (ties dropped). */
const signTest = (w: number, l: number) => (w + l ? Math.min(1, 2 * binomTail(Math.max(w, l), w + l, 0.5)) : 1);
const evidence = (p: number, effectOk: boolean) => (!effectOk ? 'inconclusive' : p < 0.01 ? '**strong evidence**' : p < 0.1 ? '**directional signal**' : 'inconclusive');
const pv = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(p < 0.1 ? 3 : 2)}`);

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => { const o = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); o.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b), ma = avg(ra), mb = avg(rb);
  let n = 0, da = 0, dbb = 0;
  for (let i = 0; i < a.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; dbb += (rb[i] - mb) ** 2; }
  return da && dbb ? n / Math.sqrt(da * dbb) : 0;
}

export async function writeExperimentReport(root: string, resultsFile: string, blindChoicesFile?: string): Promise<string> {
  const res = JSON.parse(readFileSync(`${root}experiment/${resultsFile}`, 'utf8')) as { generatedAt: string; framework: string; catalogueSize: number; controlCalls: number; controlCostUsd: number; rows: Row[] };
  const rows = res.rows;
  const systems = ORDER.filter((s) => rows.some((r) => r.system === s));
  const of = (s: string) => rows.filter((r) => r.system === s);
  const folds = [...new Set(rows.map((r) => `${r.member}#${r.fold}`))];
  const L: string[] = [];

  L.push('# Does the Jev knowledge base make NextUp better at recommending?', '',
    `Experiment run ${res.generatedAt.slice(0, 16)}Z · framework ${res.framework} · catalogue ${res.catalogueSize.toLocaleString('en-GB')} titles, all Jev-profiled · ${folds.length} time-split folds × 20 hidden titles.`, '',
    '**Canonical history:** Trakt export with 7 March 2026 excluded (guests) and re-logged plays within 3 hours merged (4,201 → 4,057 plays). Each fold shows a system only what was first watched before its cut-off, and asks it to rediscover the next 20 titles actually started.', '',
    '**Systems:** A Jev KB only (item-kNN over profiles) · B Jev KB top-60 → Qwen re-rank · C today\'s NextUp AI (deployed `ai-chat`, unchanged) · D most-popular unwatched · E Qwen choosing from the whole ~1,550-title unwatched catalogue · E2 TMDB-related top-60 → same Qwen prompt as B, no Jev.', '');

  // ── 1. Retrieval ────────────────────────────────────────────────────────
  const heldAll = of(systems[0]).flatMap((r) => r.heldOutPos ?? []);
  const nHeld = heldAll.length, nOld = heldAll.filter((h) => !h.recent).length, nNew = nHeld - nOld;
  const poolSize = avg(of('D_popular').map((r) => r.listLen ?? 0)) || 1550;
  L.push('## 1. Hidden-title retrieval', '',
    `${nHeld} hidden titles: ${nOld} released before 2025, ${nNew} released 2025–26 (newer than the models' knowledge). A random 20-title list from ~${Math.round(poolSize)} candidates finds ${(20 / poolSize * 20).toFixed(2)} per fold — **≈${(20 / poolSize * nHeld).toFixed(1)} across all folds by chance.**`, '',
    '| system | hits@5 | hits@10 | hits@20 | folds with ≥1 hit@20 | titles output per fold |', '|---|---|---|---|---|---|');
  for (const s of systems) {
    const rs = of(s);
    L.push(`| ${NAMES[s]} | ${sum(rs.map((r) => r.metrics.hits5))} | ${sum(rs.map((r) => r.metrics.hits10))} | **${sum(rs.map((r) => r.metrics.hits20))}** | ${rs.filter((r) => r.metrics.hits20 > 0).length}/${rs.length} | ${avg(rs.map((r) => r.metrics.n)).toFixed(1)} |`);
  }
  const hitTitles = (s: string) => of(s).flatMap((r) => r.hits.map((h) => `${h.replace(/^\d+\.\s*/, '')} (fold ${r.fold}, #${h.match(/^(\d+)/)?.[1]})`));
  L.push('', ...systems.map((s) => `- ${NAMES[s]} found: ${hitTitles(s).join('; ') || 'none'}`), '');

  // Full-ranking view (A, B, D rank every unwatched catalogue title)
  const bands: [string, number, number][] = [['top 20 (≈1.3%)', 0, 20 / poolSize], ['1.3–5%', 20 / poolSize, 0.05], ['5–10%', 0.05, 0.10], ['10–25%', 0.10, 0.25], ['25–50%', 0.25, 0.5], ['bottom half', 0.5, 1.01]];
  const fullSys = systems.filter((s) => of(s)[0]?.fullRanking);
  const topShare = (s: string, which: 'old' | 'new' | 'all', cut: number) => {
    const hs = of(s).flatMap((r) => r.heldOutPos ?? []).filter((h) => h.pct != null && (which === 'all' || (which === 'new') === h.recent));
    return { n: hs.length, k: hs.filter((h) => h.pct! <= cut).length, mean: avg(hs.map((h) => h.pct!)), median: quant(hs.map((h) => h.pct!), 0.5), pcts: hs.map((h) => h.pct!) };
  };
  L.push('### Where hidden titles land in the full ranking', '',
    'A, B and D rank every unwatched catalogue title, so each hidden title has a position (percentile; lower is better, random = 50%). C and E only output a short list; E2 ranks only its 60-title shortlist.', '',
    `| system | titles | mean position | median position | ${bands.map((b) => b[0]).join(' | ')} |`, `|---|---|---|---|${bands.map(() => '---').join('|')}|`);
  for (const s of fullSys) {
    const t = topShare(s, 'all', 1);
    L.push(`| ${NAMES[s]} | ${t.n} | ${pct(t.mean)} | ${pct(t.median)} | ${bands.map(([, lo, hi]) => t.pcts.filter((p) => p > lo && p <= hi).length).join(' | ')} |`);
  }
  L.push(`| _expected by chance_ | ${topShare(fullSys[0] ?? 'A_kb', 'all', 1).n} | 50% | 50% | ${bands.map(([, lo, hi]) => (topShare(fullSys[0] ?? 'A_kb', 'all', 1).n * (Math.min(1, hi) - lo)).toFixed(1)).join(' | ')} |`, '');

  // ── 2. Age split ────────────────────────────────────────────────────────
  L.push('## 2. Older titles vs 2025–26 releases', '', 'Jev and Qwen can reasonably know pre-2025 titles; 2025–26 releases are judged only from their TMDB evidence, so they are reported separately and not held against Jev.', '',
    '| system | older: in top 10% | older: expected | older: p (≥ by chance) | older: mean position | 2025–26: in top 10% | 2025–26: expected | 2025–26: mean position |', '|---|---|---|---|---|---|---|---|');
  for (const s of fullSys) {
    const o = topShare(s, 'old', 0.10), nw = topShare(s, 'new', 0.10);
    L.push(`| ${NAMES[s]} | **${o.k}**/${o.n} | ${(o.n * 0.1).toFixed(1)} | ${pv(binomTail(o.k, o.n, 0.1))} | ${pct(o.mean)} | ${nw.k}/${nw.n} | ${(nw.n * 0.1).toFixed(1)} | ${pct(nw.mean)} |`);
  }
  const hitsBy = (s: string, recent: boolean) => of(s).flatMap((r) => (r.heldOutPos ?? []).filter((h) => h.recent === recent && h.pos != null && h.pos <= 20 && r.hits.some((x) => x.includes(h.title)))).length;
  L.push('', `Top-20 hits split — ${systems.map((s) => `${NAMES[s].split(' · ')[0]}: ${hitsBy(s, false)} older / ${hitsBy(s, true)} new`).join(' · ')}`, '');

  // ── 3. Popularity ───────────────────────────────────────────────────────
  L.push('## 3. Popularity of what each system recommends', '', '| system | median TMDB votes | IQR | long-tail (<2,000 votes) | obscure (<500) | rated < 6.0 | outside catalogue / unresolved |', '|---|---|---|---|---|---|---|');
  for (const s of systems) {
    const items = of(s).flatMap((r) => r.recItems ?? []);
    const known = items.filter((i) => i.title != null && i.votes != null);
    const v = known.map((i) => i.votes as number);
    L.push(`| ${NAMES[s]} | ${n0(quant(v, 0.5))} | ${n0(quant(v, 0.25))}–${n0(quant(v, 0.75))} | ${pct(v.filter((x) => x < 2000).length / (v.length || NaN))} | ${pct(v.filter((x) => x < 500).length / (v.length || NaN))} | ${pct(known.filter((i) => (i.rating ?? 100) < 60).length / (known.length || NaN))} | ${items.length - known.length}/${items.length} |`);
  }
  L.push('');

  // ── 4. Diversity / clumping ─────────────────────────────────────────────
  L.push('## 4. Diversity — do lists clump?', '', 'Per fold top 20, averaged. "Comedy TV share" tracks the sitcom/sketch-comedy clustering seen in A earlier.', '',
    '| system | genre entropy (bits) | attribute diversity | dominant genre (share) | TV share | comedy-TV share |', '|---|---|---|---|---|---|');
  for (const s of systems) {
    const rs = of(s);
    const items = rs.flatMap((r) => r.recItems ?? []).filter((i) => i.title != null);
    const gc = new Map<number, number>();
    for (const i of items) for (const g of (i.genres ?? []).slice(0, 2)) gc.set(g, (gc.get(g) ?? 0) + 1);
    const [topG, topN] = [...gc].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    const tvShare = items.filter((i) => i.tv).length / (items.length || NaN);
    const comedyTv = items.filter((i) => i.tv && (i.genres ?? []).includes(35)).length / (items.length || NaN);
    L.push(`| ${NAMES[s]} | ${avg(rs.map((r) => r.metrics.genreEntropy)).toFixed(2)} | ${avg(rs.map((r) => r.metrics.profileDiversity ?? NaN)).toFixed(2)} | ${GENRES[topG] ?? '–'} (${pct(topN / (items.length || NaN))}) | ${pct(tvShare)} | ${pct(comedyTv)} |`);
  }
  L.push('', 'Sample (fold 1, top 10):', '', ...systems.map((s) => `- **${NAMES[s]}**: ${of(s)[0]?.top.slice(0, 10).join(' · ') || '–'}`), '');

  // ── 5. Control behaviour ────────────────────────────────────────────────
  const cs = of('C_direct_ai').map((r) => ({ fold: r.fold, s: r.controlStats, unique: r.top.length, inCat: (r.recItems ?? []).filter((i) => i.title != null).length }));
  if (cs.length) {
    L.push('## 5. Today\'s AI (C) — how it behaves', '', 'Each fold: 10 requests ("What should I watch next?", then "Give me more — different titles"), exactly as a persistent user would ask. Titles resolved with a verbatim port of the app\'s own TMDB lookup.', '',
      '| fold | requests | failed | empty/unparseable replies | titles returned | repeats | unique | unresolved | in catalogue |', '|---|---|---|---|---|---|---|---|---|');
    for (const c of cs) L.push(`| ${c.fold} | ${c.s?.calls ?? '–'} | ${c.s?.failedCalls ?? '–'} | ${c.s?.emptyReplies ?? '–'} | ${c.s?.rawTitles ?? '–'} | ${c.s?.repeats ?? '–'} | ${c.unique} | ${c.s?.unresolved ?? '–'} | ${c.inCat} |`);
    L.push('', `Control LLM cost: $${res.controlCostUsd.toFixed(4)} (${res.controlCalls} calls logged).`, '');
  }

  // ── 6. Familiarity ──────────────────────────────────────────────────────
  const fw = must(await db().from('kb_frameworks').select('id').eq('version', res.framework).single(), 'fw').id;
  const profs: { familiarity: number; agreement: number; name_conf: number; kb_titles: { title: string; year: number } }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db().from('kb_title_profiles').select('familiarity, agreement, name_conf, kb_titles!inner(title, year, tmdb_id)').eq('framework_id', fw).gt('kb_titles.tmdb_id', 0).not('familiarity', 'is', null).range(from, from + 999), 'fam') as unknown as typeof profs;
    profs.push(...page);
    if (page.length < 1000) break;
  }
  const fam = profs.map((p) => p.familiarity);
  const bucket = (lo: number, hi: number) => fam.filter((f) => f >= lo && f < hi).length;
  const bluffs = profs.filter((p) => p.name_conf >= 60 && p.agreement < 50);
  L.push('## 6. Familiarity (Jev trust signal)', '',
    `Catalogue + validation profiles (${fam.length}): 0–19: ${bucket(0, 20)} · 20–39: ${bucket(20, 40)} · 40–59: ${bucket(40, 60)} · 60–79: ${bucket(60, 80)} · 80–100: ${bucket(80, 101)} · median ${quant(fam, 0.5)}.`, '',
    `High-confidence / low-agreement (name-only confidence ≥ 60, agreement < 50 — Jev sounded sure from the name alone but the evidence disagreed): **${bluffs.length}** titles, e.g. ${bluffs.slice(0, 8).map((b) => `${b.kb_titles.title} (${b.kb_titles.year})`).join(', ')}.`, '');
  L.push('| system | median familiarity of recommendations | share < 40 |', '|---|---|---|');
  for (const s of systems.filter((x) => x !== 'C_direct_ai')) {
    const f = of(s).flatMap((r) => r.recItems ?? []).map((i) => i.fam).filter((x): x is number => x != null);
    L.push(`| ${NAMES[s]} | ${quant(f, 0.5)} | ${pct(f.filter((x) => x < 40).length / (f.length || NaN))} |`);
  }
  const aHeld = of('A_kb').flatMap((r) => r.heldOutPos ?? []).filter((h) => h.pct != null && h.fam != null && !h.recent);
  if (aHeld.length > 5) {
    const rho = spearman(aHeld.map((h) => h.fam!), aHeld.map((h) => -h.pct!));
    L.push('', `Does familiarity relate to quality? Among older hidden titles, Spearman ρ between a title's familiarity and how high A ranked it = **${rho.toFixed(2)}** (n=${aHeld.length}; positive = A ranks well-known titles better). ${Math.abs(rho) < 0.2 ? 'Little relationship.' : rho > 0 ? 'A works better on titles Jev knows well.' : 'A works better on less-familiar titles.'}`);
  }
  L.push('');

  // ── 7. Key comparisons ──────────────────────────────────────────────────
  const hits = (s: string) => sum(of(s).map((r) => r.metrics.hits20));
  const hitCompare = (a: string, b: string) => { const ha = hits(a), hb = hits(b); return { text: `hits@20 ${ha} vs ${hb}`, p: signTest(ha, hb), eff: Math.abs(ha - hb) >= 3 }; };
  // Paired full-ranking comparison (A/B/D): per hidden title, which system ranked it higher.
  const paired = (a: string, b: string, onlyOld = false) => {
    let w = 0, l = 0;
    for (const fold of of(a).map((r) => r.fold)) {
      const ha = of(a).find((r) => r.fold === fold)?.heldOutPos ?? [], hb = of(b).find((r) => r.fold === fold)?.heldOutPos ?? [];
      for (const x of ha) { if (onlyOld && x.recent) continue; const y = hb.find((z) => z.title === x.title); if (x.pct == null || y?.pct == null || x.pct === y.pct) continue; if (x.pct < y.pct) w++; else l++; }
    }
    return { w, l, p: signTest(w, l) };
  };
  const blind = loadBlind(root, blindChoicesFile);
  const blindFor = (a: string, b: string) => blind?.pairs.get([a, b].sort().join('|'));
  const qs: [string, string, string, string][] = [
    ['B vs C', 'B_kb_ai', 'C_direct_ai', 'Does Jev + Qwen improve on today\'s NextUp AI?'],
    ['B vs E', 'B_kb_ai', 'E_direct_qwen', 'Does the Jev KB improve Qwen versus Qwen choosing from the whole catalogue?'],
    ['B vs E2', 'B_kb_ai', 'E2_shortlist_qwen', 'Does Jev\'s candidate selection beat a conventional TMDB-related shortlist? (cleanest test of Jev\'s semantic value)'],
    ['E2 vs E', 'E2_shortlist_qwen', 'E_direct_qwen', 'How much comes simply from giving Qwen a sensible shortlist?'],
    ['A vs D', 'A_kb', 'D_popular', 'Does the Jev KB contain taste signal beyond popularity?'],
    ['A vs E', 'A_kb', 'E_direct_qwen', 'Structured Jev matching vs direct Qwen selection'],
  ];
  L.push('## 7. The key comparisons', '');
  for (const [label, a, b, q] of qs) {
    if (!systems.includes(a) || !systems.includes(b)) continue;
    const h = hitCompare(a, b);
    const lines = [`**${label} — ${q}**`, `- Hidden titles: ${h.text} → ${evidence(h.p, h.eff)} (${pv(h.p)}).`];
    if (of(a)[0]?.fullRanking && of(b)[0]?.fullRanking) {
      const pOld = paired(a, b, true);
      lines.push(`- Full ranking, older titles: ${NAMES[a].split(' · ')[0]} ranked the hidden title higher ${pOld.w} times, ${NAMES[b].split(' · ')[0]} ${pOld.l} times → ${evidence(pOld.p, Math.abs(pOld.w - pOld.l) >= 4)} (sign test, ${pv(pOld.p)}).`);
    }
    const bl = blindFor(a, b);
    lines.push(bl ? `- Blind preference: ${NAMES[a].split(' · ')[0]} ${bl.wins[a] ?? 0} · ${NAMES[b].split(' · ')[0]} ${bl.wins[b] ?? 0} · no preference ${bl.none} (${bl.total} rounds) → ${bl.total < 4 ? 'too few rounds to judge' : evidence(signTest(bl.wins[a] ?? 0, bl.wins[b] ?? 0), Math.abs((bl.wins[a] ?? 0) - (bl.wins[b] ?? 0)) >= 2)}.` : '- Blind preference: not answered yet.');
    L.push(...lines, '');
  }

  // ── 8. Blind test detail ────────────────────────────────────────────────
  L.push('## 8. Blind preference test', '');
  if (blind) {
    L.push(`${blind.answered} of ${blind.key.length} rounds answered. Rows were anonymous ("Row 1/Row 2", sides randomised); each round compares two systems' picks 1–5 or 6–10.`, '',
      '| round | band | Row 1 | Row 2 | chosen | reason |', '|---|---|---|---|---|---|');
    for (const k of blind.key) {
      const c = blind.choices.find((x) => x.roundId === k.id);
      const won = !c ? '—' : c.pick === 'none' ? 'no preference' : NAMES[c.pick === 'left' ? k.left : k.right];
      L.push(`| ${k.id} | ${k.band} | ${NAMES[k.left]} | ${NAMES[k.right]} | ${won} | ${c?.reason ? c.reason.replace(/\|/g, '/') : ''} |`);
    }
    const agg = new Map<string, { w: number; l: number; t: number }>();
    for (const k of blind.key) {
      const c = blind.choices.find((x) => x.roundId === k.id);
      if (!c) continue;
      for (const s of [k.left, k.right]) agg.set(s, agg.get(s) ?? { w: 0, l: 0, t: 0 });
      if (c.pick === 'none') { agg.get(k.left)!.t++; agg.get(k.right)!.t++; continue; }
      const win = c.pick === 'left' ? k.left : k.right, lose = c.pick === 'left' ? k.right : k.left;
      agg.get(win)!.w++; agg.get(lose)!.l++;
    }
    L.push('', '**Aggregate (all rounds a system appeared in):**', '', '| system | won | lost | no preference | win rate (excl. ties) |', '|---|---|---|---|---|',
      ...ORDER.filter((s) => agg.has(s)).map((s) => { const a = agg.get(s)!; return `| ${NAMES[s]} | ${a.w} | ${a.l} | ${a.t} | ${pct(a.w / ((a.w + a.l) || NaN))} |`; }), '');
    L.push('**Rows shown in each answered round** (all rounds, not selected):', '');
    for (const k of blind.key) {
      const r = blind.rounds.find((x) => x.id === k.id);
      if (!r) continue;
      const fmt = (xs: Round['left']) => xs.map((i) => `${i.title}${i.tv ? ' (TV)' : ''}`).join(', ');
      L.push(`- ${k.id} — ${NAMES[k.left]}: ${fmt(r.left)} ‖ ${NAMES[k.right]}: ${fmt(r.right)}`);
    }
  } else {
    L.push('_Not answered yet._');
  }
  L.push('');

  // ── 9. Cost ─────────────────────────────────────────────────────────────
  const runs: { cost_usd: number | null; input_tokens: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db().from('kb_classification_runs').select('cost_usd, input_tokens').eq('status', 'done').range(from, from + 999), 'runs');
    runs.push(...page);
    if (page.length < 1000) break;
  }
  L.push('## 9. Cost', '', `- Jev, all profiling to date (both framework versions, catalogue + validation): ${runs.length.toLocaleString('en-GB')} profiles, ${(sum(runs.map((r) => r.input_tokens ?? 0)) / 1e6).toFixed(1)}M tokens, **$${sum(runs.map((r) => r.cost_usd ?? 0)).toFixed(2)}** (≈$0.00064/title with the familiarity probe).`,
    `- Qwen3-14B via OpenRouter, this run: ${systems.map((s) => `${NAMES[s].split(' · ')[0]} $${(s === 'C_direct_ai' ? res.controlCostUsd : sum(of(s).map((r) => r.costUsd))).toFixed(4)}`).join(' · ')}.`, '');

  const concl = `${root}experiment/conclusions.md`;
  if (existsSync(concl)) L.push(readFileSync(concl, 'utf8'));

  const out = `${root}experiment/report.md`;
  writeFileSync(out, L.join('\n'));
  return out;
}

function loadBlind(root: string, file?: string) {
  const keyPath = `${root}experiment/blind-key.json`, roundsPath = `${root}experiment/blind/rounds.json`;
  if (!file || !existsSync(`${root}experiment/${file}`) || !existsSync(keyPath)) return null;
  const key = JSON.parse(readFileSync(keyPath, 'utf8')) as KeyRow[];
  const rounds = existsSync(roundsPath) ? JSON.parse(readFileSync(roundsPath, 'utf8')) as Round[] : [];
  const choices = JSON.parse(readFileSync(`${root}experiment/${file}`, 'utf8')) as Choice[];
  const pairs = new Map<string, { wins: Record<string, number>; none: number; total: number }>();
  for (const k of key) {
    const c = choices.find((x) => x.roundId === k.id);
    if (!c) continue;
    const id = [k.left, k.right].sort().join('|');
    const t = pairs.get(id) ?? { wins: {}, none: 0, total: 0 };
    t.total++;
    if (c.pick === 'none') t.none++; else { const w = c.pick === 'left' ? k.left : k.right; t.wins[w] = (t.wins[w] ?? 0) + 1; }
    pairs.set(id, t);
  }
  return { key, rounds, choices, pairs, answered: choices.filter((c) => key.some((k) => k.id === c.roundId)).length };
}
