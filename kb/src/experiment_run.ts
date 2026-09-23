import { writeFileSync } from 'node:fs';
import { getFramework, LATEST_FRAMEWORK } from './framework.ts';
import { db, must } from './db.ts';
import { loadMembers } from './trakt_export.ts';
import {
  loadCatalogue, buildFolds, rankKB, rankPopular, rankKBPlusAI, rankDirectAI, rankDirectQwen, rankShortlistQwen, metrics, label,
  type SystemResult, type CatTitle,
} from './experiment.ts';

const QWEN_IN = 0.12 / 1e6, QWEN_OUT = 0.24 / 1e6;   // OpenRouter qwen/qwen3-14b, 2026-09-23

// Systems: A_kb, B_kb_ai, C_direct_ai (control), D_popular, E_direct_qwen, E2_shortlist_qwen.
export const ALL_SYSTEMS = ['A_kb', 'B_kb_ai', 'C_direct_ai', 'D_popular', 'E_direct_qwen', 'E2_shortlist_qwen'];

export async function runExperiment(root: string, membersPath: string, nFolds: number, rounds: number, log: (m: string) => void, systems = ALL_SYSTEMS, outName = 'results.json') {
  const runStart = new Date().toISOString();
  const fw = getFramework(LATEST_FRAMEWORK);
  const fwId = must(await db().from('kb_frameworks').select('id').eq('version', fw.version).single(), 'fw').id as number;
  const catalogue = await loadCatalogue(fw, fwId);
  log(`Catalogue: ${catalogue.size} titles, ${[...catalogue.values()].filter((c) => c.vec).length} with Jev ${fw.version} profiles`);
  const members = loadMembers(`${root}${membersPath}`);
  const all: unknown[] = [];

  for (const m of members) {
    const folds = buildFolds(m, catalogue, nFolds, 20);
    const watchlist = new Set(m.watchlist.map((w) => w.key));
    log(`${m.name}: ${folds.length} folds of ${folds[0]?.heldOut.length ?? 0} held-out titles`);
    for (const fold of folds) {
      log(`  fold ${fold.index}: cut-off ${fold.cutoff.slice(0, 10)}, ${fold.visible.size} visible titles, held out: ${fold.heldOut.map((h) => h.title).slice(0, 6).join(', ')}…`);
      const toResult = (system: string, ranked: string[], extra: Partial<SystemResult> = {}): SystemResult => ({
        system, top: ranked.slice(0, 20), labels: ranked.slice(0, 20).map((k) => label(catalogue.get(k), k)),
        fullRanks: new Map(ranked.map((k, i) => [k, i + 1])), costUsd: 0, tokens: 0, ...extra,
      });

      const want = (x: string) => systems.includes(x);
      const results: SystemResult[] = [];
      if (want('D_popular')) results.push(toResult('D_popular', rankPopular(fold.visible, catalogue)));
      if (want('A_kb') || want('B_kb_ai')) {
        const a = rankKB(fold.visible, catalogue, fold.cutoff, m.bulkKeys);
        if (want('A_kb')) results.push(toResult('A_kb', a.ranked));
        if (want('B_kb_ai')) {
          const b = await rankKBPlusAI(fold.visible, a.ranked, catalogue);
          results.push(toResult('B_kb_ai', b.ranked, { costUsd: b.costUsd, tokens: b.tokens }));
        }
      }
      if (want('E_direct_qwen')) {
        // Seed per member+fold: reproducible shuffle, independent of other systems.
        const e = await rankDirectQwen(fold.visible, catalogue, fold.index * 7919 + m.name.length);
        results.push(toResult('E_direct_qwen', e.ranked, { costUsd: e.costUsd, tokens: e.tokens }));
        log(`    E: ${e.ranked.length} picks from a pool of ${e.poolSize} (${e.tokens} tokens)`);
      }
      if (want('E2_shortlist_qwen')) {
        const e2 = await rankShortlistQwen(fold.visible, catalogue);
        results.push(toResult('E2_shortlist_qwen', e2.ranked, { costUsd: e2.costUsd, tokens: e2.tokens }));
        log(`    E2: ${e2.ranked.slice(0, 20).length} picks from a TMDB-related shortlist of ${e2.shortlist}`);
      }
      if (want('C_direct_ai')) {
        const t0 = Date.now();
        const c = await rankDirectAI(fold.visible, rounds, log);
        results.push({
          system: 'C_direct_ai', top: c.picks.map((p) => p.key), labels: c.picks.map((p) => `${p.title} (${p.year ?? '?'})${p.isTv ? ' [TV]' : ''}${p.key ? '' : ' ✗unresolved'}`),
          costUsd: 0, tokens: 0,
        });
        log(`    C: ${c.picks.length} titles from ${c.calls} calls in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }

      for (const r of results) {
        const mm = metrics(r, fold, catalogue, watchlist);
        log(`    ${r.system.padEnd(12)} hits@5/10/20 ${mm.hits5}/${mm.hits10}/${mm.hits20}  relevant ${mm.relevant}  median held-out rank ${mm.medianHeldOutRank ?? '–'}`);
        all.push({
          member: m.name, fold: fold.index, cutoff: fold.cutoff, system: r.system, metrics: mm,
          top: r.labels, heldOut: fold.heldOut.map((h) => `${h.title} (${h.year})${h.isTv ? ' [TV]' : ''}`),
          hits: r.top.slice(0, 20).map((k, i) => (k && fold.heldOut.some((h) => h.key === k) ? `${i + 1}. ${r.labels[i]}` : null)).filter(Boolean),
          costUsd: r.costUsd, tokens: r.tokens,
        });
      }
    }
  }

  // Control token usage is logged server-side in ai_requests for the experiment account.
  const { data: reqs } = await db().from('ai_requests').select('prompt_tokens, completion_tokens, user_id').gte('created_at', runStart);
  const { data: userList } = await db().auth.admin.listUsers({ perPage: 1000 });
  const expUser = userList?.users.find((u) => u.email === process.env.EXPERIMENT_USER_EMAIL)?.id;
  const cReqs = (reqs ?? []).filter((r) => r.user_id === expUser);
  const cCost = cReqs.reduce((s, r) => s + (r.prompt_tokens ?? 0) * QWEN_IN + (r.completion_tokens ?? 0) * QWEN_OUT, 0);

  const out = `${root}experiment/${outName}`;
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), framework: fw.version, catalogueSize: catalogue.size, controlCalls: cReqs.length, controlCostUsd: cCost, rows: all }, null, 1));
  log(`Results → ${out} (control: ${cReqs.length} logged calls ≈ $${cCost.toFixed(4)})`);
}

export type { CatTitle };
