import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { getFramework, LATEST_FRAMEWORK } from './framework.ts';
import { db, must } from './db.ts';
import { fetchTitle } from './tmdb.ts';
import { loadMembers } from './trakt_export.ts';
import { loadCatalogue, statsBefore, rankKB, rankKBPlusAI, rankDirectAI, rankDirectQwen, type CatTitle } from './experiment.ts';

// Blind human test: recommendations from each system using the member's FULL
// current history, cut into 5-title rows and paired anonymously. The page only
// ever sees the rows; which system made which row stays in blind-key.json here.

type Item = { key: string; title: string; year: number | null; tv: boolean; poster: string | null };

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export async function buildBlind(root: string, membersPath: string, log: (m: string) => void) {
  const fw = getFramework(LATEST_FRAMEWORK);
  const fwId = must(await db().from('kb_frameworks').select('id').eq('version', fw.version).single(), 'fw').id as number;
  const catalogue = await loadCatalogue(fw, fwId);
  const outDir = `${root}experiment/blind`;
  mkdirSync(`${outDir}/posters`, { recursive: true });
  const rounds: unknown[] = [], key: unknown[] = [];

  for (const m of loadMembers(`${root}${membersPath}`)) {
    const visible = statsBefore(m.events, '9999');
    const a = rankKB(visible, catalogue, new Date().toISOString(), m.bulkKeys);
    const b = await rankKBPlusAI(visible, a.ranked, catalogue);
    const c = await rankDirectAI(visible, 4, log);
    const e = await rankDirectQwen(visible, catalogue, 424242);

    const toItem = async (k: string | null, fallback: { title: string; year: number | null; isTv: boolean }): Promise<Item> => {
      const cat = k ? catalogue.get(k) : undefined;
      let poster = cat?.poster ?? null;
      if (!cat && k) poster = (await fetchTitle(Number(k.slice(1)), k.startsWith('t')).catch(() => null))?.poster_path ?? null;
      const file = k && poster ? `posters/${k}.jpg` : null;
      if (file && !existsSync(`${outDir}/${file}`)) {
        const res = await fetch(`https://image.tmdb.org/t/p/w185${poster}`);
        if (res.ok) writeFileSync(`${outDir}/${file}`, Buffer.from(await res.arrayBuffer()));
      }
      return { key: k ?? `x:${fallback.title}`, title: cat?.title ?? fallback.title, year: cat?.year ?? fallback.year, tv: cat?.isTv ?? fallback.isTv, poster: file };
    };
    const fromCat = (keys: string[]) => Promise.all(keys.filter((k) => !visible.has(k)).slice(0, 15).map((k) => toItem(k, { title: k, year: null, isTv: k.startsWith('t') })));
    const lists: Record<string, Item[]> = {
      A_kb: await fromCat(a.ranked),
      B_kb_ai: await fromCat(b.ranked),
      E_direct_qwen: await fromCat(e.ranked),
      C_direct_ai: await Promise.all(c.picks.filter((p) => !p.key || !visible.has(p.key)).slice(0, 15).map((p) => toItem(p.key, p))),
    };
    for (const [s, l] of Object.entries(lists)) log(`  ${m.name} ${s}: ${l.map((i) => i.title).join(', ')}`);

    const rand = rng([...m.name].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0);
    // The four key comparisons: B–C (new vs today), B–E (does Jev help Qwen?),
    // E–C (catalogue-bound Qwen vs today's free-pick), A–E (structured vs generative).
    const pairs: [string, string][] = [['B_kb_ai', 'C_direct_ai'], ['B_kb_ai', 'E_direct_qwen'], ['E_direct_qwen', 'C_direct_ai'], ['A_kb', 'E_direct_qwen']];
    const mine: { id: string; left: Item[]; right: Item[]; systems: [string, string]; band: string }[] = [];
    for (const [x, y] of pairs) {
      for (const [lo, hi] of [[0, 5], [5, 10], [10, 15]]) {
        const rx = lists[x].slice(lo, hi), ry = lists[y].slice(lo, hi);
        if (rx.length < 5 || ry.length < 5) continue;
        const flip = rand() < 0.5;
        mine.push({ id: '', left: flip ? ry : rx, right: flip ? rx : ry, systems: flip ? [y, x] : [x, y], band: `${lo + 1}-${hi}` });
      }
    }
    mine.sort(() => rand() - 0.5);
    mine.forEach((r, i) => {
      r.id = `${m.name.toLowerCase()}-r${String(i + 1).padStart(2, '0')}`;
      rounds.push({ id: r.id, member: m.name, order: i + 1, left: r.left, right: r.right });
      key.push({ id: r.id, member: m.name, left: r.systems[0], right: r.systems[1], band: r.band });
    });
    log(`${m.name}: ${mine.length} blind rounds`);
  }
  writeFileSync(`${outDir}/rounds.json`, JSON.stringify(rounds, null, 1));
  writeFileSync(`${root}experiment/blind-key.json`, JSON.stringify(key, null, 1));
  log(`Blind rounds → ${outDir}/rounds.json (no system labels); key → experiment/blind-key.json`);
}
