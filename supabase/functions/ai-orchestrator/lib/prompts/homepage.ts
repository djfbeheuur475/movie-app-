import type { CandidatePool, TasteDNA } from "../../types.ts";
import { GENRE_NAMES } from "../constants.ts";

// ─── DNA context block ────────────────────────────────────────────────────────

function formatDNA(dna: TasteDNA | null): string {
  if (!dna) return "No taste profile yet — serve broadly appealing quality picks.";

  const lines: string[] = [];

  if (dna.tasteProfile) {
    lines.push(`Taste summary: ${dna.tasteProfile}`);
  }

  const genreAffinity = dna.genreAffinity ?? {};
  const total = Object.values(genreAffinity).reduce((s, w) => s + (w as number), 0) || 1;
  const topGenres = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 6)
    .map(([id, w]) => `${GENRE_NAMES[Number(id)] ?? `genre-${id}`} ${Math.round(((w as number) / total) * 100)}%`)
    .join(", ");
  if (topGenres) lines.push(`Genre DNA: ${topGenres}`);

  const p = dna.profile;
  if (p) {
    const darkness = p.darknessScore ?? 0.5;
    lines.push(
      `Tone: ${darkness > 0.65 ? "dark/complex" : darkness < 0.25 ? "light/accessible" : "balanced"}`,
    );
    const prestige = p.prestigeScore ?? 0.5;
    lines.push(
      `Prestige: ${prestige > 0.7 ? "very high — acclaimed titles only" : prestige > 0.4 ? "high" : "mainstream-leaning"}`,
    );
    const novelty = p.noveltyTolerance ?? 0.4;
    lines.push(
      `Discovery appetite: ${novelty > 0.6 ? "high — loves under-the-radar finds" : novelty < 0.25 ? "low — prefers recognisable titles" : "moderate"}`,
    );
    const eraEntries = Object.entries(p.eraAffinity ?? {}).sort(([, a], [, b]) => (b as number) - (a as number));
    if (eraEntries.length) {
      lines.push(
        `Era preference: ${eraEntries[0][0]} (${Math.round((eraEntries[0][1] as number) * 100)}% of history)`,
      );
    }
    if (p.emotionalProfile?.length) {
      lines.push(`Emotional register: ${p.emotionalProfile.join(", ")}`);
    }
  }

  if (dna.thematicInterests?.length) {
    lines.push(`Thematic interests: ${dna.thematicInterests.join(", ")}`);
  }
  if (dna.recentShift) {
    lines.push(`Recent shift: ${dna.recentShift}`);
  }

  return lines.join("\n");
}

// ─── Candidate serialisation ──────────────────────────────────────────────────

function formatPools(pools: CandidatePool[]): string {
  return pools
    .map((pool) => {
      const intent = pool.sectionIntent;
      const header = `[${intent.id}] type=${intent.type}`;
      const rows = pool.candidates
        .map((c) => `${c.tmdbId}|${c.mediaType}|${c.title} (${c.year})|${c.voteAverage.toFixed(1)}`)
        .join("\n");
      return `${header}\n${rows}`;
    })
    .join("\n\n");
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

export function buildHomepagePrompt(
  pools: CandidatePool[],
  tasteDNA: TasteDNA | null,
): { system: string; user: string } {
  const system = `/no_think
You are the curation engine for NextUp. Given a viewer's taste profile and candidate pools, output a minimal JSON selection.

RULES:
- Return EVERY section. Use the EXACT id from each pool header.
- Pick only tmdbIds from that section's pool. Never invent IDs.
- heading: 2–4 punchy words tailored to this viewer (not generic labels).
- reason: one short sentence (max 12 words) explaining why THIS viewer will enjoy this section — be specific to their taste, not generic.
- tmdbIds array: ordered best-first, pick up to the pool size.

OUTPUT: raw JSON only — no markdown, no prose.

SCHEMA:
{"sections":[{"id":"<exact pool id>","type":"hero"|"row"|"spotlight","heading":"<2-4 words>","reason":"<one sentence>","tmdbIds":[<numbers from pool>]}]}`;

  const user = `USER TASTE PROFILE:
${formatDNA(tasteDNA)}

CANDIDATE POOLS:
${formatPools(pools)}

Select and curate titles from the pools above. Return valid JSON only.`;

  return { system, user };
}
