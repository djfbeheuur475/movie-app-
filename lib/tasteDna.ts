import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';
import type { ContentItem } from '../types';
import { supabase } from './supabase';

// ─── Temporal context ─────────────────────────────────────────────────────────

export interface TemporalContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'late-night';
  dayType: 'weekday' | 'weekend';
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  month: number;
  specialPeriod: string | null;
  // Changes every 6h — baking into fingerprint drives automatic row rotation
  dateKey: string;
  description: string;
}

export function getTemporalContext(): TemporalContext {
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;
  const day = now.getDay();

  const timeOfDay =
    hour >= 5 && hour < 12 ? 'morning' :
    hour >= 12 && hour < 17 ? 'afternoon' :
    hour >= 17 && hour < 22 ? 'evening' : 'late-night';

  const dayType = day === 0 || day === 6 ? 'weekend' : 'weekday';

  const season =
    month >= 3 && month <= 5 ? 'spring' :
    month >= 6 && month <= 8 ? 'summer' :
    month >= 9 && month <= 11 ? 'autumn' : 'winter';

  const specialPeriod =
    month === 10 ? 'Halloween and horror season' :
    month === 12 ? 'festive season' :
    month === 1 || month === 2 ? 'awards season (Oscars, BAFTAs, Golden Globes)' :
    null;

  const hourBlock = Math.floor(hour / 6) * 6;
  const dateKey = `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${hourBlock}`;
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day];

  const description = [
    `${dayName} ${timeOfDay.replace('-', ' ')}`,
    season,
    specialPeriod ? `during ${specialPeriod}` : null,
  ].filter(Boolean).join(', ');

  return { timeOfDay, dayType, season, month, specialPeriod, dateKey, description };
}

// ─── Genre metadata ───────────────────────────────────────────────────────────

const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 14: 'Fantasy', 27: 'Horror', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 53: 'Thriller', 37: 'Western', 10751: 'Family', 36: 'History',
  16: 'Animation', 10759: 'Action & Adventure', 10765: 'Sci-Fi & Fantasy',
  10768: 'War & Politics',
};

// ─── Genre affinity ───────────────────────────────────────────────────────────

export type GenreAffinity = Record<number, number>; // genreId → normalised 0–1 weight

export function computeGenreAffinity(
  items: ContentItem[],
  playsMap: Map<number, number>,
): GenreAffinity {
  const raw: Record<number, number> = {};
  let total = 0;
  for (const item of items) {
    const plays = Math.max(playsMap.get(item.id) ?? 1, 1);
    for (const genreId of item.genres ?? []) {
      raw[genreId] = (raw[genreId] ?? 0) + plays;
      total += plays;
    }
  }
  if (total === 0) return {};
  const affinity: GenreAffinity = {};
  for (const [id, w] of Object.entries(raw)) {
    affinity[Number(id)] = w / total;
  }
  return affinity;
}

// ─── Taste Modes ─────────────────────────────────────────────────────────────

export type TasteMode =
  | 'comfort'
  | 'discovery'
  | 'prestige'
  | 'blockbuster'
  | 'late-night'
  | 'emotionally-heavy';

export interface TasteModeConfig {
  icon: string;
  label: string;
  desc: string;
  color: string;
}

export const TASTE_MODE_CONFIG: Record<TasteMode, TasteModeConfig> = {
  comfort:            { icon: '🛋',  label: 'Comfort Mode',    desc: 'Familiar favourites and easy watching',           color: '#60A5FA' },
  discovery:          { icon: '🔍',  label: 'Discovery Mode',  desc: 'Exploring new genres and fresh territory',        color: '#34D399' },
  prestige:           { icon: '✦',   label: 'Prestige Mode',   desc: 'Critically acclaimed and award-winning',          color: '#F59E0B' },
  blockbuster:        { icon: '⚡',  label: 'Blockbuster Mode',desc: 'High-energy, crowd-pleasing entertainment',       color: '#F97316' },
  'late-night':       { icon: '🌙',  label: 'Late Night',      desc: 'Atmospheric, moody and after-dark',               color: '#818CF8' },
  'emotionally-heavy':{ icon: '🎭', label: 'Emotional Mode',  desc: 'Dark, intense and thought-provoking',             color: '#EC4899' },
};

const VALID_MODES = Object.keys(TASTE_MODE_CONFIG) as TasteMode[];

// Deterministic TasteMode from genre affinity — no Gemini call needed
export function inferTasteMode(
  affinity: GenreAffinity,
  temporal: TemporalContext,
  hasRewatches = false,
): TasteMode {
  if (temporal.timeOfDay === 'late-night') return 'late-night';
  if (Object.keys(affinity).length === 0) return 'discovery';

  const drama     = affinity[18] ?? 0;
  const action    = affinity[28] ?? 0;
  const adventure = affinity[12] ?? 0;
  const fantasy   = affinity[14] ?? 0;
  const thriller  = affinity[53] ?? 0;
  const crime     = affinity[80] ?? 0;
  const horror    = affinity[27] ?? 0;
  const comedy    = affinity[35] ?? 0;

  const blockbusterScore = action + adventure + fantasy;
  const darkScore = thriller + crime + horror;
  const topScore = Math.max(...Object.values(affinity));
  const genreCount = Object.keys(affinity).length;

  if (drama > 0.4 || (drama > 0.28 && temporal.specialPeriod?.includes('awards'))) return 'prestige';
  if (darkScore > 0.42) return 'emotionally-heavy';
  if (blockbusterScore > 0.45) return 'blockbuster';
  if (hasRewatches && (comedy > 0.2 || topScore < 0.22)) return 'comfort';
  if (genreCount >= 5 && topScore < 0.24) return 'discovery';
  if (drama > 0.24) return 'prestige';
  return 'discovery';
}

// ─── Page determinism ─────────────────────────────────────────────────────────

// Returns page 1–3. Stable within a 6h block, different across blocks and rows.
export function deterministicPage(dateKey: string, rowIndex: number): number {
  const seed = dateKey.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return ((seed + rowIndex * 7) % 3) + 1;
}

// ─── Item-level cooldowns (7-day suppression) ────────────────────────────────

const COOLDOWN_KEY = 'item_cooldowns_v1';
const COOLDOWN_DAYS = 7;
const COOLDOWN_MAX = 500;

interface ItemCooldownRecord { id: number; at: number }

export async function loadItemCooldowns(): Promise<Set<number>> {
  try {
    const raw = await AsyncStorage.getItem(COOLDOWN_KEY);
    if (!raw) return new Set();
    const records: ItemCooldownRecord[] = JSON.parse(raw);
    const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    return new Set(records.filter(r => r.at > cutoff).map(r => r.id));
  } catch { return new Set(); }
}

export async function saveItemCooldowns(tmdbIds: number[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(COOLDOWN_KEY);
    const existing: ItemCooldownRecord[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const active = existing.filter(r => r.at > cutoff);
    const newEntries: ItemCooldownRecord[] = tmdbIds.map(id => ({ id, at: Date.now() }));
    const merged = [...newEntries, ...active]
      .filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
      .slice(0, COOLDOWN_MAX);
    await AsyncStorage.setItem(COOLDOWN_KEY, JSON.stringify(merged));
  } catch {}
}

// ─── Recent row tracker (AsyncStorage) ───────────────────────────────────────

const RECENT_ROWS_KEY = 'recent_row_titles_v1';
const RECENT_ROWS_MAX = 20;

interface RowRecord { title: string; shownAt: number }

export async function loadRecentRowTitles(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_ROWS_KEY);
    if (!raw) return [];
    const records: RowRecord[] = JSON.parse(raw);
    return records.sort((a, b) => b.shownAt - a.shownAt).slice(0, 12).map(r => r.title);
  } catch { return []; }
}

export async function saveShownRowTitles(titles: string[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_ROWS_KEY);
    const existing: RowRecord[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const merged = [...titles.map(title => ({ title, shownAt: now })), ...existing]
      .filter((r, i, arr) => arr.findIndex(x => x.title === r.title) === i)
      .slice(0, RECENT_ROWS_MAX);
    await AsyncStorage.setItem(RECENT_ROWS_KEY, JSON.stringify(merged));
  } catch {}
}

// ─── AI chat cross-session memory (AsyncStorage) ─────────────────────────────

const AI_SEEN_TITLES_KEY = 'ai_seen_titles_v1';
const AI_SEEN_TITLES_MAX = 60;

export async function loadAiSeenTitles(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(AI_SEEN_TITLES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveAiSeenTitles(newTitles: string[], existing: string[]): Promise<void> {
  try {
    const merged = [...new Set([...newTitles, ...existing])].slice(0, AI_SEEN_TITLES_MAX);
    await AsyncStorage.setItem(AI_SEEN_TITLES_KEY, JSON.stringify(merged));
  } catch {}
}

// ─── Supabase DNA persistence ─────────────────────────────────────────────────

export async function loadDNAFromCloud(userId: string): Promise<TasteDNA | null> {
  try {
    const { data, error } = await supabase
      .from('taste_dna')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    const row = data as any;
    return {
      tasteProfile: row.taste_profile ?? '',
      tasteMode: (VALID_MODES.includes(row.taste_mode) ? row.taste_mode : 'discovery') as TasteMode,
      rows: (row.rows ?? []) as ThematicRow[],
      fingerprint: row.fingerprint ?? '',
      generatedAt: new Date(row.generated_at).getTime(),
      genreAffinity: row.genre_affinity ?? {},
    };
  } catch { return null; }
}

export async function saveDNAToCloud(userId: string, dna: TasteDNA): Promise<void> {
  try {
    await supabase.from('taste_dna').upsert({
      user_id: userId,
      taste_profile: dna.tasteProfile,
      taste_mode: dna.tasteMode,
      rows: dna.rows as unknown as Database['public']['Tables']['taste_dna']['Insert']['rows'],
      fingerprint: dna.fingerprint,
      genre_affinity: (dna.genreAffinity ?? {}) as unknown as Database['public']['Tables']['taste_dna']['Insert']['genre_affinity'],
      generated_at: new Date(dna.generatedAt).toISOString(),
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'user_id' });
  } catch {}
}

// ─── Supabase shown row persistence ──────────────────────────────────────────

export async function loadShownRowsFromCloud(userId: string): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('shown_rows')
      .select('row_title')
      .eq('user_id', userId)
      .order('shown_at', { ascending: false })
      .limit(20);
    return ((data ?? []) as any[]).map(r => String(r.row_title));
  } catch { return []; }
}

export async function saveShownRowsToCloud(userId: string, titles: string[]): Promise<void> {
  try {
    await supabase.from('shown_rows').insert(
      titles.map(row_title => ({ user_id: userId, row_title })) as any
    );
  } catch {}
}

// ─── Supabase AI conversation persistence ─────────────────────────────────────

export async function loadLatestAiSummary(
  userId: string
): Promise<{ summary: string; titles: string[] } | null> {
  try {
    const { data } = await (supabase
      .from('ai_conversations')
      .select('summary, titles_mentioned')
      .eq('user_id', userId)
      .order('session_at', { ascending: false })
      .limit(1)
      .single() as any);
    if (!data) return null;
    return { summary: (data as any).summary, titles: (data as any).titles_mentioned ?? [] };
  } catch { return null; }
}

export async function saveAiConversationToCloud(
  userId: string,
  summary: string,
  titles: string[],
): Promise<void> {
  try {
    await supabase.from('ai_conversations').insert({
      user_id: userId,
      summary,
      titles_mentioned: titles,
    } as any);
  } catch {}
}

// ─── DNA storage (AsyncStorage) ───────────────────────────────────────────────

const STORAGE_KEY = 'tasteDNA_v4';

export interface ThematicRow {
  title: string;
  subtitle: string;
  type: 'movie' | 'tv';
  genreIds: number[];
  sortBy: string;
  voteAverageGte: number;
  voteCountGte: number;
  releaseDateGte?: string;
  releaseDateLte?: string;
}

export interface TasteDNA {
  tasteProfile: string;
  tasteMode: TasteMode;
  rows: ThematicRow[];
  fingerprint: string;
  generatedAt: number;
  genreAffinity?: GenreAffinity;
}

// Fingerprint includes 6h dateKey so cache rotates automatically with time-of-day
export function computeFingerprint(
  movies: TraktWatchedMovie[],
  shows: TraktWatchedShow[],
  temporal: TemporalContext,
): string {
  const movieIds = [...movies]
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 15).map(m => m.movie.ids.tmdb ?? 0).join(',');
  const showIds = [...shows]
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 10).map(s => s.show.ids.tmdb ?? 0).join(',');
  return `${movieIds}|${showIds}|${temporal.dateKey}`;
}

export async function loadCachedDNA(fingerprint: string): Promise<TasteDNA | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached: TasteDNA = JSON.parse(raw);
    if (cached.fingerprint !== fingerprint) return null;
    return cached;
  } catch { return null; }
}

export async function saveDNA(dna: TasteDNA): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dna));
  } catch {}
}

// ─── Fallback editorial rows (temporal-aware) ─────────────────────────────────

function getEditorialRows(temporal: TemporalContext): ThematicRow[] {
  const base: ThematicRow[] = [
    {
      title: 'Modern Crime Masterpieces',
      subtitle: 'Dark, gripping films with real moral weight',
      type: 'movie', genreIds: [80, 53],
      sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 2000,
      releaseDateGte: '2000-01-01',
    },
    {
      title: 'Prestige Drama Worth Obsessing Over',
      subtitle: 'Acclaimed series that demand your full attention',
      type: 'tv', genreIds: [18],
      sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 1000,
      releaseDateGte: '2010-01-01',
    },
    {
      title: 'Intelligent Science Fiction',
      subtitle: 'Ideas-first sci-fi with serious craft behind it',
      type: 'movie', genreIds: [878],
      sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 1500,
    },
    {
      title: 'Cerebral Mystery Series',
      subtitle: 'Slow-burn investigations that hold you completely',
      type: 'tv', genreIds: [9648, 80],
      sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 500,
    },
  ];

  if (temporal.specialPeriod?.includes('Halloween')) {
    base.push({
      title: 'Elevated Horror Cinema',
      subtitle: 'Frightening films with real craft and ideas behind them',
      type: 'movie', genreIds: [27, 53],
      sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 1000,
    });
  } else if (temporal.specialPeriod?.includes('awards')) {
    base.push({
      title: 'Awards Season Favourites',
      subtitle: 'The films critics and academies are talking about',
      type: 'movie', genreIds: [18],
      sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 2000,
      releaseDateGte: `${new Date().getFullYear() - 1}-01-01`,
    });
  } else if (temporal.timeOfDay === 'late-night') {
    base.push({
      title: 'Late Night Atmospheric Cinema',
      subtitle: 'Moody, atmospheric films best watched after midnight',
      type: 'movie', genreIds: [53, 27, 9648],
      sortBy: 'vote_average.desc', voteAverageGte: 7.0, voteCountGte: 500,
    });
  } else if (temporal.dayType === 'weekend' && temporal.timeOfDay === 'evening') {
    base.push({
      title: 'Weekend Prestige Television',
      subtitle: 'Series worth committing your evening to',
      type: 'tv', genreIds: [18, 80],
      sortBy: 'vote_average.desc', voteAverageGte: 8.0, voteCountGte: 500,
    });
  } else {
    base.push({
      title: 'Essential Thriller Cinema',
      subtitle: 'Tense, intelligent films that hold you to the last frame',
      type: 'movie', genreIds: [53, 18],
      sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 1500,
    });
  }

  return base;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const MODEL_CASCADE = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
] as const;

function buildDNAPrompt(
  recentMovies: string,
  recentShows: string,
  hasHistory: boolean,
  temporal: TemporalContext,
  recentRowTitles: string[],
  genreAffinity: GenreAffinity,
  precomputedMode: TasteMode,
): string {
  const historySection = hasHistory
    ? `MOVIES WATCHED (sorted by play-count × recency, plays noted where > 1):
${recentMovies || 'none'}

TV SHOWS WATCHED (sorted by play-count × recency):
${recentShows || 'none'}`
    : 'No watch history yet — generate editorial picks.';

  const affinityLines = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([id, w]) => `  ${GENRE_NAMES[Number(id)] ?? `Genre ${id}`}: ${Math.round(w * 100)}%`)
    .join('\n');

  const affinitySection = affinityLines
    ? `GENRE AFFINITY (play-weighted from viewing history):\n${affinityLines}`
    : '';

  const modeSection = `TASTE MODE (deterministically computed from genre affinity): "${precomputedMode}"
${precomputedMode === 'late-night' ? 'This is a temporal override — you MUST return tasteMode "late-night".' : 'Confirm this mode or choose a more fitting one if the history clearly suggests otherwise.'}`;

  const temporalSection = `CURRENT CONTEXT: ${temporal.description}${temporal.specialPeriod ? ` — ${temporal.specialPeriod}` : ''}`;

  const avoidSection = recentRowTitles.length > 0
    ? `ROW THEMES RECENTLY SHOWN — avoid these and any closely similar themes:\n${recentRowTitles.map(t => `• "${t}"`).join('\n')}`
    : '';

  const taskLine = hasHistory
    ? "Analyse this viewer's cinematic identity — genre affinity, tone, pacing, prestige vs mainstream, era — then generate exactly 5 discovery rows."
    : 'Generate exactly 5 editorial discovery rows across the best of cinema and television.';

  return `You are a world-class cinematic curator for a premium discovery app.

${historySection}

${affinitySection}

${modeSection}

${temporalSection}

${avoidSection}

TMDB genre IDs — Movies: 28=Action, 12=Adventure, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 14=Fantasy, 27=Horror, 9648=Mystery, 10749=Romance, 878=Science Fiction, 53=Thriller, 37=Western
TMDB genre IDs — TV: 10759=Action & Adventure, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 9648=Mystery, 10765=Sci-Fi & Fantasy, 10768=War & Politics, 37=Western

${taskLine}

STRUCTURE — exactly this mix:
• 2 ANCHOR rows: the viewer's stable core cinematic DNA
• 2 CONTEXTUAL rows: respond to the current context (${temporal.description})
• 1 EXPLORATORY row: an adjacent discovery the viewer would love but hasn't settled into

RULES:
- Row titles must be DIFFERENT from the avoided list above
- No generic titles ("Drama Shows", "Top Movies") — every title must feel like an editorial collection
- Contextual rows must be earned by the moment, not arbitrary

ROW FORMAT:
- title: specific and cinematic ("Quietly Devastating Prestige Drama", "Late Night Atmospheric Crime")
- subtitle: one evocative sentence about the feeling of this row
- type: "movie" or "tv"
- genreIds: 1–3 TMDB IDs
- sortBy: "vote_average.desc" for quality | "popularity.desc" for cultural moment | "primary_release_date.desc" for freshness
- voteAverageGte: 8.0 prestige, 7.5 strong, 7.0 discovery
- voteCountGte: ≥1000 movies, ≥300 TV
- releaseDateGte/releaseDateLte: only include when era is specifically relevant

tasteProfile: one sentence, second person ("You gravitate toward...")
tasteMode: one of ${VALID_MODES.join(', ')}

Output ONLY valid JSON — no markdown, no explanation:
{"tasteProfile":"...","tasteMode":"prestige","rows":[{"title":"...","subtitle":"...","type":"movie","genreIds":[18,53],"sortBy":"vote_average.desc","voteAverageGte":7.5,"voteCountGte":1000}]}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

// 90-day recency half-life — items watched recently count more
function recencyWeight(lastWatchedAt: string): number {
  const days = (Date.now() - new Date(lastWatchedAt).getTime()) / 86400000;
  return Math.exp(-days / 90);
}

export async function generateTasteDNA(
  apiKey: string,
  movies: TraktWatchedMovie[],
  shows: TraktWatchedShow[],
  temporal: TemporalContext,
  recentRowTitles: string[] = [],
  genreAffinity: GenreAffinity = {},
  playsMap: Map<number, number> = new Map(),
): Promise<TasteDNA> {
  const fingerprint = computeFingerprint(movies, shows, temporal);

  // Sort by play-count × recency — rewatches and recent watches rank highest
  const sortedMovies = [...movies]
    .map(m => ({ ...m, _score: m.plays * recencyWeight(m.last_watched_at) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 40);

  const sortedShows = [...shows]
    .map(s => ({ ...s, _score: s.plays * recencyWeight(s.last_watched_at) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 30);

  const recentMovies = sortedMovies
    .map(m => m.plays > 1 ? `${m.movie.title} (${m.movie.year}) [${m.plays}×]` : `${m.movie.title} (${m.movie.year})`)
    .join(', ');

  const recentShows = sortedShows
    .map(s => s.plays > 1 ? `${s.show.title} (${s.show.year}) [${s.plays}×]` : `${s.show.title} (${s.show.year})`)
    .join(', ');

  const hasHistory = !!(recentMovies || recentShows);
  const hasRewatches = movies.some(m => m.plays > 1) || shows.some(s => s.plays > 1);
  const precomputedMode = inferTasteMode(genreAffinity, temporal, hasRewatches);

  const prompt = buildDNAPrompt(
    recentMovies, recentShows, hasHistory, temporal,
    recentRowTitles, genreAffinity, precomputedMode,
  );

  const key = apiKey.trim().replace(/[\n\r\t]/g, '');
  const genAI = new GoogleGenerativeAI(key);

  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const modelId = MODEL_CASCADE[i];
    try {
      console.log(`[TasteDNA] Trying ${modelId} (${temporal.description})`);
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const first = stripped.indexOf('{');
      const last = stripped.lastIndexOf('}');
      if (first === -1 || last <= first) throw new Error('No JSON block');
      const parsed = JSON.parse(stripped.slice(first, last + 1));
      if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) throw new Error('Empty rows');

      const rows: ThematicRow[] = parsed.rows
        .filter((r: any) => r.title && r.type && Array.isArray(r.genreIds))
        .slice(0, 5)
        .map((r: any): ThematicRow => ({
          title: String(r.title),
          subtitle: String(r.subtitle ?? ''),
          type: r.type === 'tv' ? 'tv' : 'movie',
          genreIds: (r.genreIds as any[]).filter(id => typeof id === 'number'),
          sortBy: String(r.sortBy ?? 'vote_average.desc'),
          voteAverageGte: Number(r.voteAverageGte ?? 7.0),
          voteCountGte: Number(r.voteCountGte ?? 500),
          ...(r.releaseDateGte && { releaseDateGte: String(r.releaseDateGte) }),
          ...(r.releaseDateLte && { releaseDateLte: String(r.releaseDateLte) }),
        }));

      // Gemini confirms or adjusts mode; late-night temporal always wins
      let tasteMode: TasteMode = VALID_MODES.includes(parsed.tasteMode)
        ? parsed.tasteMode as TasteMode
        : precomputedMode;
      if (temporal.timeOfDay === 'late-night') tasteMode = 'late-night';

      console.log(`[TasteDNA] ${rows.length} rows via ${modelId}, mode=${tasteMode}`);
      return {
        tasteProfile: String(parsed.tasteProfile ?? ''),
        tasteMode,
        rows,
        fingerprint,
        generatedAt: Date.now(),
        genreAffinity,
      };
    } catch (e) {
      console.warn(`[TasteDNA] ${modelId} failed:`, String((e as any)?.message ?? '').slice(0, 100));
      if (i < MODEL_CASCADE.length - 1) continue;
    }
  }

  console.warn('[TasteDNA] All models failed — editorial fallback');
  return {
    tasteProfile: '',
    tasteMode: precomputedMode,
    rows: getEditorialRows(temporal),
    fingerprint,
    generatedAt: Date.now(),
    genreAffinity,
  };
}

// ─── Type import helper (avoid circular dependency on supabase.ts Database) ───
type Database = import('./supabase').Database;
