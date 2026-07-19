// Theme Generation Prompt — instructs AI to fill each named slot with a personalised theme.
// AI outputs structured JSON with display info + TMDB-executable retrieval metadata.
// Backend does all ID mapping; AI works only with genre names and descriptive signals.

import type { ActionContext, SlotDefinition } from "../../types.ts";
import { GENRE_NAMES } from "../constants.ts";

const VALID_GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Fantasy", "History", "Horror", "Mystery", "Romance",
  "Science Fiction", "Thriller", "War", "Western",
];

const VALID_TV_GENRES = ["Action & Adventure", "Kids", "Sci-Fi & Fantasy"];

const ALL_VALID_GENRES = [...VALID_GENRES, ...VALID_TV_GENRES].join(", ");

// ─── Taste DNA formatter ──────────────────────────────────────────────────────

function formatTasteContext(ctx: ActionContext): string {
  const dna = ctx.tasteDNA;
  if (!dna) return "New user — no taste profile yet.";

  const lines: string[] = [];

  if (dna.tasteProfile) lines.push(`Taste summary: ${dna.tasteProfile}`);

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
    const dark = p.darknessScore ?? 0.5;
    lines.push(`Tone preference: ${dark > 0.7 ? "strongly prefers dark, morally complex narratives" : dark > 0.5 ? "leans toward complex/dramatic" : dark < 0.3 ? "prefers lighter, accessible content" : "balanced — comfortable with both dark and light"}`);

    const prestige = p.prestigeScore ?? 0.5;
    lines.push(`Quality bar: ${prestige > 0.75 ? "strongly prefers acclaimed, awards-recognised cinema — rarely watches mainstream blockbusters" : prestige > 0.5 ? "prefers well-regarded films over pure entertainment" : "open to mainstream entertainment alongside quality content"}`);

    const pacing = p.pacingPreference ?? "medium";
    lines.push(`Pacing: ${pacing === "slow" ? "favours slow-burn storytelling — rewards patience" : pacing === "fast" ? "prefers faster-paced, energetic content" : "comfortable with varied pacing"}`);

    const novelty = p.noveltyTolerance ?? 0.4;
    lines.push(`Discovery appetite: ${novelty > 0.65 ? "actively seeks out overlooked and under-discussed titles" : novelty < 0.25 ? "prefers well-known, recognisable titles" : "moderate — open to both familiar and new"}`);

    const indie = p.indieAffinity ?? 0.5;
    if (indie > 0.6) lines.push("Indie affinity: strongly drawn to independent and arthouse cinema");
    if (indie < 0.3) lines.push("Indie affinity: prefers studio productions over arthouse");

    if (p.emotionalProfile?.length) {
      lines.push(`Emotional register: ${p.emotionalProfile.join(", ")}`);
    }

    // Infer avoidances from very low genre shares
    const avoidGenres = Object.entries(genreAffinity)
      .filter(([, w]) => (w as number) / total < 0.02)
      .map(([id]) => GENRE_NAMES[Number(id)])
      .filter(Boolean)
      .slice(0, 3);
    if (avoidGenres.length > 0) {
      lines.push(`Rarely watches: ${avoidGenres.join(", ")}`);
    }
  }

  if (dna.thematicInterests?.length) {
    lines.push(`Thematic interests: ${dna.thematicInterests.join(", ")}`);
  }
  if (dna.recentShift) {
    lines.push(`Recent shift in taste: ${dna.recentShift}`);
  }

  return lines.join("\n");
}

function formatRecentWatches(ctx: ActionContext): string {
  const movies = ctx.watchedMovies.slice(0, 12).map((m) => `${m.movie.title} (${m.movie.year})`);
  const shows = ctx.watchedShows.slice(0, 8).map((s) => `${s.show.title} (${s.show.year})`);
  return [...movies, ...shows].join(", ") || "nothing yet";
}

// ─── Slot definitions formatter ───────────────────────────────────────────────

function formatSlotDefs(slotDefs: SlotDefinition[]): string {
  return slotDefs.map((slot, i) =>
    `SLOT ${i} [${slot.slotType}] — ${slot.label}\n` +
    `Media hint: ${slot.mediaTypeHint}\n` +
    `Instruction: ${slot.instruction}`
  ).join("\n\n");
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildThemeGenPrompt(
  slotDefs: SlotDefinition[],
  ctx: ActionContext,
): { system: string; user: string } {
  const system = `/no_think
You generate personalised homepage themes for a film and TV app. Each theme is one editorial row. The retrieval fields you output are executed directly as TMDB database queries — they must precisely describe the KIND of content the theme heading promises.

You will receive SLOT DEFINITIONS and the viewer's TASTE PROFILE. Pick a specific, editorially strong theme per slot, then choose retrieval parameters that will surface the right content.

─── RETRIEVAL FIELDS ────────────────────────────────────────────────────────

primaryGenres / secondaryGenres — MUST only use names from: ${ALL_VALID_GENRES}

era:
  "recent"       — last 2 years
  "contemporary" — 2000 to present
  "nineties"     — 1990–1999
  "classic"      — pre-1990
  "any"          — no date filter

sortStrategy:
  "popular"   — popularity.desc — mainstream quality content (default)
  "acclaimed" — vote_average.desc with high credibility floor — critical darlings
  "hidden"    — quality sort with strict popularity cap ≤30 — genuinely overlooked titles
               (automatically excludes mainstream names regardless of vote count)
  "recent"    — date-descending — newest releases

minRating: 6.5–8.5 — set higher for prestige/acclaimed rows

maxPopularity — leave unset for most rows; "hidden" sortStrategy sets this automatically.
  Set explicitly (e.g. 20) for extra-strict under-the-radar filtering.

originalLanguage: ISO 639-1 — ONLY for explicitly international themes
  "ko" Korean, "fr" French, "ja" Japanese, "it" Italian, "es" Spanish

─── EXAMPLES ────────────────────────────────────────────────────────────────

"Modern Festival Discoveries" (arthouse from Cannes/Sundance circuit, last 2 years):
  → era:"recent", sortStrategy:"acclaimed", minRating:7.5, primaryGenres:["Drama"]

"Hidden TV Gems" (quality shows nobody's talking about):
  → mediaType:"tv", sortStrategy:"hidden", minRating:7.5, primaryGenres:["Drama","Thriller"]

"Prestige Cinema" (acclaimed films with broad credibility):
  → sortStrategy:"acclaimed", minRating:7.8, discovery:false

"New Season Drama" (recent TV):
  → mediaType:"tv", era:"recent", sortStrategy:"recent", minRating:7.0

"Korean Noir" (specific international genre):
  → originalLanguage:"ko", primaryGenres:["Crime","Thriller"], sortStrategy:"acclaimed"

─── RULES ───────────────────────────────────────────────────────────────────
- Fill every slot (one theme per slot, id: "t0", "t1", etc.)
- Themes must differ in genre, tone, mood, AND sortStrategy — real editorial variety
- heading: 3-6 words, punchy (shown to viewer)
- subheading: ≤12 words, editorial tone

OUTPUT: raw JSON only.

SCHEMA:
{"themes":[{"id":"t0","slotType":"primary","display":{"heading":"<3-6 words>","subheading":"<≤12 words>"},"retrieval":{"mediaType":"movie|tv","primaryGenres":["Drama"],"secondaryGenres":["Thriller"],"era":"contemporary","minRating":7.5,"discovery":false,"sortStrategy":"popular","maxPopularity":null,"originalLanguage":null}},...]}`

  const user = `SLOT DEFINITIONS:
${formatSlotDefs(slotDefs)}

VIEWER TASTE PROFILE:
${formatTasteContext(ctx)}

RECENTLY WATCHED:
${formatRecentWatches(ctx)}

Generate one theme per slot.`;

  return { system, user };
}
