import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { db, must } from './db.ts';

// Final experiment report → kb/experiment/report.md (gitignored: personal data).

type Row = {
  member: string; fold: number; system: string; top: string[]; heldOut: string[]; hits: string[]; costUsd: number; tokens: number;
  metrics: { hits5: number; hits10: number; hits20: number; relevant: number; n: number; genreEntropy: number; profileDiversity: number | null;
    coverage: number; medianVotes: number | null; longTailShare: number | null; bad: number; tvShare: number; medianHeldOutRank: number | null };
};
type Choice = { roundId: string; member: string; pick: 'left' | 'right' | 'none'; reason?: string };
type KeyRow = { id: string; member: string; left: string; right: string; band: string };

const NAMES: Record<string, string> = {
  A_kb: 'A · KB only', B_kb_ai: 'B · KB + Qwen', C_direct_ai: 'C · Direct AI (today)', D_popular: 'D · Most popular',
  E_direct_qwen: 'E · Qwen, whole catalogue', E2_shortlist_qwen: 'E2 · Qwen, TMDB shortlist',
};
const ORDER = ['B_kb_ai', 'A_kb', 'E2_shortlist_qwen', 'E_direct_qwen', 'C_direct_ai', 'D_popular'];
const yearOf = (label: string) => Number(label.match(/\((\d{4})\)/)?.[1]) || null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');

export async function writeExperimentReport(root: string, resultsFile: string, blindChoicesFile?: string): Promise<string> {
  const res = JSON.parse(readFileSync(`${root}experiment/${resultsFile}`, 'utf8')) as { generatedAt: string; framework: string; catalogueSize: number; controlCalls: number; controlCostUsd: number; rows: Row[] };
  const rows = res.rows;
  const systems = ORDER.filter((s) => rows.some((r) => r.system === s));
  const folds = [...new Set(rows.map((r) => `${r.member}#${r.fold}`))];
  const heldTotal = folds.length * 20;
  const L: string[] = [];

  L.push('# NextUp recommendation experiment — results', '',
    `Generated ${new Date().toISOString().slice(0, 16)}Z · framework ${res.framework} · catalogue ${res.catalogueSize} titles · ${folds.length} folds × 20 held-out titles (${heldTotal} total).`, '',
    'Chance baseline: a random 20-title list from ~1,550 unwatched candidates finds ≈0.26 held-out titles per fold (≈1 across 4 folds).', '');

  // Held-out composition
  const held = rows.filter((r) => r.system === systems[0]).flatMap((r) => r.heldOut);
  const recentHeld = held.filter((h) => (yearOf(h) ?? 0) >= 2025).length;
  L.push(`Held-out composition: ${held.filter((h) => h.includes('[TV]')).length} TV, ${recentHeld} released 2025 or later (after the models' knowledge), ${held.filter((h) => (yearOf(h) ?? 9999) < 2000).length} pre-2000.`, '');

  // 1. Metrics table
  L.push('## 1. Held-out rediscovery', '', '| system | hits@5 | hits@10 | hits@20 | folds with a hit | hits on pre-2025 titles | hits on 2025+ titles | median rank of held-out | relevant recs* | titles per fold |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const s of systems) {
    const rs = rows.filter((r) => r.system === s);
    const hitLabels = rs.flatMap((r) => r.hits.map((h) => h.replace(/^\d+\.\s*/, '')));
    const ranks = rs.map((r) => r.metrics.medianHeldOutRank).filter((x): x is number => x != null);
    L.push(`| ${NAMES[s]} | ${sum(rs.map((r) => r.metrics.hits5))} | ${sum(rs.map((r) => r.metrics.hits10))} | **${sum(rs.map((r) => r.metrics.hits20))}** | ${rs.filter((r) => r.metrics.hits20 > 0).length}/${rs.length} | ${hitLabels.filter((h) => (yearOf(h) ?? 0) < 2025).length} | ${hitLabels.filter((h) => (yearOf(h) ?? 0) >= 2025).length} | ${ranks.length ? med(ranks) : '–'} | ${sum(rs.map((r) => r.metrics.relevant))} | ${f1(avg(rs.map((r) => r.metrics.n)))} |`);
  }
  L.push('', '*Relevant = held-out, or watched later than the cut-off, or on the watchlist. Median rank is over the full ranked catalogue (A/B/D) or the system\'s own candidate list (E2); C and E only output a top list.', '');

  // 2. Quality / diversity / novelty / cost
  L.push('## 2. What the lists look like', '', '| system | genre variety (entropy) | attribute diversity | median TMDB votes | long-tail share | low-quality / unresolved | TV share | LLM cost (all folds) |', '|---|---|---|---|---|---|---|---|');
  for (const s of systems) {
    const rs = rows.filter((r) => r.system === s);
    const cost = s === 'C_direct_ai' ? res.controlCostUsd : sum(rs.map((r) => r.costUsd));
    L.push(`| ${NAMES[s]} | ${f1(avg(rs.map((r) => r.metrics.genreEntropy)))} | ${f1(avg(rs.map((r) => r.metrics.profileDiversity ?? NaN)))} | ${Math.round(avg(rs.map((r) => r.metrics.medianVotes ?? NaN)))} | ${Math.round(100 * avg(rs.map((r) => r.metrics.longTailShare ?? NaN)))}% | ${sum(rs.map((r) => r.metrics.bad))} | ${Math.round(100 * avg(rs.map((r) => r.metrics.tvShare)))}% | $${cost.toFixed(4)} |`);
  }
  L.push('');

  // 3. Head-to-head on held-out hits
  const hits = (s: string) => sum(rows.filter((r) => r.system === s).map((r) => r.metrics.hits20));
  const pairs: [string, string, string][] = [
    ['B_kb_ai', 'C_direct_ai', 'Does the new architecture beat today\'s NextUp AI?'],
    ['B_kb_ai', 'E_direct_qwen', 'Does Jev add value to Qwen (vs Qwen over the whole catalogue)?'],
    ['B_kb_ai', 'E2_shortlist_qwen', 'Does Jev beat a generic (TMDB) shortlist for Qwen?'],
    ['E2_shortlist_qwen', 'E_direct_qwen', 'Does any shortlist help a small model?'],
    ['E_direct_qwen', 'C_direct_ai', 'Catalogue-bound Qwen vs today\'s free-pick AI'],
    ['A_kb', 'E_direct_qwen', 'Structured Jev ranking vs generative Qwen ranking'],
    ['B_kb_ai', 'D_popular', 'KB + Qwen vs just recommending popular titles'],
  ];
  L.push('## 3. Key comparisons (held-out hits@20)', '');
  for (const [a, b, q] of pairs) if (systems.includes(a) && systems.includes(b)) L.push(`- **${q}** ${NAMES[a]}: ${hits(a)} vs ${NAMES[b]}: ${hits(b)}`);
  L.push('');

  // 4. Blind preference
  L.push('## 4. Blind preference test', '');
  const keyPath = `${root}experiment/blind-key.json`;
  if (blindChoicesFile && existsSync(`${root}experiment/${blindChoicesFile}`) && existsSync(keyPath)) {
    const key = JSON.parse(readFileSync(keyPath, 'utf8')) as KeyRow[];
    const choices = JSON.parse(readFileSync(`${root}experiment/${blindChoicesFile}`, 'utf8')) as Choice[];
    const tally = new Map<string, { a: string; b: string; wa: number; wb: number; none: number; reasons: string[] }>();
    for (const c of choices) {
      const k = key.find((x) => x.id === c.roundId);
      if (!k) continue;
      const [a, b] = [k.left, k.right].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
      const t = tally.get(`${a}|${b}`) ?? { a, b, wa: 0, wb: 0, none: 0, reasons: [] };
      const winner = c.pick === 'none' ? null : c.pick === 'left' ? k.left : k.right;
      if (!winner) t.none++; else if (winner === a) t.wa++; else t.wb++;
      if (c.reason) t.reasons.push(`${winner ? `chose ${NAMES[winner]}` : 'no preference'} (${k.band}): “${c.reason}”`);
      tally.set(`${a}|${b}`, t);
    }
    L.push(`${choices.length} rounds answered.`, '', '| comparison | wins | wins | no preference |', '|---|---|---|---|');
    for (const t of tally.values()) L.push(`| ${NAMES[t.a]} vs ${NAMES[t.b]} | ${NAMES[t.a]}: **${t.wa}** | ${NAMES[t.b]}: **${t.wb}** | ${t.none} |`);
    const reasons = [...tally.values()].flatMap((t) => t.reasons);
    if (reasons.length) L.push('', 'Reasons given:', '', ...reasons.map((r) => `- ${r}`));
  } else {
    L.push('_Not yet answered._');
  }
  L.push('');

  // 5. Examples
  L.push('## 5. Examples', '');
  for (const s of systems) {
    const rs = rows.filter((r) => r.system === s);
    const hitList = rs.flatMap((r) => r.hits.map((h) => `fold ${r.fold}: ${h}`));
    L.push(`**${NAMES[s]}** — hits: ${hitList.length ? hitList.join('; ') : 'none'}`, `- fold 1 top 10: ${rs[0]?.top.slice(0, 10).join(' · ') ?? '–'}`, '');
  }

  // 6. Familiarity + Jev cost
  const fw = must(await db().from('kb_frameworks').select('id').eq('version', res.framework).single(), 'fw').id;
  const fam: number[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db().from('kb_title_profiles').select('familiarity').eq('framework_id', fw).not('familiarity', 'is', null).range(from, from + 999), 'fam');
    fam.push(...page.map((p) => p.familiarity as number));
    if (page.length < 1000) break;
  }
  const bucket = (lo: number, hi: number) => fam.filter((f) => f >= lo && f < hi).length;
  const runs: { cost_usd: number | null; input_tokens: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db().from('kb_classification_runs').select('cost_usd, input_tokens').eq('status', 'done').range(from, from + 999), 'runs');
    runs.push(...page);
    if (page.length < 1000) break;
  }
  L.push('## 6. Familiarity distribution (catalogue + validation set)', '',
    `${fam.length} profiles: 0–19: ${bucket(0, 20)} · 20–39: ${bucket(20, 40)} · 40–59: ${bucket(40, 60)} · 60–79: ${bucket(60, 80)} · 80–100: ${bucket(80, 101)} · median ${med(fam)}`, '');
  L.push('## 7. Cost', '', `- Jev (all profiling to date, every framework version): ${runs.length} profiles, ${(sum(runs.map((r) => r.input_tokens ?? 0)) / 1e6).toFixed(2)}M input tokens, **$${sum(runs.map((r) => r.cost_usd ?? 0)).toFixed(2)}**`,
    `- Experiment LLM calls: see table 2 (Qwen3-14B via OpenRouter). Control: ${res.controlCalls} calls.`, '');

  const out = `${root}experiment/report.md`;
  writeFileSync(out, L.join('\n'));
  return out;
}
