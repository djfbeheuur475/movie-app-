import { ROW_TEMPLATES, type RowTemplate } from './rowTemplates';
import type { TasteProfile, TasteMode, GenreAffinity } from './tasteDna';
import { getTemporalContext } from './tasteDna';
import type { TemporalContext } from './tasteDna';

// ─── FNV-1a hash for deterministic seeding ────────────────────────────────────

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// ─── Temporal eligibility ─────────────────────────────────────────────────────

function isTemporallyEligible(template: RowTemplate, temporal: TemporalContext): boolean {
  const t = template.temporal;
  if (!t) return true;
  if (t.timeOfDay && !t.timeOfDay.includes(temporal.timeOfDay)) return false;
  if (t.dayType && !t.dayType.includes(temporal.dayType)) return false;
  if (t.season && !t.season.includes(temporal.season)) return false;
  if (t.specialPeriod) {
    if (!temporal.specialPeriod) return false;
    const matches = t.specialPeriod.some(p => temporal.specialPeriod!.includes(p));
    if (!matches) return false;
  }
  return true;
}

// ─── Profile hard-gate eligibility ───────────────────────────────────────────

function isProfileEligible(template: RowTemplate, profile: TasteProfile | undefined): boolean {
  if (!profile) return true; // no profile = no gates applied
  if (template.minDarkness !== undefined && profile.darknessScore < template.minDarkness) return false;
  if (template.maxDarkness !== undefined && profile.darknessScore > template.maxDarkness) return false;
  if (template.minPrestige !== undefined && profile.prestigeScore < template.minPrestige) return false;
  if (template.maxPrestige !== undefined && profile.prestigeScore > template.maxPrestige) return false;
  if (template.minNovelty !== undefined && profile.noveltyTolerance < template.minNovelty) return false;
  if (template.minIndie !== undefined && profile.indieAffinity < template.minIndie) return false;
  return true;
}

// ─── Template scoring ─────────────────────────────────────────────────────────

function scoreTemplate(
  template: RowTemplate,
  profile: TasteProfile | undefined,
  genreAffinity: GenreAffinity,
  temporal: TemporalContext,
): number {
  // 1. Genre affinity score (0–1): average affinity across the template's scored genres
  let genreScore = 0;
  if (template.scoreGenres.length > 0) {
    const sum = template.scoreGenres.reduce((acc, id) => acc + (genreAffinity[id] ?? 0), 0);
    genreScore = sum / template.scoreGenres.length;
  }

  // 2. Profile dimension score (0–1 range output)
  let dimensionScore = 0;
  if (profile) {
    dimensionScore +=
      template.scoreDarkness * profile.darknessScore +
      template.scorePrestige * profile.prestigeScore +
      template.scoreIndie * profile.indieAffinity +
      template.scoreNovelty * profile.noveltyTolerance;

    // Pacing match bonus
    if (template.pacingFit && profile.pacingPreference === template.pacingFit) {
      dimensionScore += 0.12;
    }
    // Era match bonus
    if (template.eraFit) {
      const topEra = Object.entries(profile.eraAffinity)
        .sort(([, a], [, b]) => b - a)[0][0] as 'classic' | 'nineties' | 'modern';
      if (topEra === template.eraFit) dimensionScore += 0.10;
    }
    // Clamp to [-0.5, 0.8]
    dimensionScore = Math.max(-0.5, Math.min(0.8, dimensionScore));
  }

  // 3. Temporal bonus — small boost for contextually matched templates
  const temporalBonus = template.temporal ? 0.12 : 0;

  // Weighted combination
  // When no history: genre score = 0, dimension score = 0 → baseScore drives selection
  const hasHistory = Object.keys(genreAffinity).length > 0;
  if (hasHistory) {
    return genreScore * 0.45 + dimensionScore * 0.35 + temporalBonus * 0.12 + template.baseScore * 0.08;
  } else {
    return temporalBonus * 0.30 + template.baseScore * 0.70;
  }
}

// ─── Main selector ────────────────────────────────────────────────────────────

// Up to 0.18 bonus for templates whose scoreGenres overlap the user's recent taste shift.
// This makes rows react to what the user has been into lately, not just lifetime history.
function recentShiftBonus(template: RowTemplate, recentAffinity: GenreAffinity): number {
  if (!Object.keys(recentAffinity).length || !template.scoreGenres.length) return 0;
  const total = Object.values(recentAffinity).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const matched = template.scoreGenres.reduce((s, id) => s + (recentAffinity[id] ?? 0), 0);
  return (matched / total) * 0.18;
}

export function selectRowTemplates(
  profile: TasteProfile | undefined,
  genreAffinity: GenreAffinity,
  temporal: TemporalContext,
  recentRowTitles: string[],
  recentGenreAffinity: GenreAffinity = {},
  count = 8,
): RowTemplate[] {
  const recentSet = new Set(recentRowTitles.map(t => t.toLowerCase()));

  // Filter: temporal eligibility + profile hard gates + not recently shown
  const eligible = ROW_TEMPLATES.filter(t =>
    isTemporallyEligible(t, temporal) &&
    isProfileEligible(t, profile) &&
    !recentSet.has(t.title.toLowerCase())
  );

  // Score each template — base score + recency shift bonus
  const scored = eligible.map(t => ({
    template: t,
    score: scoreTemplate(t, profile, genreAffinity, temporal) + recentShiftBonus(t, recentGenreAffinity),
  }));

  // Deterministic tie-breaking: within the same score band, order by hash(id + dateKey)
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.001) return diff;
    return fnv1a(a.template.id + temporal.dateKey) - fnv1a(b.template.id + temporal.dateKey);
  });

  // Select top candidates ensuring media-type variety:
  // aim for at least 2 movies and at least 1 TV among the final picks
  const picked: RowTemplate[] = [];
  const moviePool = scored.filter(x => x.template.type === 'movie');
  const tvPool = scored.filter(x => x.template.type === 'tv');

  // Greedy pick: interleave from movie and TV pools to guarantee variety
  const minTV = Math.min(2, tvPool.length);
  const minMovie = Math.min(count - minTV, moviePool.length);

  // Take top movies first (most of the row budget)
  for (const { template } of moviePool.slice(0, minMovie)) {
    if (picked.length < count) picked.push(template);
  }
  // Fill TV slots
  for (const { template } of tvPool.slice(0, minTV)) {
    if (picked.length < count) picked.push(template);
  }
  // Fill any remaining slots from whatever scored highest
  for (const { template } of scored) {
    if (picked.length >= count) break;
    if (!picked.includes(template)) picked.push(template);
  }

  // Re-sort picked set by score so the best rows come first in the UI
  return picked.sort((a, b) => {
    const sa = scoreTemplate(a, profile, genreAffinity, temporal) + recentShiftBonus(a, recentGenreAffinity);
    const sb = scoreTemplate(b, profile, genreAffinity, temporal) + recentShiftBonus(b, recentGenreAffinity);
    return sb - sa;
  });
}

// ─── Deterministic taste narration ───────────────────────────────────────────
// Replaces the Gemini-generated tasteProfile string with a computed description.
// No AI call required.

const GENRE_LABELS: Record<number, string> = {
  28: 'action', 12: 'adventure', 35: 'comedy', 80: 'crime', 99: 'documentary',
  18: 'drama', 14: 'fantasy', 27: 'horror', 9648: 'mystery', 10749: 'romance',
  878: 'science fiction', 53: 'thriller', 37: 'western', 36: 'historical drama',
  16: 'animation', 10752: 'war drama', 10759: 'action & adventure', 10765: 'sci-fi & fantasy',
};

export function buildTasteNarration(
  profile: TasteProfile | undefined,
  genreAffinity: GenreAffinity,
  tasteMode: TasteMode,
): string {
  if (!profile) {
    const modeLabels: Record<TasteMode, string> = {
      comfort: 'familiar, crowd-pleasing',
      discovery: 'eclectic and exploratory',
      prestige: 'critically acclaimed',
      blockbuster: 'high-energy, crowd-pleasing',
      'late-night': 'atmospheric and after-dark',
      'emotionally-heavy': 'emotionally intense',
    };
    return `Your taste spans ${modeLabels[tasteMode] ?? 'a wide range of'} cinema and television.`;
  }

  const dominant = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([id]) => GENRE_LABELS[Number(id)])
    .filter(Boolean);

  const toneStr =
    profile.darknessScore > 0.60 ? 'dark and morally complex' :
    profile.darknessScore > 0.35 ? 'layered, occasionally intense' : 'accessible and engaging';

  const prestigeStr =
    profile.prestigeScore > 0.60 ? 'critically acclaimed' :
    profile.prestigeScore > 0.35 ? 'well-regarded' : 'broadly entertaining';

  const topEra = Object.entries(profile.eraAffinity).sort(([, a], [, b]) => b - a)[0][0];
  const eraStr =
    topEra === 'classic' ? ', with a strong pull toward classic cinema' :
    topEra === 'nineties' ? ', with a particular affinity for 90s films' : '';

  const genreStr = dominant.length >= 2
    ? `${dominant.slice(0, 2).join(' and ')}`
    : dominant[0] ?? 'drama';

  return `You gravitate toward ${toneStr}, ${prestigeStr} ${genreStr}${eraStr}.`;
}

// ─── Profile-driven parameter modulation ─────────────────────────────────────
// Takes a template's base config and adjusts retrieval params to match the user's
// specific profile dimensions. Same 70 templates; different content pools per user.

export function applyProfileToTemplate(
  template: RowTemplate,
  profile: TasteProfile | undefined,
): RowTemplate {
  if (!profile) return template;

  // Novelty tolerance drives vote count threshold.
  // High novelty → lower threshold → surface lesser-known quality content.
  // Floor of 300 prevents extreme reduction from producing garbage matches.
  const novelty = profile.noveltyTolerance;
  const voteCountGte =
    novelty > 0.60 ? Math.max(Math.min(template.voteCountGte, 300), 200) :
    novelty > 0.35 ? Math.max(Math.min(template.voteCountGte, 800), 300) :
    template.voteCountGte;

  // Prestige score drives quality floor.
  const prestige = profile.prestigeScore;
  const voteAverageGte =
    prestige > 0.65 ? Math.max(template.voteAverageGte, 7.8) :
    prestige < 0.20 ? Math.min(template.voteAverageGte, 6.8) :
    template.voteAverageGte;

  // Mainstream comfort users prefer familiarity over critical ranking.
  const sortBy =
    prestige < 0.18 && novelty < 0.25 && template.sortBy === 'vote_average.desc'
      ? 'popularity.desc'
      : template.sortBy;

  // Pacing proxy via runtime filter (movies only, and only for templates that
  // explicitly declare a pacingFit — action/adventure templates must never have
  // runtime constraints injected or the candidate pool collapses).
  let runtimeGte = template.runtimeGte;
  let runtimeLte = template.runtimeLte;
  if (template.type === 'movie' && template.pacingFit) {
    if (template.pacingFit === 'slow' && !runtimeGte) runtimeGte = 110;
  }

  return { ...template, voteCountGte, voteAverageGte, sortBy, runtimeGte, runtimeLte };
}

// ─── Profile snapshot (for AI tab cross-device context) ───────────────────────

export interface ProfileSnapshot {
  profile: TasteProfile | undefined;
  genreAffinity: GenreAffinity;
  tasteMode: TasteMode;
  tasteProfile: string;
  fingerprint: string;
  savedAt: number;
}
