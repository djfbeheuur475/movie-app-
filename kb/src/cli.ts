import { hostname } from 'node:os';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { db, must, selectAll } from './db.ts';
import { getFramework, LATEST_FRAMEWORK, type CompiledFramework } from './framework.ts';
import { searchTitle, fetchTitle } from './tmdb.ts';
import { askJev, buildQuestions, questionsFor, toProfile, JevError, type JevResponse } from './jev.ts';
import { buildState, buildNameOnlyState, type StoredTitle } from './state.ts';
import { scoreFamiliarity } from './familiarity.ts';
import { optionalNumber, requireEnv } from './env.ts';
import { writeReport, writeComparison } from './report.ts';
import { loadMembers } from './trakt_export.ts';
import { buildCatalogue } from './catalogue.ts';
import { runExperiment } from './experiment_run.ts';
import { buildBlind } from './blind.ts';
import { writeExperimentReport } from './experiment_report.ts';

// ── Args ────────────────────────────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) continue;
  const next = rest[i + 1];
  if (next && !next.startsWith('--')) { flags.set(a.slice(2), next); i++; } else flags.set(a.slice(2), true);
}
const flag = (k: string) => flags.get(k);
const num = (k: string, d: number) => (typeof flag(k) === 'string' ? Number(flag(k)) : d);

const ROOT = new URL('..', import.meta.url).pathname;
mkdirSync(`${ROOT}logs`, { recursive: true });
mkdirSync(`${ROOT}output`, { recursive: true });
const LOG = `${ROOT}logs/kb-${new Date().toISOString().slice(0, 10)}.log`;
const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};

// ── Shared ──────────────────────────────────────────────────────────────────

async function frameworkId(fw: CompiledFramework): Promise<number> {
  const row = must(await db().from('kb_frameworks').select('id, definition_hash').eq('version', fw.version).maybeSingle(), 'framework lookup');
  if (!row) throw new Error(`Framework ${fw.version} not synced — run: npm run framework:sync`);
  if (row.definition_hash !== fw.hash) {
    throw new Error(`Framework ${fw.version} in the DB differs from framework file. Frozen versions must not be edited — bump the version.`);
  }
  return row.id;
}

const TITLE_COLS = 'id, tmdb_id, is_tv, title, original_title, year, runtime, seasons, overview, genre_ids, creators, cast_names, keyword_ids, lang, countries, cert, meta_version';

async function loadTitles(ids: number[]): Promise<StoredTitle[]> {
  if (!ids.length) return [];
  return must(await db().from('kb_titles').select(TITLE_COLS).in('id', ids), 'load titles') as StoredTitle[];
}

async function keywordNames(titles: StoredTitle[]): Promise<Map<number, string>> {
  const ids = [...new Set(titles.flatMap((t) => t.keyword_ids ?? []))];
  const map = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = must(await db().from('kb_keywords').select('id, name').in('id', ids.slice(i, i + 500)), 'keywords');
    for (const r of rows) map.set(r.id, r.name);
  }
  return map;
}

async function modelId(name: string): Promise<number> {
  must(await db().from('kb_models').upsert({ name }, { onConflict: 'name', ignoreDuplicates: true }), 'model upsert');
  return must(await db().from('kb_models').select('id').eq('name', name).single(), 'model id').id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spacing between request starts + retries with backoff for retryable errors. */
let lastStart = 0;
async function jevWithRetry(state: string, questions: ReturnType<typeof buildQuestions>, onRetry: () => void): Promise<JevResponse> {
  const minInterval = optionalNumber('JEV_MIN_INTERVAL_MS', 500);
  for (let attempt = 0; ; attempt++) {
    const wait = lastStart + minInterval - Date.now();
    lastStart = Math.max(Date.now(), lastStart + minInterval);
    if (wait > 0) await sleep(wait);
    try {
      return await askJev(state, questions);
    } catch (e) {
      if (!(e instanceof JevError) || !e.retryable || attempt >= 3) throw e;
      onRetry();
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
    }
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

async function frameworkSync() {
  const fw = getFramework((flag('framework') as string) ?? LATEST_FRAMEWORK);
  const existing = must(await db().from('kb_frameworks').select('id, definition_hash').eq('version', fw.version).maybeSingle(), 'lookup');
  if (existing) {
    if (existing.definition_hash !== fw.hash) throw new Error(`Framework ${fw.version} already exists with a different definition. Bump the version instead of editing.`);
    log(`Framework ${fw.version} already synced (${fw.dimensions.length} dimensions, ${fw.slotCount} slots).`);
    return;
  }
  const { id } = must(await db().from('kb_frameworks').insert({ version: fw.version, definition_hash: fw.hash, notes: fw.notes }).select('id').single(), 'insert framework');
  must(await db().from('kb_dimensions').insert(fw.dimensions.map((d) => ({
    framework_id: id, key: d.key, category: d.category, qtype: d.type, applies_to: d.appliesTo,
    ordinal: d.ordinal, slot_start: d.slotStart, slot_count: d.slotCount, instructions: d.instructions, criteria: d.criteria,
  }))), 'insert dimensions');
  log(`Synced framework ${fw.version}: ${fw.dimensions.length} dimensions, ${fw.slotCount} slots.`);
}

async function testsetLoad() {
  const file = (flag('file') as string) ?? 'testset/v1.json';
  const spec = JSON.parse(readFileSync(`${ROOT}${file}`, 'utf8')) as { name: string; titles: { t: string; y: number; type: 'movie' | 'tv'; label: string }[] };
  const resolved: { t: string; y: number; type: string; label: string; tmdb_id: number | null; matched?: string }[] = [];
  for (const s of spec.titles) {
    const isTv = s.type === 'tv';
    const tmdbId = await searchTitle(s.t, s.y, isTv);
    if (!tmdbId) { log(`UNRESOLVED ${s.type} "${s.t}" (${s.y})`); resolved.push({ ...s, tmdb_id: null }); continue; }
    const t = await fetchTitle(tmdbId, isTv);
    if (t.keywords.length) must(await db().from('kb_keywords').upsert(t.keywords, { onConflict: 'id' }), 'keywords');
    const { genre_names: _g, keywords, ...row } = t;
    const saved = must(await db().from('kb_titles').upsert({ ...row, keyword_ids: keywords.map((k) => k.id), fetched_at: new Date().toISOString().slice(0, 10) }, { onConflict: 'tmdb_id,is_tv' }).select('id').single(), 'title upsert');
    must(await db().from('kb_sets').upsert({ name: spec.name, title_id: saved.id, label: s.label }, { onConflict: 'name,title_id' }), 'set upsert');
    const matched = `${t.title} (${t.year})`;
    if (t.year !== s.y || t.title.toLowerCase() !== s.t.toLowerCase()) log(`CHECK "${s.t}" (${s.y}) → ${matched}`);
    resolved.push({ ...s, tmdb_id: tmdbId, matched });
  }
  writeFileSync(`${ROOT}${file.replace(/\.json$/, '.resolved.json')}`, JSON.stringify(resolved, null, 1) + '\n');
  log(`Test set: ${resolved.filter((r) => r.tmdb_id).length}/${spec.titles.length} resolved and stored.`);
}

/** Invented titles (negative tmdb_id) that must score LOW familiarity. */
async function syntheticLoad() {
  const spec = JSON.parse(readFileSync(`${ROOT}testset/synthetic.json`, 'utf8')) as { name: string; titles: (Record<string, unknown> & { label: string })[] };
  for (const { label, ...row } of spec.titles) {
    const saved = must(await db().from('kb_titles').upsert({ ...row, keyword_ids: [] }, { onConflict: 'tmdb_id,is_tv' }).select('id').single(), 'synthetic upsert');
    must(await db().from('kb_sets').upsert([{ name: spec.name, title_id: saved.id, label }, { name: 'synthetic', title_id: saved.id, label }], { onConflict: 'name,title_id' }), 'set upsert');
  }
  log(`Loaded ${spec.titles.length} synthetic titles into sets '${spec.name}' and 'synthetic'.`);
}

/** Measures how Jev bills: is question text charged once per request, or per question? */
async function probe() {
  requireEnv('DEFAPI_API_KEY');
  const fw = getFramework((flag('framework') as string) ?? LATEST_FRAMEWORK);
  const setRows = must(await db().from('kb_sets').select('title_id').eq('name', 'test').limit(1), 'set');
  const [title] = await loadTitles(setRows.map((r) => r.title_id));
  if (!title) throw new Error('No test titles — run npm run testset:load first');
  const state = buildState(title, await keywordNames([title]));
  const dims = questionsFor(fw, title.is_tv);
  log(`Probe on "${title.title}" — state ${state.length} chars`);
  for (const n of [1, 10, dims.length]) {
    const t0 = Date.now();
    const r = await askJev(state, buildQuestions(dims.slice(0, n)));
    const answered = Object.keys(r.answers).length;
    log(`  ${String(n).padStart(3)} questions → input_tokens=${r.usage.input_tokens} output_tokens=${r.usage.output_tokens} consumed=$${r.consumed} answered=${answered} model=${r.model} ${Date.now() - t0}ms`);
  }
  log('Per-question cost ≈ (tokens@N − tokens@1)/(N−1). If that ≈ state tokens, state is re-billed per question → prefer fewer, richer questions.');
}

async function profile() {
  const fw = getFramework((flag('framework') as string) ?? LATEST_FRAMEWORK);
  const fwId = await frameworkId(fw);
  const set = (flag('set') as string) ?? null;
  const limit = num('limit', Infinity);
  const dryRun = flag('dry-run') === true;
  const includeFailed = flag('failed') === true;
  const maxAttempts = num('max-attempts', 3);
  const concurrency = num('concurrency', optionalNumber('JEV_CONCURRENCY', 2));
  const saveRaw = flag('raw') === true || set === 'test';

  const enqueued = must(await db().rpc('kb_enqueue', { p_framework: fwId, p_set: set }), 'enqueue');
  if (enqueued) log(`Enqueued ${enqueued} new title(s) for framework ${fw.version}${set ? ` (set ${set})` : ''}.`);

  if (dryRun) return dryRunEstimate(fw, fwId, set, limit);
  requireEnv('DEFAPI_API_KEY'); // fail before claiming work, not per title

  const batch = must(await db().from('kb_batches').insert({
    framework_id: fwId, mode: includeFailed ? 'profile --failed' : 'profile', host: hostname(), requested: Number.isFinite(limit) ? limit : null,
  }).select('id').single(), 'batch').id as number;
  log(`Batch ${batch}: framework ${fw.version}, set=${set ?? 'all'}, limit=${Number.isFinite(limit) ? limit : 'none'}, concurrency=${concurrency}`);

  const totals = { ok: 0, failed: 0, retries: 0, tokens: 0, cost: 0 };
  const models = new Map<string, number>();
  const rawFile = `${ROOT}output/raw-v${fw.version}.jsonl`;
  let remaining = limit;
  const started = Date.now();

  while (remaining > 0) {
    const claim = Math.min(remaining, 20);
    const ids = must(await db().rpc('kb_claim_runs', {
      p_framework: fwId, p_limit: claim, p_include_failed: includeFailed, p_max_attempts: maxAttempts, p_batch: batch, p_set: set,
    }), 'claim') as number[];
    if (!ids.length) break;
    remaining -= ids.length;
    const titles = await loadTitles(ids);
    const kw = await keywordNames(titles);

    const queue = [...titles];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const t0 = Date.now();
        try {
          const state = buildState(t, kw);
          const r = await jevWithRetry(state, buildQuestions(questionsFor(fw, t.is_tv)), () => totals.retries++);
          const { vals, conf, missing } = toProfile(fw, r.answers, t.is_tv);
          if (missing.length) throw new Error(`missing answers: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
          if (!models.has(r.model)) models.set(r.model, await modelId(r.model));
          let cost = Number(r.consumed) || r.usage.cost || 0;
          let tokens = r.usage.input_tokens;

          // Familiarity probe: same questions subset, title/year/type only.
          let fam = {};
          let nameAnswers: unknown = null;
          if (fw.nameOnly.length) {
            const n = await jevWithRetry(buildNameOnlyState(t), buildQuestions(fw.nameOnly), () => totals.retries++);
            const probe = toProfile(fw, n.answers, t.is_tv);
            fam = scoreFamiliarity(fw.nameOnly, vals, conf, probe.vals, probe.conf);
            cost += Number(n.consumed) || n.usage.cost || 0;
            tokens += n.usage.input_tokens;
            nameAnswers = n.answers;
          }

          must(await db().from('kb_title_profiles').upsert({
            title_id: t.id, framework_id: fwId, model_id: models.get(r.model), vals, conf, ...fam,
            meta_version: t.meta_version, classified_at: new Date().toISOString(),
          }, { onConflict: 'title_id,framework_id' }), 'profile upsert');
          must(await db().from('kb_classification_runs').update({
            status: 'done', last_error: null, input_tokens: tokens, cost_usd: cost,
            duration_ms: Date.now() - t0, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('title_id', t.id).eq('framework_id', fwId), 'run done');
          if (saveRaw) appendFileSync(rawFile, JSON.stringify({ title_id: t.id, title: t.title, year: t.year, model: r.model, usage: r.usage, consumed: r.consumed, answers: r.answers, name_answers: nameAnswers }) + '\n');
          totals.ok++; totals.tokens += tokens; totals.cost += cost;
          const f = fam as { familiarity?: number };
          log(`✓ ${t.title} (${t.year}) ${tokens} tok $${cost.toFixed(6)}${f.familiarity != null ? ` fam ${f.familiarity}` : ''} ${Date.now() - t0}ms`);
        } catch (e) {
          totals.failed++;
          const msg = (e as Error).message.slice(0, 500);
          const { data: cur } = await db().from('kb_classification_runs').select('attempts').eq('title_id', t.id).eq('framework_id', fwId).single();
          await db().from('kb_classification_runs').update({
            status: 'failed', attempts: (cur?.attempts ?? 0) + 1, last_error: msg, duration_ms: Date.now() - t0, updated_at: new Date().toISOString(),
          }).eq('title_id', t.id).eq('framework_id', fwId);
          log(`✗ ${t.title} (${t.year}): ${msg}`);
          if (e instanceof JevError && (e.status === 400 || e.status === 401)) {
            log('Non-retryable API error — stopping so the whole batch isn\'t burned. Fix and run npm run profile:failed.');
            queue.length = 0; remaining = 0;
          }
        }
      }
    }));
    await db().from('kb_batches').update({
      succeeded: totals.ok, failed: totals.failed, retries: totals.retries, input_tokens: totals.tokens, cost_usd: totals.cost,
    }).eq('id', batch);
  }

  await db().from('kb_batches').update({ finished_at: new Date().toISOString() }).eq('id', batch);
  const mins = (Date.now() - started) / 60000;
  log(`Batch ${batch} done: ${totals.ok} ok, ${totals.failed} failed, ${totals.retries} retries, ${totals.tokens} input tokens, $${totals.cost.toFixed(4)} billed, ${mins.toFixed(1)} min` +
    (totals.ok ? ` — avg ${Math.round(totals.tokens / totals.ok)} tok, $${(totals.cost / totals.ok).toFixed(6)}/title` : ''));
}

async function dryRunEstimate(fw: CompiledFramework, fwId: number, set: string | null, limit: number) {
  let q = db().from('kb_classification_runs').select('title_id', { count: 'exact', head: true }).eq('framework_id', fwId).neq('status', 'done');
  if (set) {
    const members = must(await db().from('kb_sets').select('title_id').eq('name', set), 'set');
    q = q.in('title_id', members.map((m) => m.title_id));
  }
  const pending = Math.min((await q).count ?? 0, limit);

  // Observed billing beats documented pricing once real runs exist.
  const done = await selectAll<{ input_tokens: number; cost_usd: number }>((a, b) =>
    db().from('kb_classification_runs').select('input_tokens, cost_usd').eq('status', 'done').not('input_tokens', 'is', null).range(a, b), 'observed');
  const obsTokens = done.reduce((s, r) => s + r.input_tokens, 0);
  const obsCost = done.reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  const sample = await loadTitles(must(await db().from('kb_classification_runs').select('title_id').eq('framework_id', fwId).limit(20), 'sample').map((r) => r.title_id));
  const kw = await keywordNames(sample);
  const estTokens = sample.length
    ? sample.reduce((s, t) => s + (buildState(t, kw).length + JSON.stringify(buildQuestions(questionsFor(fw, t.is_tv))).length) / 4, 0) / sample.length
    : 0;
  const perToken = obsTokens ? obsCost / obsTokens : optionalNumber('JEV_INPUT_PRICE_PER_MTOK', 0.084) / 1e6;
  const perTitleTokens = done.length ? obsTokens / done.length : estTokens;

  log(`DRY RUN — framework ${fw.version}, ${pending} title(s) to process${set ? ` in set ${set}` : ''}`);
  log(`  tokens/title: ${Math.round(perTitleTokens)} (${done.length ? `observed over ${done.length} runs` : 'estimated from chars/4 — calibrate with npm run probe'})`);
  log(`  price: $${(perToken * 1e6).toFixed(4)}/1M input tokens (${obsTokens ? 'observed billed' : 'JEV_INPUT_PRICE_PER_MTOK, documented list price'})`);
  for (const n of [pending, 15_000, 50_000, 100_000, 250_000]) {
    log(`  ${String(n).padStart(7)} titles → ~${Math.round(n * perTitleTokens / 1e6 * 10) / 10}M tokens ≈ $${(n * perTitleTokens * perToken).toFixed(2)}`);
  }
}

/** Re-classify already-profiled titles without saving, to measure run-to-run consistency. */
async function retest() {
  requireEnv('DEFAPI_API_KEY');
  const fw = getFramework((flag('framework') as string) ?? LATEST_FRAMEWORK);
  const fwId = await frameworkId(fw);
  const set = (flag('set') as string) ?? 'test';
  const limit = num('limit', 20);
  const members = must(await db().from('kb_sets').select('title_id').eq('name', set), 'set').map((m) => m.title_id);
  const profiles = must(await db().from('kb_title_profiles').select('title_id, vals').eq('framework_id', fwId).in('title_id', members).limit(limit), 'profiles');
  const titles = await loadTitles(profiles.map((p) => p.title_id));
  const kw = await keywordNames(titles);
  const out = `${ROOT}output/retest-v${fw.version}.jsonl`;
  writeFileSync(out, '');
  let tokens = 0, cost = 0;
  for (const t of titles) {
    const r = await jevWithRetry(buildState(t, kw), buildQuestions(questionsFor(fw, t.is_tv)), () => {});
    const { vals } = toProfile(fw, r.answers, t.is_tv);
    appendFileSync(out, JSON.stringify({ title_id: t.id, vals }) + '\n');
    tokens += r.usage.input_tokens; cost += Number(r.consumed) || 0;
    log(`retest ✓ ${t.title}`);
  }
  log(`Retest: ${titles.length} titles, ${tokens} tokens, $${cost.toFixed(5)} → ${out} (npm run report picks it up)`);
}

async function report() {
  const fw = getFramework((flag('framework') as string) ?? LATEST_FRAMEWORK);
  const fwId = await frameworkId(fw);
  const set = (flag('set') as string) ?? 'test';
  const path = await writeReport(fw, fwId, set, ROOT);
  log(`Report written: ${path}`);
}

async function catalogueBuild() {
  const members = loadMembers(`${ROOT}${(flag('members') as string) ?? 'experiment/members.json'}`);
  await buildCatalogue(members, num('target', 2500), log);
}

async function experimentRun() {
  requireEnv('KB_LLM_TOKEN'); requireEnv('EXPERIMENT_USER_EMAIL');
  const systems = typeof flag('systems') === 'string' ? (flag('systems') as string).split(',') : undefined;
  await runExperiment(ROOT, (flag('members') as string) ?? 'experiment/members.json', num('folds', 4), num('rounds', 10), log, systems, (flag('out') as string) ?? 'results.json');
}

async function experimentBlind() {
  await buildBlind(ROOT, (flag('members') as string) ?? 'experiment/members.json', log);
}

async function experimentReport() {
  log(`Report → ${await writeExperimentReport(ROOT, (flag('results') as string) ?? 'results.json', flag('blind') as string | undefined)}`);
}

async function compare() {
  const fa = getFramework((flag('a') as string) ?? '1.0'), fb = getFramework((flag('b') as string) ?? LATEST_FRAMEWORK);
  const anchors = ['Hot Fuzz', 'Detectorists', 'Aftersun', 'Hereditary', 'Slow Horses', 'Succession', 'Paddington 2', 'Breaking Bad', 'Arrival', 'Taskmaster', 'In Bruges', 'Barbie', 'The Office', 'Fleabag', 'Seinfeld'];
  log(`Comparison written: ${await writeComparison(fa, await frameworkId(fa), fb, await frameworkId(fb), ROOT, anchors)}`);
}

const commands: Record<string, () => Promise<void>> = {
  compare,
  'catalogue:build': catalogueBuild,
  'experiment:run': experimentRun,
  'experiment:blind': experimentBlind,
  'experiment:report': experimentReport,
  'framework:sync': frameworkSync,
  'testset:load': testsetLoad,
  'testset:synthetic': syntheticLoad,
  probe,
  profile,
  retest,
  report,
};

const run = commands[command ?? ''];
if (!run) {
  console.log(`Usage: node src/cli.ts <${Object.keys(commands).join('|')}> [--framework 1.0] [--set test] [--limit N] [--dry-run] [--failed] [--concurrency N]`);
  process.exit(1);
}
run().catch((e) => { log(`ERROR ${(e as Error).message}`); process.exit(1); });
