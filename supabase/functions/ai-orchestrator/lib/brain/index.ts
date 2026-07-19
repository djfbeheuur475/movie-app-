// Recommendation Brain — pure, deterministic signal-to-intent mapping.
// Input:  ActionContext (taste DNA + watch history + watchlist)
// Output: SectionIntent[] describing what the homepage should contain
// No AI, no network calls. Same inputs → same outputs (modulo random watchlist seed).

import type { ActionContext, SectionIntent, CandidateSpec } from "../../types.ts";
import { GENRE_NAMES } from "../constants.ts";

// ─── Signals ──────────────────────────────────────────────────────────────────

interface Signals {
  topGenres: Array<{ id: number; name: string; weight: number; share: number }>;
  dominantMediaType: "movie" | "tv" | "both";
  era: "classic" | "nineties" | "contemporary" | null;
  eraStrength: number;    // 0-1: how dominant the top era is
  darknessScore: number;
  prestigeScore: number;
  noveltyTolerance: number;
  minRating: number;
  isNewUser: boolean;
}

function extractSignals(ctx: ActionContext): Signals {
  const { tasteDNA, watchedMovies, watchedShows } = ctx;

  const hasHistory = watchedMovies.length > 0 || watchedShows.length > 0;
  const isNewUser = !tasteDNA || (!hasHistory && !Object.keys(tasteDNA.genreAffinity ?? {}).length);

  // Genre affinity — normalise weights to shares
  const genreAffinity = tasteDNA?.genreAffinity ?? {};
  const totalWeight = Object.values(genreAffinity).reduce((s, w) => s + (w as number), 0) || 1;
  const topGenres = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 6)
    .map(([id, w]) => ({
      id: Number(id),
      name: GENRE_NAMES[Number(id)] ?? `Genre ${id}`,
      weight: w as number,
      share: Math.round(((w as number) / totalWeight) * 100),
    }));

  // Era affinity
  const eraAffinity = tasteDNA?.profile?.eraAffinity ?? {};
  const sortedEras = Object.entries(eraAffinity).sort(([, a], [, b]) => (b as number) - (a as number));
  const topEra = sortedEras[0];
  const era = topEra ? (topEra[0] as "classic" | "nineties" | "contemporary") : null;
  const eraStrength = topEra ? (topEra[1] as number) : 0;

  const darknessScore = tasteDNA?.profile?.darknessScore ?? 0.5;
  const prestigeScore = tasteDNA?.profile?.prestigeScore ?? 0.5;
  const noveltyTolerance = tasteDNA?.profile?.noveltyTolerance ?? 0.4;

  // Prestige → minimum acceptable TMDB rating
  const minRating = prestigeScore > 0.7 ? 7.5 : prestigeScore > 0.4 ? 7.0 : 6.5;

  // Media type preference: lean toward what they watch more (2:1 = dominant)
  const movieCount = watchedMovies.length;
  const showCount = watchedShows.length;
  const dominantMediaType: "movie" | "tv" | "both" =
    movieCount > showCount * 2 ? "movie" :
    showCount > movieCount * 2 ? "tv" : "both";

  return {
    topGenres, dominantMediaType, era, eraStrength,
    darknessScore, prestigeScore, noveltyTolerance, minRating,
    isNewUser,
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

// ─── Era date ranges ──────────────────────────────────────────────────────────

function eraDateBounds(era: "classic" | "nineties" | "contemporary"): { gte?: string; lte?: string } {
  if (era === "classic") return { lte: "1989-12-31" };
  if (era === "nineties") return { gte: "1990-01-01", lte: "1999-12-31" };
  return { gte: "2000-01-01" };
}

function eraLabel(era: "classic" | "nineties" | "contemporary"): string {
  if (era === "classic") return "Timeless classics";
  if (era === "nineties") return "90s favourites";
  return "Modern picks";
}

// ─── Section builders ─────────────────────────────────────────────────────────

function heroIntent(sig: Signals): SectionIntent {
  const genres = sig.topGenres.slice(0, 2).map((g) => g.id);
  const spec: CandidateSpec = {
    source: "discover",
    mediaType: sig.dominantMediaType === "both" ? "movie" : sig.dominantMediaType,
    genres,
    minRating: Math.min(sig.minRating + 0.5, 8.5),
  };

  // Bias toward dominant era if very strong (>50% of history)
  if (sig.era && sig.eraStrength > 0.5) {
    const bounds = eraDateBounds(sig.era);
    spec.releaseDateGte = bounds.gte;
    spec.releaseDateLte = bounds.lte;
    spec.era = sig.era;
  }

  const topNames = sig.topGenres.slice(0, 2).map((g) => g.name).join("/");
  return {
    id: "hero",
    type: "hero",
    theme: "Handpicked for you",
    rationale: `Top ${topNames} titles (${sig.topGenres[0]?.share ?? "?"}% of DNA) — high quality bar (${spec.minRating}+)`,
    targetCount: 6,
    candidateSpec: spec,
  };
}

function topGenreRowIntent(sig: Signals, idx: 0 | 1): SectionIntent {
  const g = sig.topGenres[idx];
  return {
    id: `row_genre_${g.id}`,
    type: "row",
    theme: g.name,
    rationale: `${g.share}% of viewing DNA — genre #${idx + 1}`,
    targetCount: 8,
    candidateSpec: {
      source: "discover",
      mediaType: sig.dominantMediaType,
      genres: [g.id],
      minRating: sig.minRating,
      // popularity sort surfaces mainstream acclaimed titles over niche high-rated content
      sortBy: "popularity.desc",
      minVoteCount: 1000,
    },
  };
}

function newReleasesRowIntent(sig: Signals): SectionIntent {
  return {
    id: "row_new_releases",
    type: "row",
    theme: "New releases for you",
    rationale: "Recent 18 months filtered to taste DNA genres",
    targetCount: 8,
    candidateSpec: {
      source: "new_releases",
      mediaType: sig.dominantMediaType,
      genres: sig.topGenres.slice(0, 3).map((g) => g.id),
      minRating: sig.minRating,
      // Low vote threshold — new releases haven't had time to accumulate votes
      minVoteCount: 50,
      releaseDateGte: monthsAgo(18),
    },
  };
}

function eraRowIntent(sig: Signals): SectionIntent {
  const era = sig.era ?? "contemporary";
  const bounds = eraDateBounds(era);
  return {
    id: `row_era_${era}`,
    type: "row",
    theme: eraLabel(era),
    rationale: `${Math.round(sig.eraStrength * 100)}% of history from ${era} era`,
    targetCount: 8,
    candidateSpec: {
      source: "discover",
      mediaType: sig.dominantMediaType,
      genres: sig.topGenres.slice(0, 3).map((g) => g.id),
      minRating: sig.minRating,
      releaseDateGte: bounds.gte,
      releaseDateLte: bounds.lte,
      era,
    },
  };
}

function genreBlendRowIntent(sig: Signals): SectionIntent {
  // Combine top 2 genres with AND logic — e.g. Crime + Drama → The Wire, Breaking Bad, Sopranos
  const genres = sig.topGenres.slice(0, 2).map((g) => g.id);
  const label = sig.topGenres.slice(0, 2).map((g) => g.name).join(" & ");
  return {
    id: "row_genre_blend",
    type: "row",
    theme: label,
    rationale: `Intersection of top 2 genres (${label}) — most on-brand content`,
    targetCount: 8,
    candidateSpec: {
      source: "discover",
      mediaType: sig.dominantMediaType === "both" ? "movie" : sig.dominantMediaType,
      genres,
      minRating: sig.minRating,
      sortBy: "popularity.desc",
      minVoteCount: 500,
    },
  };
}

function discoverySpotlightIntent(sig: Signals): SectionIntent {
  return {
    id: "spotlight_discovery",
    type: "spotlight",
    theme: "Worth finding",
    rationale: `Novelty tolerance ${Math.round(sig.noveltyTolerance * 100)}% — surfacing a hidden gem`,
    targetCount: 6,
    candidateSpec: {
      source: "hidden_gem",
      mediaType: sig.dominantMediaType,
      genres: sig.topGenres.slice(0, 2).map((g) => g.id),
      minRating: sig.minRating + 0.3,
      maxPopularity: 75,
    },
  };
}

// ─── New-user fallback ────────────────────────────────────────────────────────

function newUserIntents(ctx: ActionContext): SectionIntent[] {
  const preferred = ctx.favoriteGenres.length > 0 ? ctx.favoriteGenres.slice(0, 3) : undefined;
  return [
    {
      id: "hero",
      type: "hero",
      theme: "Trending now",
      rationale: "New user — serving trending content",
      targetCount: 6,
      candidateSpec: {
        source: "trending",
        mediaType: "movie",
        genres: preferred,
        minRating: 7.0,
      },
    },
    {
      id: "row_trending_tv",
      type: "row",
      theme: "Popular TV right now",
      rationale: "New user — trending shows",
      targetCount: 8,
      candidateSpec: {
        source: "trending",
        mediaType: "tv",
        genres: preferred,
        minRating: 7.0,
      },
    },
    {
      id: "row_acclaimed",
      type: "row",
      theme: "Critically acclaimed",
      rationale: "New user — high-prestige picks to calibrate taste",
      targetCount: 8,
      candidateSpec: {
        source: "discover",
        mediaType: "movie",
        minRating: 8.0,
      },
    },
    {
      id: "spotlight_discovery",
      type: "spotlight",
      theme: "A gem you might have missed",
      rationale: "New user — introduce discovery angle",
      targetCount: 6,
      candidateSpec: {
        source: "hidden_gem",
        mediaType: "movie",
        minRating: 7.5,
        maxPopularity: 75,
      },
    },
  ];
}

// ─── DNA-row-based intents (primary path for users with taste profile) ────────

function dnaRowsToIntents(ctx: ActionContext, sig: Signals): SectionIntent[] {
  const rows = ctx.tasteDNARows;

  // Hero: always use trending so the pool is guaranteed non-empty regardless
  // of how much the user has already watched.
  const hero: SectionIntent = {
    id: "hero",
    type: "hero",
    theme: "Handpicked for you",
    rationale: "Trending hero — always populated",
    targetCount: 6,
    candidateSpec: {
      source: "trending",
      mediaType: sig.dominantMediaType === "tv" ? "tv" : "movie",
    },
  };

  // 4 thematic rows from DNA.
  //
  // Movie rows: TMDB /discover/movie with vote_average filters has been unreliable
  // in the edge function — queries return 0 results when combining AND genres with
  // vote_average.gte. So movie rows use a single primary genre + popularity sort
  // to guarantee a non-empty pool. The AI curator picks thematically-appropriate
  // titles from the broad pool.
  //
  // TV row: /discover/tv is reliable with 2 genres + vote_average filter, so it
  // keeps the tighter spec.
  // Keywords that imply the row should surface obscure content, not mainstream hits.
  const HIDDEN_KEYWORDS = ["hidden", "underground", "micro", "overlooked", "undiscovered", "obscure", "forgotten", "underrated", "gem", "cult", "radar", "festival", "indie"];
  const isObscureTheme = (title: string) => HIDDEN_KEYWORDS.some(kw => title.toLowerCase().includes(kw));

  const thematicRows: SectionIntent[] = rows.slice(0, 4).map((row, i) => {
    const isMovie = row.type === "movie";
    const obscure = isObscureTheme(row.title);
    return {
      id: `row_dna_${i}`,
      type: "row" as const,
      theme: row.title,
      rationale: row.subtitle,
      targetCount: 10,
      candidateSpec: {
        source: "discover" as const,
        mediaType: row.type,
        genres: isMovie ? [row.genreIds[0]] : row.genreIds.slice(0, 2),
        // Quality floor for all DNA rows (movies previously had none, causing noise)
        minRating: row.voteAverageGte ?? 7.0,
        // Movies need more votes to be credibly rated; obscure rows allow fewer
        minVoteCount: isMovie ? (obscure ? 200 : 500) : (obscure ? 100 : 200),
        // Always sort by quality, not popularity — popularity.desc was returning
        // mainstream blockbusters (Lion King) for thematic rows like "Human Condition"
        sortBy: "vote_average.desc",
        // Universal 2000+ floor: prevents pre-2000 classics (Cuckoo's Nest 1975,
        // Apocalypse Now 1979, Rear Window 1954) from dominating vote_average.desc results.
        // The AI curator then picks from this pool of quality contemporary films.
        releaseDateGte: "2000-01-01",
        // Obscure-themed rows cap popularity so mainstream hits (Succession, Chernobyl)
        // can't appear in "Hidden TV" or "Festival Underground" rows.
        maxPopularity: obscure ? 45 : undefined,
      },
    };
  });

  // Trending movies row: always populated, fills in if any DNA movie row fails.
  // Client caps visible rows at 4, so this only shows if a DNA row pool is empty.
  const trendingMovies: SectionIntent = {
    id: "row_trending_movies",
    type: "row" as const,
    theme: "What's big right now",
    rationale: "Trending movies this week — guaranteed pool",
    targetCount: 10,
    candidateSpec: {
      source: "trending",
      mediaType: "movie",
    },
  };

  // hero + 4 DNA rows + 1 trending fallback = 6 intents
  // → client shows up to 4 row sections, trending fills any DNA gap
  return [hero, ...thematicRows, trendingMovies];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function generateSectionIntents(ctx: ActionContext): SectionIntent[] {
  const sig = extractSignals(ctx);

  if (sig.isNewUser) return newUserIntents(ctx);

  // Primary path: use AI-generated DNA row themes — they encode specific thematic
  // taste (e.g. "Moral Labyrinths", "Clever Capers") vs generic genre names
  if (ctx.tasteDNARows.length >= 2) {
    return dnaRowsToIntents(ctx, sig);
  }

  // Fallback: derive intents from DNA signals when no row specs exist
  const intents: SectionIntent[] = [];

  intents.push(heroIntent(sig));

  if (sig.topGenres.length >= 1) intents.push(topGenreRowIntent(sig, 0));
  if (sig.noveltyTolerance > 0.25) intents.push(newReleasesRowIntent(sig));
  if (sig.topGenres.length >= 2) intents.push(genreBlendRowIntent(sig));
  if (sig.topGenres.length >= 2) intents.push(topGenreRowIntent(sig, 1));
  if (sig.era && sig.eraStrength > 0.3) intents.push(eraRowIntent(sig));
  if (sig.noveltyTolerance > 0.5) intents.push(discoverySpotlightIntent(sig));

  // Pad to at least 4 sections
  const existingIds = new Set(intents.map((i) => i.id));
  if (!existingIds.has("row_acclaimed")) {
    intents.push({
      id: "row_acclaimed", type: "row", theme: "Critically acclaimed",
      rationale: "Fallback padding", targetCount: 8,
      candidateSpec: { source: "discover", mediaType: "movie", minRating: 8.0 },
    });
  }
  if (intents.length < 4 && !existingIds.has("row_trending_tv")) {
    intents.push({
      id: "row_trending_tv", type: "row", theme: "Popular TV right now",
      rationale: "Fallback padding", targetCount: 8,
      candidateSpec: { source: "trending", mediaType: "tv" },
    });
  }

  return intents.slice(0, 5);
}
