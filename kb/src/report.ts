import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { db, must } from './db.ts';
import type { CompiledFramework, CompiledDimension } from './framework.ts';

// Framework QC report for a title set: what to cut, merge or reword before
// scaling. Written to kb/output/report-v<version>.md (gitignored).

interface Row { title_id: number; vals: (number | null)[]; conf: (number | null)[] }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
function pearson(a: number[], b: number[]) {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db2 = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db2 += (b[i] - mb) ** 2; }
  return da && db2 ? n / Math.sqrt(da * db2) : 0;
}

export async function writeReport(fw: CompiledFramework, fwId: number, set: string, root: string): Promise<string> {
  const members = must(await db().from('kb_sets').select('title_id, label').eq('name', set), 'set');
  const labels = new Map(members.map((m) => [m.title_id, m.label as string]));
  const rows = must(await db().from('kb_title_profiles').select('title_id, vals, conf').eq('framework_id', fwId).in('title_id', members.map((m) => m.title_id)), 'profiles') as Row[];
  const titles = new Map(must(await db().from('kb_titles').select('id, title, year, is_tv').in('id', rows.map((r) => r.title_id)), 'titles').map((t) => [t.id, t]));
  const name = (id: number) => { const t = titles.get(id); return t ? `${t.title} (${t.year})` : `#${id}`; };

  const scalars = fw.dimensions.filter((d) => d.type !== 'choice');
  const choices = fw.dimensions.filter((d) => d.type === 'choice');
  const col = (d: CompiledDimension) => rows.map((r) => r.vals[d.slotStart - 1]).filter((v): v is number => v != null);
  const confOf = (d: CompiledDimension) => rows.map((r) => r.conf[d.ordinal - 1]).filter((v): v is number => v != null);

  const L: string[] = [];
  L.push(`# Framework ${fw.version} — QC report (set: ${set})`, '', `${rows.length} profiled titles · ${fw.dimensions.length} dimensions · generated ${new Date().toISOString()}`, '');

  // 1. Per-dimension distribution
  const stats = scalars.map((d) => {
    const v = col(d), c = confOf(d);
    return { d, n: v.length, mean: mean(v), sd: sd(v), conf: c.length ? mean(c) : NaN, floor: v.filter((x) => x <= 5).length / (v.length || 1), ceil: v.filter((x) => x >= 95).length / (v.length || 1) };
  });
  L.push('## 1. Flags', '');
  const lowVar = stats.filter((s) => s.sd < 10);
  const lowConf = stats.filter((s) => s.conf < 50);
  L.push(`**Low variance (sd < 10 — barely discriminates):** ${lowVar.map((s) => `${s.d.key} (${s.sd.toFixed(1)})`).join(', ') || 'none'}`, '');
  L.push(`**Low confidence (mean < 50):** ${lowConf.map((s) => `${s.d.key} (${s.conf.toFixed(0)})`).join(', ') || 'none'}`, '');

  // 2. Redundancy
  const pairs: { a: string; b: string; r: number }[] = [];
  const cols = new Map(scalars.map((d) => [d.key, rows.map((r) => r.vals[d.slotStart - 1] ?? NaN)]));
  for (let i = 0; i < scalars.length; i++) for (let j = i + 1; j < scalars.length; j++) {
    const a = cols.get(scalars[i].key)!, b = cols.get(scalars[j].key)!;
    const idx = a.map((_, k) => k).filter((k) => !Number.isNaN(a[k]) && !Number.isNaN(b[k]));
    if (idx.length < 10) continue;
    const r = pearson(idx.map((k) => a[k]), idx.map((k) => b[k]));
    if (Math.abs(r) >= 0.75) pairs.push({ a: scalars[i].key, b: scalars[j].key, r });
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  L.push(`**Highly correlated pairs (|r| ≥ 0.75 — candidates to merge/drop):**`, '');
  L.push(...(pairs.length ? pairs.map((p) => `- ${p.a} ↔ ${p.b}: r = ${p.r.toFixed(2)}`) : ['- none']), '');

  // 3. Consistency (retest)
  const retestPath = `${root}output/retest-v${fw.version}.jsonl`;
  if (existsSync(retestPath)) {
    const retest = readFileSync(retestPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { title_id: number; vals: (number | null)[] });
    const byId = new Map(rows.map((r) => [r.title_id, r]));
    const diffs = scalars.map((d) => {
      const ds = retest.map((x) => { const a = byId.get(x.title_id)?.vals[d.slotStart - 1], b = x.vals[d.slotStart - 1]; return a != null && b != null ? Math.abs(a - b) : null; }).filter((v): v is number => v != null);
      return { key: d.key, mad: mean(ds) };
    }).sort((a, b) => b.mad - a.mad);
    L.push(`## 2. Consistency — ${retest.length} titles re-classified`, '', `Mean absolute change per dimension (0–100 scale). Overall: **${mean(diffs.map((d) => d.mad)).toFixed(1)}**.`, '');
    L.push('Least stable:', '', ...diffs.slice(0, 12).map((d) => `- ${d.key}: ${d.mad.toFixed(1)}`), '');
  } else {
    L.push('## 2. Consistency', '', '_No retest yet — run `npm run retest` then regenerate this report._', '');
  }

  // 4. Choice facets
  L.push('## 3. Choice dimensions — how often each option wins', '');
  for (const d of choices) {
    const wins = new Map<string, number>();
    const conf = confOf(d);
    for (const r of rows) {
      const probs = d.options.map((_, i) => r.vals[d.slotStart - 1 + i] ?? -1);
      if (Math.max(...probs) < 0) continue;
      const opt = d.options[probs.indexOf(Math.max(...probs))];
      wins.set(opt, (wins.get(opt) ?? 0) + 1);
    }
    L.push(`- **${d.key}** (conf ${conf.length ? mean(conf).toFixed(0) : '–'}): ${[...wins].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}`);
  }
  L.push('');

  // 5. Distribution table
  L.push('## 4. All scalar dimensions', '', '| dimension | category | n | mean | sd | conf | ≤5 | ≥95 |', '|---|---|---|---|---|---|---|---|');
  for (const s of stats) {
    L.push(`| ${s.d.key} | ${s.d.category} | ${s.n} | ${s.mean.toFixed(0)} | ${s.sd.toFixed(1)} | ${Number.isNaN(s.conf) ? '–' : s.conf.toFixed(0)} | ${(s.floor * 100).toFixed(0)}% | ${(s.ceil * 100).toFixed(0)}% |`);
  }
  L.push('');

  // 6. Title cards + nearest neighbours (cosine over z-scored scalars)
  const z = new Map(stats.map((s) => [s.d.key, s]));
  const vec = (r: Row) => scalars.map((d) => { const v = r.vals[d.slotStart - 1]; const s = z.get(d.key)!; return v == null || !s.sd ? 0 : (v - s.mean) / s.sd; });
  const vecs = new Map(rows.map((r) => [r.title_id, vec(r)]));
  const cos = (a: number[], b: number[]) => { let n = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { n += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return x && y ? n / Math.sqrt(x * y) : 0; };

  L.push('## 5. Title cards', '', '_Most distinctive traits (z-score vs this set), dominant choices, and nearest neighbours by attribute profile. Eyeball these: do they describe the title? Do the neighbours make sense?_', '');
  for (const r of rows.sort((a, b) => name(a.title_id).localeCompare(name(b.title_id)))) {
    const v = vecs.get(r.title_id)!;
    const traits = scalars.map((d, i) => ({ d, z: v[i], raw: r.vals[d.slotStart - 1] })).filter((x) => x.raw != null).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 8)
      .map((x) => `${x.z > 0 ? '▲' : '▼'}${x.d.key} ${x.raw}`);
    const facets = choices.map((d) => {
      const probs = d.options.map((_, i) => r.vals[d.slotStart - 1 + i] ?? -1);
      const m = Math.max(...probs);
      return m < 0 ? null : `${d.key}: ${d.options[probs.indexOf(m)]} ${m}%`;
    }).filter(Boolean);
    const nn = rows.filter((o) => o.title_id !== r.title_id).map((o) => ({ id: o.title_id, s: cos(v, vecs.get(o.title_id)!) })).sort((a, b) => b.s - a.s).slice(0, 3);
    L.push(`### ${name(r.title_id)} — _${labels.get(r.title_id) ?? ''}_`, `- traits: ${traits.join(' · ')}`, `- ${facets.join(' · ')}`, `- nearest: ${nn.map((n) => `${name(n.id)} (${n.s.toFixed(2)})`).join(', ')}`, '');
  }

  const path = `${root}output/report-v${fw.version}.md`;
  writeFileSync(path, L.join('\n'));
  return path;
}
