// Slot Engine — defines the structural skeleton of the homepage before the AI touches anything.
// Six named slots each have a distinct editorial purpose. The AI fills each slot with a
// specific theme; the slot definitions guarantee compositional variety regardless of taste DNA.

import type { ActionContext, SlotDefinition, SlotType, ThemeSpec, ThemeRetrieval } from "../../types.ts";
import { GENRE_NAMES, GENRE_IDS } from "../constants.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function dominantMediaType(ctx: ActionContext): "movie" | "tv" {
  const movies = ctx.watchedMovies.length;
  const shows = ctx.watchedShows.length;
  return shows > movies * 1.5 ? "tv" : "movie";
}

export function topGenreIds(ctx: ActionContext, n: number): number[] {
  return Object.entries(ctx.tasteDNA?.genreAffinity ?? {})
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, n)
    .map(([id]) => Number(id));
}

export function topGenreNames(ctx: ActionContext, n: number): string[] {
  return topGenreIds(ctx, n)
    .map((id) => GENRE_NAMES[id])
    .filter((n): n is string => !!n);
}

export function resolveGenreIds(names: string[]): number[] {
  return names
    .map((name) => GENRE_IDS[name] ?? GENRE_IDS[name.trim()] ?? null)
    .filter((id): id is number => id !== null);
}

// ─── Slot definitions ─────────────────────────────────────────────────────────

export function buildSlotDefinitions(ctx: ActionContext): SlotDefinition[] {
  const dominant = dominantMediaType(ctx);
  const opposite: "movie" | "tv" = dominant === "movie" ? "tv" : "movie";
  const topIds = topGenreIds(ctx, 2);

  return [
    {
      slotType: "primary" as SlotType,
      mediaTypeHint: dominant,
      excludeTopGenreIds: [],
      label: "Primary taste",
      instruction:
        "The viewer's deepest comfort zone. Match their dominant genre, tone, and quality level exactly. This is the row they should feel was made specifically for them.",
    },
    {
      slotType: "secondary" as SlotType,
      mediaTypeHint: "either",
      excludeTopGenreIds: [],
      label: "Secondary interest",
      instruction:
        "Their second-strongest interest, or a different emotional mode of their primary taste (e.g. if primary is dark crime drama, secondary could be tense thriller or cerebral mystery). Must not be a genre repeat of slot 1.",
    },
    {
      slotType: "discovery" as SlotType,
      mediaTypeHint: dominant,
      excludeTopGenreIds: [],
      label: "Hidden gems",
      instruction:
        "Acclaimed but under-discussed titles within their aesthetic comfort zone. Set discovery=true. Think: what would a knowledgeable friend with identical taste recommend that this viewer hasn't found yet?",
    },
    {
      slotType: "prestige" as SlotType,
      mediaTypeHint: "either",
      excludeTopGenreIds: [],
      label: "Prestige pick",
      instruction:
        "Critically acclaimed titles anchored to awards recognition and quality, not just genre. Set minRating to at least 7.8. The media type and genre can vary — the signal here is intellectual and emotional quality.",
    },
    {
      slotType: "format_switch" as SlotType,
      mediaTypeHint: opposite,
      excludeTopGenreIds: [],
      label: `Format switch (${opposite})`,
      instruction:
        `Must use mediaType="${opposite}". If the viewer mostly watches ${dominant}, this row introduces them to quality ${opposite} that delivers their same taste values — prestige, tone, pacing. Frame it as worth the commitment.`,
    },
    {
      slotType: "stretch" as SlotType,
      mediaTypeHint: "either",
      excludeTopGenreIds: topIds,
      label: "Stretch / adjacent discovery",
      instruction:
        "One deliberate step outside their comfort zone. Identify what they VALUE most (pacing, moral complexity, wit, tension, intelligence) and find a genre they rarely watch that delivers those same values in a different package. This must use genres different from their top genres. High confidence picks only — feels like a trusted friend's recommendation, not a random experiment. Set discovery=false; quality should be evident.",
    },
  ];
}

// ─── Era → TMDB date params ───────────────────────────────────────────────────

export function eraToDateParams(
  era: ThemeRetrieval["era"],
  mediaType: "movie" | "tv",
): Record<string, string> {
  const isMovie = mediaType === "movie";
  const gteKey = isMovie ? "primary_release_date.gte" : "first_air_date.gte";
  const lteKey = isMovie ? "primary_release_date.lte" : "first_air_date.lte";

  switch (era) {
    case "classic":
      return { [lteKey]: "1989-12-31" };
    case "nineties":
      return { [gteKey]: "1990-01-01", [lteKey]: "1999-12-31" };
    case "contemporary":
      return { [gteKey]: "2000-01-01" };
    case "recent": {
      // Last 2 years — computed dynamically so it stays current
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2);
      return { [gteKey]: cutoff.toISOString().split("T")[0] };
    }
    default:
      return {};
  }
}

// ─── Diversity validation ─────────────────────────────────────────────────────
// If two themes share the same primary genre, swap one to its secondary genre.
// Fast in-memory — no AI re-call.

export function validateAndFixDiversity(themes: ThemeSpec[]): ThemeSpec[] {
  const usedPrimary = new Set<string>();
  return themes.map((theme) => {
    const primary = theme.retrieval.primaryGenres[0];
    if (!primary || !usedPrimary.has(primary)) {
      if (primary) usedPrimary.add(primary);
      return theme;
    }
    // Primary already used — try to promote secondary
    const secondary = theme.retrieval.secondaryGenres[0];
    if (secondary && !usedPrimary.has(secondary)) {
      usedPrimary.add(secondary);
      return {
        ...theme,
        retrieval: {
          ...theme.retrieval,
          primaryGenres: [secondary, ...theme.retrieval.primaryGenres.slice(1)],
          secondaryGenres: [primary, ...theme.retrieval.secondaryGenres.slice(1)],
        },
      };
    }
    // Can't fix — leave as-is, curation will differentiate
    return theme;
  });
}

// ─── Fallback themes (used when AI theme generation fails) ────────────────────

export function buildFallbackThemes(ctx: ActionContext, slotDefs: SlotDefinition[]): ThemeSpec[] {
  const topNames = topGenreNames(ctx, 4);
  const dominant = dominantMediaType(ctx);
  const opposite: "movie" | "tv" = dominant === "movie" ? "tv" : "movie";

  const genreFor = (i: number) => topNames[i] ?? "Drama";

  return slotDefs.map((slot, i): ThemeSpec => {
    const isStretch = slot.slotType === "stretch";
    const isFormatSwitch = slot.slotType === "format_switch";
    const mt: "movie" | "tv" =
      slot.mediaTypeHint === "either" ? dominant :
      isFormatSwitch ? opposite : slot.mediaTypeHint;

    return {
      id: `t${i}`,
      slotType: slot.slotType,
      display: {
        heading: isStretch ? "Beyond Your Usual Picks" : `${genreFor(i)} Picks`,
        subheading: isStretch ? "Something different but right up your street" : "Curated for your taste",
      },
      retrieval: {
        mediaType: mt,
        primaryGenres: isStretch
          ? [genreFor(3) ?? "Comedy"]
          : [genreFor(i < 2 ? i : 0)],
        secondaryGenres: isStretch
          ? [genreFor(2)]
          : [genreFor(i < 2 ? i + 1 : 1)],
        era: "contemporary",
        minRating: slot.slotType === "prestige" ? 7.8 : 7.0,
        discovery: slot.slotType === "discovery",
        sortStrategy: slot.slotType === "prestige" ? "acclaimed"
          : slot.slotType === "discovery" ? "hidden"
          : "popular",
        maxVoteCount: slot.slotType === "discovery" ? 150_000 : undefined,
      },
    };
  });
}
