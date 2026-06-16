import type { ThematicRow } from './tasteDna';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RowTemplate extends ThematicRow {
  id: string;
  /** Genre IDs to check against user's affinity map for scoring */
  scoreGenres: number[];
  /** Profile dimension weights: positive = template suits users with high value */
  scoreDarkness: number;  // -0.5 to +0.5
  scorePrestige: number;  // -0.3 to +0.5
  scoreIndie: number;     // -0.2 to +0.5
  scoreNovelty: number;   // -0.2 to +0.4
  /** Bonus if user's pacing preference matches */
  pacingFit?: 'slow' | 'medium' | 'fast';
  /** Bonus if user's top era matches */
  eraFit?: 'classic' | 'nineties' | 'modern';
  /** Hard profile gates — template skipped if user profile fails these */
  minDarkness?: number;
  maxDarkness?: number;
  minPrestige?: number;
  maxPrestige?: number;
  minNovelty?: number;
  minIndie?: number;
  /** Temporal windows where this template is eligible (absent = always eligible) */
  temporal?: {
    timeOfDay?: ('morning' | 'afternoon' | 'evening' | 'late-night')[];
    season?: ('spring' | 'summer' | 'autumn' | 'winter')[];
    specialPeriod?: string[];  // substring match on temporal.specialPeriod
    dayType?: ('weekday' | 'weekend')[];
  };
  /** Base desirability for users with no watch history. 0–1. */
  baseScore: number;
}

// ─── Template library ─────────────────────────────────────────────────────────
// ~70 curated editorial rows. Selected deterministically against user TasteProfile.
// Gemini is NOT involved in selection — this is pure retrieval configuration.

export const ROW_TEMPLATES: RowTemplate[] = [

  // ── CRIME & THRILLER — MOVIES ───────────────────────────────────────────────

  {
    id: 'neo-noir-crime',
    title: "Neo-Noir Essentials",
    subtitle: "Morally complex crime fiction with real darkness and procedural intelligence",
    type: 'movie', genreIds: [80, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1500,
    scoreGenres: [80, 53], scoreDarkness: 0.45, scorePrestige: 0.20, scoreIndie: 0.05, scoreNovelty: 0,
    minDarkness: 0.2, baseScore: 0.7,
  },
  {
    id: 'paranoid-thriller',
    title: "The Paranoid Thriller",
    subtitle: "Suspense cinema where nobody's motives are what they seem",
    type: 'movie', genreIds: [53, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 1000,
    scoreGenres: [53, 9648], scoreDarkness: 0.40, scorePrestige: 0.25, scoreIndie: 0.10, scoreNovelty: 0.10,
    minDarkness: 0.15, baseScore: 0.65,
  },
  {
    id: 'moral-labyrinths',
    title: "Moral Labyrinths",
    subtitle: "Crime drama that takes its characters' choices completely seriously",
    type: 'movie', genreIds: [80, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 800,
    scoreGenres: [80, 18], scoreDarkness: 0.35, scorePrestige: 0.35, scoreIndie: 0.15, scoreNovelty: 0,
    minDarkness: 0.15, minPrestige: 0.25, pacingFit: 'medium', baseScore: 0.60,
  },
  {
    id: 'heist-canon',
    title: "The Great Heist Canon",
    subtitle: "The art of the impossible job, executed with style",
    type: 'movie', genreIds: [80, 12],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 1500,
    scoreGenres: [80, 28, 12], scoreDarkness: 0.20, scorePrestige: 0.10, scoreIndie: -0.10, scoreNovelty: -0.10,
    baseScore: 0.70,
  },
  {
    id: 'spy-espionage',
    title: "Cold War & Espionage",
    subtitle: "Double agents, state secrets, and the cost of living in the shadows",
    type: 'movie', genreIds: [28, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 1000,
    scoreGenres: [53, 28], scoreDarkness: 0.25, scorePrestige: 0.20, scoreIndie: 0, scoreNovelty: 0,
    baseScore: 0.62,
  },
  {
    id: 'anatomy-of-vengeance',
    title: "Anatomy of Vengeance",
    subtitle: "Ice-cold films where justice and revenge are the same thing",
    type: 'movie', genreIds: [28, 53, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 500,
    scoreGenres: [53, 80, 28], scoreDarkness: 0.45, scorePrestige: 0.10, scoreIndie: 0.15, scoreNovelty: 0.10,
    minDarkness: 0.25, baseScore: 0.55,
  },
  {
    id: 'psychological-thrillers',
    title: "Slow-Burn Psychologicals",
    subtitle: "Patient, methodical films where the real tension is inside the characters",
    type: 'movie', genreIds: [53, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 500,
    scoreGenres: [53, 18, 9648], scoreDarkness: 0.35, scorePrestige: 0.35, scoreIndie: 0.20, scoreNovelty: 0.10,
    minDarkness: 0.2, pacingFit: 'slow', baseScore: 0.60,
  },

  // ── CRIME & THRILLER — TV ────────────────────────────────────────────────────

  {
    id: 'dark-detective-tv',
    title: "Dark Detective Stories",
    subtitle: "Detectives who carry the weight of everything they investigate",
    type: 'tv', genreIds: [80, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 300,
    scoreGenres: [80, 9648], scoreDarkness: 0.40, scorePrestige: 0.20, scoreIndie: 0.10, scoreNovelty: 0,
    minDarkness: 0.2, baseScore: 0.65,
  },
  {
    id: 'prestige-crime-tv',
    title: "Prestige Crime Television",
    subtitle: "Long-form crime that rewards patience, attention, and investment",
    type: 'tv', genreIds: [80, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 500,
    scoreGenres: [80, 18], scoreDarkness: 0.30, scorePrestige: 0.40, scoreIndie: 0.10, scoreNovelty: 0,
    minPrestige: 0.2, baseScore: 0.70,
  },
  {
    id: 'true-crime-tv',
    title: "True Crime: The Essential Cases",
    subtitle: "Real cases with documentary rigour and real journalistic restraint",
    type: 'tv', genreIds: [99, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200,
    scoreGenres: [99, 80], scoreDarkness: 0.30, scorePrestige: 0.20, scoreIndie: 0.15, scoreNovelty: 0.10,
    baseScore: 0.58,
  },

  // ── HORROR ──────────────────────────────────────────────────────────────────

  {
    id: 'elevated-horror',
    title: "Elevated Horror Cinema",
    subtitle: "Horror that uses fear to say something genuinely worth hearing",
    type: 'movie', genreIds: [27, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 500,
    scoreGenres: [27, 53], scoreDarkness: 0.50, scorePrestige: 0.30, scoreIndie: 0.20, scoreNovelty: 0.10,
    minDarkness: 0.30, baseScore: 0.55,
  },
  {
    id: 'atmospheric-horror',
    title: "Atmospheric Horror",
    subtitle: "Slow, mounting dread — more about what you feel than what you see",
    type: 'movie', genreIds: [27],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 300,
    scoreGenres: [27], scoreDarkness: 0.50, scorePrestige: 0.20, scoreIndie: 0.25, scoreNovelty: 0.15,
    minDarkness: 0.35, pacingFit: 'slow', baseScore: 0.50,
  },
  {
    id: 'new-horror-wave',
    title: "The New Horror Wave",
    subtitle: "The freshest voices redefining what horror cinema can do",
    type: 'movie', genreIds: [27],
    sortBy: 'primary_release_date.desc', voteAverageGte: 6.8, voteCountGte: 300,
    releaseDateGte: '2018-01-01',
    scoreGenres: [27], scoreDarkness: 0.45, scorePrestige: 0.20, scoreIndie: 0.15, scoreNovelty: 0.25,
    minDarkness: 0.25, baseScore: 0.50,
  },
  {
    id: 'folk-horror',
    title: "Folk Horror & Slow Dread",
    subtitle: "Ancient ritual, countryside unease, and dread that builds over days",
    type: 'movie', genreIds: [27, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 200,
    scoreGenres: [27, 9648], scoreDarkness: 0.50, scorePrestige: 0.25, scoreIndie: 0.30, scoreNovelty: 0.20,
    minDarkness: 0.30, pacingFit: 'slow', baseScore: 0.45,
  },
  {
    id: 'halloween-horror',
    title: "Halloween Essential Horror",
    subtitle: "The horror cinema canon for October nights",
    type: 'movie', genreIds: [27, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1000,
    scoreGenres: [27, 53], scoreDarkness: 0.40, scorePrestige: 0.10, scoreIndie: 0, scoreNovelty: 0,
    temporal: { specialPeriod: ['Halloween'] },
    baseScore: 0.80,
  },

  // ── PRESTIGE DRAMA — MOVIES ──────────────────────────────────────────────────

  {
    id: 'quiet-devastation',
    title: "Quiet Devastation",
    subtitle: "Slow, precise films that take human emotion completely seriously",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 300,
    scoreGenres: [18], scoreDarkness: 0.20, scorePrestige: 0.50, scoreIndie: 0.35, scoreNovelty: 0.20,
    minPrestige: 0.35, pacingFit: 'slow', baseScore: 0.55,
  },
  {
    id: 'award-circuit',
    title: "Award Circuit Essentials",
    subtitle: "The films the prestige conversation is built around",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 2000,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.50, scoreIndie: 0.10, scoreNovelty: -0.10,
    minPrestige: 0.30, baseScore: 0.68,
  },
  {
    id: 'intimate-character',
    title: "Intimate Character Studies",
    subtitle: "Small-scale stories where the character is entirely the plot",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.45, scoreIndie: 0.30, scoreNovelty: 0.20,
    minPrestige: 0.3, pacingFit: 'slow', baseScore: 0.52,
  },
  {
    id: 'cannes-breakouts',
    title: "Modern Cannes Breakouts",
    subtitle: "Recent festival cinema that international critics couldn't stop discussing",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    releaseDateGte: '2015-01-01',
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.45, scoreIndie: 0.40, scoreNovelty: 0.30,
    minPrestige: 0.3, minNovelty: 0.15, baseScore: 0.52,
  },
  {
    id: 'social-realism',
    title: "The Human Condition",
    subtitle: "Films that look directly at the world and refuse to look away",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 400,
    scoreGenres: [18], scoreDarkness: 0.25, scorePrestige: 0.40, scoreIndie: 0.35, scoreNovelty: 0.10,
    minPrestige: 0.3, baseScore: 0.55,
  },
  {
    id: 'grief-and-loss',
    title: "The Weight of Things",
    subtitle: "Cinema that handles grief with the care and weight it deserves",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    scoreGenres: [18], scoreDarkness: 0.30, scorePrestige: 0.40, scoreIndie: 0.20, scoreNovelty: 0.10,
    minPrestige: 0.25, baseScore: 0.55,
  },
  {
    id: 'coming-of-age',
    title: "Coming of Age, Coming Apart",
    subtitle: "The moment everything changes, captured with honesty and precision",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.30, scoreIndie: 0.25, scoreNovelty: 0.10,
    baseScore: 0.62,
  },
  {
    id: 'awards-season',
    title: "Awards Season Favourites",
    subtitle: "The films the academies and critics are debating right now",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 1000,
    releaseDateGte: `${new Date().getFullYear() - 1}-01-01`,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.50, scoreIndie: 0.10, scoreNovelty: 0.10,
    temporal: { specialPeriod: ['awards'] },
    minPrestige: 0.25, baseScore: 0.75,
  },
  {
    id: 'slow-revelation',
    title: "The Slow Revelation",
    subtitle: "Patient films where understanding arrives gradually and devastatingly",
    type: 'movie', genreIds: [18, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 400,
    scoreGenres: [18, 9648], scoreDarkness: 0.25, scorePrestige: 0.40, scoreIndie: 0.20, scoreNovelty: 0.15,
    minPrestige: 0.3, pacingFit: 'slow', baseScore: 0.53,
  },

  // ── PRESTIGE DRAMA — TV ──────────────────────────────────────────────────────

  {
    id: 'prestige-drama-tv',
    title: "Prestige Drama Worth Obsessing Over",
    subtitle: "Long-form television that treats its subject with craft and seriousness",
    type: 'tv', genreIds: [18],
    excludeGenres: [14, 10759, 10765, 27], // no fantasy, action-adventure, sci-fi, horror
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 300,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.50, scoreIndie: 0.10, scoreNovelty: 0,
    minPrestige: 0.25, baseScore: 0.72,
  },
  {
    id: 'family-saga-tv',
    title: "Family Saga Television",
    subtitle: "Multi-generational stories where time itself becomes the central character",
    type: 'tv', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 300,
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.35, scoreIndie: 0.15, scoreNovelty: 0,
    baseScore: 0.60,
  },

  // ── INDIE & ARTHOUSE ─────────────────────────────────────────────────────────

  {
    id: 'emotional-indie',
    title: "Emotional Indie Cinema",
    subtitle: "Small films with enormous emotional ambition and no budget for compromise",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200,
    scoreGenres: [18], scoreDarkness: 0.20, scorePrestige: 0.35, scoreIndie: 0.50, scoreNovelty: 0.30,
    minIndie: 0.3, baseScore: 0.50,
  },
  {
    id: 'critical-darlings',
    title: "Critical Darlings",
    subtitle: "Films critics return to again and again for legitimate reasons",
    type: 'movie', genreIds: [18, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 200,
    scoreGenres: [18], scoreDarkness: 0.20, scorePrestige: 0.45, scoreIndie: 0.40, scoreNovelty: 0.35,
    minPrestige: 0.3, minNovelty: 0.2, baseScore: 0.48,
  },
  {
    id: 'festival-underground',
    title: "Festival Underground",
    subtitle: "Festival discoveries before they've found their mainstream audience",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 100,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.30, scoreIndie: 0.50, scoreNovelty: 0.40,
    minIndie: 0.4, minNovelty: 0.3, baseScore: 0.40,
  },
  {
    id: 'overlooked-tv',
    title: "Hidden Television",
    subtitle: "Series that slipped past most people but reward those who find them",
    type: 'tv', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 100,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.30, scoreIndie: 0.45, scoreNovelty: 0.40,
    minNovelty: 0.25, baseScore: 0.42,
  },

  // ── SCIENCE FICTION — MOVIES ─────────────────────────────────────────────────

  {
    id: 'prestige-scifi',
    title: "Prestige Sci-Fi That Lingers",
    subtitle: "Science fiction that earns its ideas through serious filmmaking",
    type: 'movie', genreIds: [878],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1500,
    scoreGenres: [878], scoreDarkness: 0.15, scorePrestige: 0.45, scoreIndie: 0.10, scoreNovelty: 0.10,
    minPrestige: 0.25, pacingFit: 'slow', baseScore: 0.65,
  },
  {
    id: 'mind-bending-scifi',
    title: "Mind-Bending Science Fiction",
    subtitle: "Films that restructure how you think about reality for days afterward",
    type: 'movie', genreIds: [878, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 1000,
    scoreGenres: [878, 53], scoreDarkness: 0.15, scorePrestige: 0.30, scoreIndie: 0.20, scoreNovelty: 0.25,
    baseScore: 0.68,
  },
  {
    id: 'hard-scifi',
    title: "Hard Science Fiction",
    subtitle: "Science fiction that takes both the science and the humanity seriously",
    type: 'movie', genreIds: [878],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    scoreGenres: [878], scoreDarkness: 0.10, scorePrestige: 0.40, scoreIndie: 0.20, scoreNovelty: 0.20,
    minPrestige: 0.3, baseScore: 0.55,
  },

  // ── SCIENCE FICTION — TV ─────────────────────────────────────────────────────

  {
    id: 'dystopian-tv',
    title: "Dystopian Television",
    subtitle: "Futures dark enough to hold a mirror to the present moment",
    type: 'tv', genreIds: [10765, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 300,
    scoreGenres: [10765, 18], scoreDarkness: 0.30, scorePrestige: 0.30, scoreIndie: 0.10, scoreNovelty: 0.10,
    minDarkness: 0.2, baseScore: 0.62,
  },
  {
    id: 'intelligent-genre-tv',
    title: "Intelligent Genre Television",
    subtitle: "Genre television with enough craft and ambition to transcend genre entirely",
    type: 'tv', genreIds: [10765],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 500,
    scoreGenres: [10765], scoreDarkness: 0.15, scorePrestige: 0.35, scoreIndie: 0.15, scoreNovelty: 0.15,
    baseScore: 0.60,
  },

  // ── COMEDY ───────────────────────────────────────────────────────────────────

  {
    id: 'smart-adult-comedy',
    title: "Smart Adult Comedy",
    subtitle: "Comedies with enough intelligence to also make you think",
    type: 'movie', genreIds: [35, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 1000,
    scoreGenres: [35, 18], scoreDarkness: -0.20, scorePrestige: 0.25, scoreIndie: 0.15, scoreNovelty: 0.10,
    maxDarkness: 0.55, baseScore: 0.65,
  },
  {
    id: 'dark-comedy',
    title: "Satirical Dark Comedy",
    subtitle: "Humour that knows exactly how uncomfortable it's making you",
    type: 'movie', genreIds: [35, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 500,
    scoreGenres: [35, 80], scoreDarkness: 0.30, scorePrestige: 0.20, scoreIndie: 0.15, scoreNovelty: 0.10,
    minDarkness: 0.2, baseScore: 0.58,
  },
  {
    id: 'british-comedy-tv',
    title: "British Comedy Excellence",
    subtitle: "British comic sensibility at its most precise, specific, and devastating",
    type: 'tv', genreIds: [35],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 500,
    originCountry: 'GB',
    scoreGenres: [35], scoreDarkness: -0.10, scorePrestige: 0.30, scoreIndie: 0.25, scoreNovelty: 0.15,
    baseScore: 0.60,
  },
  {
    id: 'cult-comedy',
    title: "Cult Comedy Cinema",
    subtitle: "Comedy that found its devoted audience through discovery, not marketing",
    type: 'movie', genreIds: [35],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    scoreGenres: [35], scoreDarkness: -0.10, scorePrestige: 0.15, scoreIndie: 0.35, scoreNovelty: 0.30,
    minNovelty: 0.15, baseScore: 0.52,
  },
  {
    id: 'comfort-comedy',
    title: "Comfort Viewing Essentials",
    subtitle: "Reliable, warm comedies that always deliver exactly what they promise",
    type: 'movie', genreIds: [35],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 2000,
    scoreGenres: [35], scoreDarkness: -0.35, scorePrestige: -0.10, scoreIndie: -0.20, scoreNovelty: -0.20,
    maxDarkness: 0.35, baseScore: 0.68,
  },

  // ── DOCUMENTARY ─────────────────────────────────────────────────────────────

  {
    id: 'essential-docs',
    title: "Essential Documentaries",
    subtitle: "Documentaries that change how you understand the subject entirely",
    type: 'movie', genreIds: [99],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    scoreGenres: [99], scoreDarkness: 0.10, scorePrestige: 0.35, scoreIndie: 0.30, scoreNovelty: 0.20,
    baseScore: 0.58,
  },
  {
    id: 'art-culture-docs',
    title: "Art, Culture & Obsession",
    subtitle: "Films about creative genius, artistic obsession, and cultural turning points",
    type: 'movie', genreIds: [99],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200,
    scoreGenres: [99], scoreDarkness: 0, scorePrestige: 0.40, scoreIndie: 0.35, scoreNovelty: 0.25,
    minPrestige: 0.25, baseScore: 0.50,
  },
  {
    id: 'nature-science-tv',
    title: "The Natural World",
    subtitle: "Natural history and science television that makes the planet feel miraculous",
    type: 'tv', genreIds: [99],
    // TMDB keyword IDs (pipe = OR): 10683 nature, 5734 wildlife, 194965 natural history
    withKeywords: '10683|5734|194965',
    // Exclude crime, mystery, sci-fi/fantasy, action-adventure — keeps out true crime,
    // alien conspiracy, and sports docs that share genre 99
    excludeGenres: [80, 9648, 10765, 10759, 878],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 200,
    scoreGenres: [99], scoreDarkness: -0.25, scorePrestige: 0.20, scoreIndie: 0.10, scoreNovelty: 0.10,
    maxDarkness: 0.40, baseScore: 0.62,
  },

  // ── ANIMATION ────────────────────────────────────────────────────────────────

  {
    id: 'adult-animation-tv',
    title: "Smart Adult Animation",
    subtitle: "Animation for adults who understand the medium can carry real weight",
    type: 'tv', genreIds: [16],
    // Exclude kids/family at TMDB level; JS isMismatchedNiche adds a second layer
    excludeGenres: [10762, 10751],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 500,
    scoreGenres: [16], scoreDarkness: 0.10, scorePrestige: 0.25, scoreIndie: 0.20, scoreNovelty: 0.20,
    baseScore: 0.62,
  },
  {
    id: 'animated-film-canon',
    title: "The Animated Film Canon",
    subtitle: "Animated films that belong in any serious cinema education",
    type: 'movie', genreIds: [16],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 2000,
    scoreGenres: [16], scoreDarkness: 0, scorePrestige: 0.30, scoreIndie: 0.10, scoreNovelty: 0,
    baseScore: 0.65,
  },
  {
    id: 'anime-cinema',
    title: "Essential Anime Cinema",
    subtitle: "Japanese animated cinema at its most ambitious and emotionally demanding",
    type: 'movie', genreIds: [16],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    scoreGenres: [16], scoreDarkness: 0.10, scorePrestige: 0.25, scoreIndie: 0.20, scoreNovelty: 0.30,
    baseScore: 0.55,
  },

  // ── ACTION & ADVENTURE ────────────────────────────────────────────────────────

  {
    id: 'cerebral-action',
    title: "Cerebral Action Cinema",
    subtitle: "Action films with enough craft and intelligence to work on every level",
    type: 'movie', genreIds: [28, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 2000,
    scoreGenres: [28, 53], scoreDarkness: 0.20, scorePrestige: 0.30, scoreIndie: 0, scoreNovelty: 0,
    minPrestige: 0.2, baseScore: 0.70,
  },
  {
    id: 'modern-action',
    title: "Modern Action Masterpieces",
    subtitle: "Contemporary action cinema that earns its spectacle through genuine craft",
    type: 'movie', genreIds: [28, 12],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 3000,
    scoreGenres: [28, 12], scoreDarkness: 0.10, scorePrestige: 0.10, scoreIndie: -0.15, scoreNovelty: -0.15,
    maxDarkness: 0.60, baseScore: 0.72,
  },
  {
    id: 'epic-adventure',
    title: "Epic Adventure Cinema",
    subtitle: "Grand-scale adventure with the scope and heart to match its ambitions",
    type: 'movie', genreIds: [12, 14],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 3000,
    scoreGenres: [12, 14, 28], scoreDarkness: -0.20, scorePrestige: 0, scoreIndie: -0.20, scoreNovelty: -0.15,
    maxDarkness: 0.45, baseScore: 0.70,
  },

  // ── ERA-SPECIFIC ─────────────────────────────────────────────────────────────

  {
    id: 'new-hollywood',
    title: "New Hollywood Revisited",
    subtitle: "The films that broke Hollywood's rules and changed cinema permanently",
    type: 'movie', genreIds: [80, 18, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1000,
    releaseDateGte: '1966-01-01', releaseDateLte: '1984-12-31',
    scoreGenres: [80, 18], scoreDarkness: 0.25, scorePrestige: 0.40, scoreIndie: 0.20, scoreNovelty: 0.10,
    eraFit: 'classic', baseScore: 0.58,
  },
  {
    id: 'nineties-indie',
    title: "90s Independent Cinema",
    subtitle: "The explosion of American independent film that defined a generation",
    type: 'movie', genreIds: [18, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    releaseDateGte: '1990-01-01', releaseDateLte: '1999-12-31',
    scoreGenres: [18, 80], scoreDarkness: 0.20, scorePrestige: 0.30, scoreIndie: 0.35, scoreNovelty: 0.10,
    eraFit: 'nineties', baseScore: 0.60,
  },
  {
    id: 'classic-cinema',
    title: "The Golden Age of Cinema",
    subtitle: "The films that established what cinema was actually capable of",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 2000,
    releaseDateLte: '1969-12-31',
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.45, scoreIndie: 0.15, scoreNovelty: 0,
    eraFit: 'classic', minPrestige: 0.3, baseScore: 0.55,
  },
  {
    id: 'essential-2000s',
    title: "Essential 2000s Cinema",
    subtitle: "The films that defined the opening decade of contemporary cinema",
    type: 'movie', genreIds: [18, 80, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1000,
    releaseDateGte: '2000-01-01', releaseDateLte: '2009-12-31',
    scoreGenres: [18, 80], scoreDarkness: 0.20, scorePrestige: 0.30, scoreIndie: 0.15, scoreNovelty: 0,
    eraFit: 'modern', baseScore: 0.62,
  },
  {
    id: 'modern-classics',
    title: "Modern Classics (2010–2019)",
    subtitle: "The decade's films most likely to still be discussed in twenty years",
    type: 'movie', genreIds: [18, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 2000,
    releaseDateGte: '2010-01-01', releaseDateLte: '2019-12-31',
    scoreGenres: [18, 80], scoreDarkness: 0.15, scorePrestige: 0.45, scoreIndie: 0.10, scoreNovelty: 0,
    eraFit: 'modern', minPrestige: 0.3, baseScore: 0.65,
  },
  {
    id: 'peak-tv',
    title: "Peak TV: The Essential Series",
    subtitle: "The television that made the definitive case that the medium could rival film",
    type: 'tv', genreIds: [18, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 8.5, voteCountGte: 1000,
    releaseDateGte: '2010-01-01', releaseDateLte: '2019-12-31',
    scoreGenres: [18, 80], scoreDarkness: 0.15, scorePrestige: 0.50, scoreIndie: 0.10, scoreNovelty: 0,
    minPrestige: 0.3, baseScore: 0.70,
  },

  // ── ROMANCE ──────────────────────────────────────────────────────────────────

  {
    id: 'intelligent-romance',
    title: "Intelligent Romance",
    subtitle: "Love stories that understand romance is a serious subject worth serious treatment",
    type: 'movie', genreIds: [10749, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 500,
    scoreGenres: [10749, 18], scoreDarkness: -0.15, scorePrestige: 0.25, scoreIndie: 0.20, scoreNovelty: 0.10,
    maxDarkness: 0.50, baseScore: 0.58,
  },
  {
    id: 'romantic-tv',
    title: "Romance Worth Investing In",
    subtitle: "Television romance with enough craft and patience to keep you genuinely invested",
    type: 'tv', genreIds: [10749, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    scoreGenres: [10749, 18], scoreDarkness: -0.20, scorePrestige: 0.20, scoreIndie: 0.15, scoreNovelty: 0.10,
    maxDarkness: 0.45, baseScore: 0.55,
  },

  // ── COMFORT & REWATCH ─────────────────────────────────────────────────────────

  {
    id: 'comfort-rewatch',
    title: "Comfort Rewatch Energy",
    subtitle: "Films reliable enough to return to whenever you need them most",
    type: 'movie', genreIds: [35, 12],
    sortBy: 'popularity.desc', voteAverageGte: 7.0, voteCountGte: 5000,
    scoreGenres: [35, 12], scoreDarkness: -0.40, scorePrestige: -0.10, scoreIndie: -0.25, scoreNovelty: -0.30,
    maxDarkness: 0.30, baseScore: 0.72,
  },
  {
    id: 'friday-night',
    title: "Friday Night Cinema",
    subtitle: "Exactly what a Friday night film experience should feel like",
    type: 'movie', genreIds: [35, 28],
    sortBy: 'popularity.desc', voteAverageGte: 7.0, voteCountGte: 3000,
    scoreGenres: [35, 28, 12], scoreDarkness: -0.30, scorePrestige: -0.10, scoreIndie: -0.20, scoreNovelty: -0.20,
    temporal: { dayType: ['weekend'], timeOfDay: ['evening'] },
    maxDarkness: 0.40, baseScore: 0.75,
  },
  {
    id: 'crowd-pleasers',
    title: "Crowd Pleasers",
    subtitle: "Films that earn their mainstream approval through genuine quality",
    type: 'movie', genreIds: [12, 35],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 5000,
    scoreGenres: [12, 28, 35], scoreDarkness: -0.25, scorePrestige: 0.10, scoreIndie: -0.20, scoreNovelty: -0.15,
    maxDarkness: 0.40, baseScore: 0.70,
  },

  // ── WAR & HISTORY ─────────────────────────────────────────────────────────────

  {
    id: 'war-cinema',
    title: "War Cinema That Earns Its Gravity",
    subtitle: "War films that understand both the spectacle and the genuine human cost",
    type: 'movie', genreIds: [10752, 18, 36],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1000,
    scoreGenres: [10752, 18, 36], scoreDarkness: 0.30, scorePrestige: 0.35, scoreIndie: 0.10, scoreNovelty: 0,
    baseScore: 0.58,
  },
  {
    id: 'historical-epics',
    title: "Historical Epics",
    subtitle: "History rendered on a scale that makes you feel the weight of time passing",
    type: 'movie', genreIds: [36, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1000,
    scoreGenres: [36, 18], scoreDarkness: 0.10, scorePrestige: 0.35, scoreIndie: 0, scoreNovelty: 0,
    baseScore: 0.60,
  },

  // ── LATE-NIGHT TEMPORAL ────────────────────────────────────────────────────────

  {
    id: 'after-midnight',
    title: "After Midnight",
    subtitle: "Atmospheric cinema best experienced after the world goes quiet",
    type: 'movie', genreIds: [53, 27, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 300,
    temporal: { timeOfDay: ['late-night'] },
    scoreGenres: [53, 27, 9648], scoreDarkness: 0.40, scorePrestige: 0.15, scoreIndie: 0.20, scoreNovelty: 0.10,
    baseScore: 0.80,
  },
  {
    id: 'nocturnal-cinema',
    title: "Nocturnal Cinema",
    subtitle: "Mystery and menace for late-night hours and quiet minds",
    type: 'movie', genreIds: [9648, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 500,
    temporal: { timeOfDay: ['late-night'] },
    scoreGenres: [9648, 53], scoreDarkness: 0.35, scorePrestige: 0.20, scoreIndie: 0.20, scoreNovelty: 0.10,
    baseScore: 0.78,
  },
  {
    id: 'late-night-prestige-tv',
    title: "Late Night Prestige TV",
    subtitle: "Slow, absorbing television for the hours when you have real patience",
    type: 'tv', genreIds: [18, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 300,
    temporal: { timeOfDay: ['late-night'] },
    scoreGenres: [18, 9648], scoreDarkness: 0.20, scorePrestige: 0.40, scoreIndie: 0.15, scoreNovelty: 0,
    baseScore: 0.75,
  },

  // ── EXTREME PROFILE — only selectable when profile dimensions are at the edges ─
  // These create the "this app really knows me" moments for users with strong taste signals.

  {
    id: 'slow-cinema-masters',
    title: "Slow Cinema Masters",
    subtitle: "Patient, contemplative films that reward complete surrender of your time",
    type: 'movie', genreIds: [18, 9648],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200,
    runtimeGte: 110,
    scoreGenres: [18, 9648], scoreDarkness: 0.20, scorePrestige: 0.40, scoreIndie: 0.30, scoreNovelty: 0.20,
    pacingFit: 'slow', minPrestige: 0.40, minNovelty: 0.35, baseScore: 0.42,
  },
  {
    id: 'micro-budget-discoveries',
    title: "Micro-Budget Discoveries",
    subtitle: "Films made without money but with everything else",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 50,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.25, scoreIndie: 0.55, scoreNovelty: 0.50,
    minIndie: 0.50, minNovelty: 0.45, baseScore: 0.35,
  },
  {
    id: 'critical-obsessions',
    title: "What Critics Keep Returning To",
    subtitle: "Films serious critics find worth discussing across decades",
    type: 'movie', genreIds: [18, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 100,
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.55, scoreIndie: 0.40, scoreNovelty: 0.40,
    minPrestige: 0.50, minNovelty: 0.40, baseScore: 0.38,
  },
  {
    id: 'uncompromising-dark-cinema',
    title: "Uncompromising Dark Cinema",
    subtitle: "Films that refuse to make darkness palatable or redemptive",
    type: 'movie', genreIds: [18, 53, 80],
    sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 200,
    scoreGenres: [18, 53, 80], scoreDarkness: 0.55, scorePrestige: 0.25, scoreIndie: 0.20, scoreNovelty: 0.15,
    minDarkness: 0.60, baseScore: 0.40,
  },
  {
    id: 'arthouse-genre',
    title: "Arthouse Genre Cinema",
    subtitle: "Genre films that transcend their genre through sheer filmmaking intelligence",
    type: 'movie', genreIds: [53, 80, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    scoreGenres: [53, 18, 80], scoreDarkness: 0.30, scorePrestige: 0.35, scoreIndie: 0.40, scoreNovelty: 0.25,
    minIndie: 0.30, minPrestige: 0.30, minDarkness: 0.25, baseScore: 0.44,
  },
  {
    id: 'nineties-dark-canon',
    title: "90s Dark Cinema Canon",
    subtitle: "The films from the 90s that still feel genuinely dangerous",
    type: 'movie', genreIds: [18, 80, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    releaseDateGte: '1990-01-01', releaseDateLte: '1999-12-31',
    scoreGenres: [18, 80, 53], scoreDarkness: 0.40, scorePrestige: 0.25, scoreIndie: 0.20, scoreNovelty: 0.10,
    eraFit: 'nineties', minDarkness: 0.35, baseScore: 0.48,
  },
  {
    id: 'world-cinema-prestige',
    title: "World Cinema Prestige",
    subtitle: "International cinema that demands subtitles and gives back everything",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 200,
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.50, scoreIndie: 0.35, scoreNovelty: 0.35,
    minPrestige: 0.40, minNovelty: 0.30, baseScore: 0.42,
  },
  {
    id: 'slow-burn-prestige-tv',
    title: "Slow-Burn Prestige TV",
    subtitle: "Series that earn their revelations through patience and extraordinary craft",
    type: 'tv', genreIds: [18, 9648],
    excludeGenres: [14, 10759, 10765], // no fantasy, action-adventure, sci-fi
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 200,
    scoreGenres: [18, 9648], scoreDarkness: 0.20, scorePrestige: 0.50, scoreIndie: 0.20, scoreNovelty: 0.15,
    pacingFit: 'slow', minPrestige: 0.45, baseScore: 0.44,
  },
  {
    id: 'pitch-black-comedy',
    title: "Pitch-Black Comedy",
    subtitle: "Comedy that finds the joke in the darkest possible place and holds it there",
    type: 'movie', genreIds: [35, 18, 53],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 200,
    scoreGenres: [35, 80, 18], scoreDarkness: 0.40, scorePrestige: 0.20, scoreIndie: 0.20, scoreNovelty: 0.15,
    minDarkness: 0.40, maxDarkness: 0.85, baseScore: 0.42,
  },
  {
    id: 'recent-festival-discoveries',
    title: "Recent Festival Discoveries",
    subtitle: "The last few years' most exciting festival films not yet widely seen",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.2, voteCountGte: 100,
    releaseDateGte: '2022-01-01',
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.35, scoreIndie: 0.45, scoreNovelty: 0.45,
    minNovelty: 0.40, baseScore: 0.38,
  },
  {
    id: 'cerebral-scifi-slow',
    title: "Cerebral Sci-Fi for Patient Viewers",
    subtitle: "Science fiction that trusts you to keep up and makes the wait worthwhile",
    type: 'movie', genreIds: [878, 18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300,
    scoreGenres: [878, 18], scoreDarkness: 0.15, scorePrestige: 0.40, scoreIndie: 0.25, scoreNovelty: 0.25,
    pacingFit: 'slow', minPrestige: 0.35, baseScore: 0.44,
  },
  {
    id: 'hidden-tv-gems',
    title: "Hidden Television Worth Your Time",
    subtitle: "Series that brilliant people watch and almost nobody talks about",
    type: 'tv', genreIds: [18, 35],
    sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 50,
    scoreGenres: [18], scoreDarkness: 0.10, scorePrestige: 0.30, scoreIndie: 0.50, scoreNovelty: 0.50,
    minNovelty: 0.50, minIndie: 0.45, baseScore: 0.36,
  },

  // ── WEEKEND TEMPORAL ────────────────────────────────────────────────────────────

  {
    id: 'weekend-prestige',
    title: "Weekend Prestige Cinema",
    subtitle: "The films that reward giving up an entire weekend afternoon",
    type: 'movie', genreIds: [18],
    sortBy: 'vote_average.desc', voteAverageGte: 7.8, voteCountGte: 1500,
    temporal: { dayType: ['weekend'], timeOfDay: ['afternoon', 'evening'] },
    scoreGenres: [18], scoreDarkness: 0.15, scorePrestige: 0.45, scoreIndie: 0.10, scoreNovelty: 0,
    minPrestige: 0.2, baseScore: 0.68,
  },
  {
    id: 'weekend-epic-tv',
    title: "Epic Weekend Television",
    subtitle: "Series expansive enough to justify an entire weekend commitment",
    type: 'tv', genreIds: [18, 14],
    sortBy: 'vote_average.desc', voteAverageGte: 8.2, voteCountGte: 1000,
    temporal: { dayType: ['weekend'] },
    scoreGenres: [18, 14], scoreDarkness: 0.10, scorePrestige: 0.35, scoreIndie: 0, scoreNovelty: 0,
    baseScore: 0.70,
  },

];
