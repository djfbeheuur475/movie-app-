import AsyncStorage from '@react-native-async-storage/async-storage';
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

export const GENRE_NAMES: Record<number, string> = {
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
const COOLDOWN_DAYS = 3;
const COOLDOWN_MAX = 200;

interface ItemCooldownRecord { id: number; at: number }

async function loadItemCooldownsFromCloud(userId: string): Promise<number[]> {
  try {
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('item_cooldowns')
      .select('tmdb_id')
      .eq('user_id', userId)
      .gte('surfaced_at', cutoff);
    return ((data ?? []) as any[]).map(r => Number(r.tmdb_id));
  } catch { return []; }
}

async function saveItemCooldownsToCloud(userId: string, tmdbIds: number[]): Promise<void> {
  if (!tmdbIds.length) return;
  try {
    await supabase.from('item_cooldowns').upsert(
      tmdbIds.map(tmdb_id => ({ user_id: userId, tmdb_id })) as any,
      { onConflict: 'user_id,tmdb_id' }
    );
    // Prune expired records from cloud (non-blocking cleanup)
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('item_cooldowns').delete()
      .eq('user_id', userId).lt('surfaced_at', cutoff).then(() => {});
  } catch {}
}

export async function loadItemCooldowns(userId?: string | null): Promise<Set<number>> {
  try {
    const raw = await AsyncStorage.getItem(COOLDOWN_KEY);
    const records: ItemCooldownRecord[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const localIds = records.filter(r => r.at > cutoff).map(r => r.id);
    if (userId) {
      const cloudIds = await loadItemCooldownsFromCloud(userId);
      return new Set([...localIds, ...cloudIds]);
    }
    return new Set(localIds);
  } catch { return new Set(); }
}

export async function saveItemCooldowns(tmdbIds: number[], userId?: string | null): Promise<void> {
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
    if (userId) saveItemCooldownsToCloud(userId, tmdbIds); // non-blocking
  } catch {}
}

// ─── TMDB Discover result caching ────────────────────────────────────────────
// Discover calls are fully deterministic given the same params + page. Cache for 6h.

const DISCOVER_CACHE_PREFIX = 'discover_v1_';
const DISCOVER_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

function discoverCacheKey(params: Record<string, unknown>): string {
  const str = JSON.stringify(params, Object.keys(params).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return `${DISCOVER_CACHE_PREFIX}${h}`;
}

export async function loadDiscoverCache(params: Record<string, unknown>): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(discoverCacheKey(params));
    if (!raw) return null;
    const { ts, items } = JSON.parse(raw);
    if (Date.now() - ts > DISCOVER_CACHE_TTL) return null;
    return items;
  } catch { return null; }
}

export async function saveDiscoverCache(params: Record<string, unknown>, items: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(discoverCacheKey(params), JSON.stringify({ ts: Date.now(), items }));
  } catch {}
}

// ─── Recent row tracker (AsyncStorage) ───────────────────────────────────────

const RECENT_ROWS_KEY = 'recent_row_titles_v2';
const RECENT_ROWS_MAX = 15;
const RECENT_ROWS_TTL = 24 * 60 * 60 * 1000; // 24 hours — rows reset daily

interface RowRecord { title: string; shownAt: number }

export async function loadRecentRowTitles(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_ROWS_KEY);
    if (!raw) return [];
    const records: RowRecord[] = JSON.parse(raw);
    const cutoff = Date.now() - RECENT_ROWS_TTL;
    return records
      .filter(r => r.shownAt > cutoff)
      .sort((a, b) => b.shownAt - a.shownAt)
      .map(r => r.title);
  } catch { return []; }
}

export async function saveShownRowTitles(titles: string[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_ROWS_KEY);
    const existing: RowRecord[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - RECENT_ROWS_TTL;
    const now = Date.now();
    const merged = [...titles.map(title => ({ title, shownAt: now })), ...existing.filter(r => r.shownAt > cutoff)]
      .filter((r, i, arr) => arr.findIndex(x => x.title === r.title) === i)
      .slice(0, RECENT_ROWS_MAX);
    await AsyncStorage.setItem(RECENT_ROWS_KEY, JSON.stringify(merged));
  } catch {}
}

export async function clearRecommendationCache(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(COOLDOWN_KEY),
    AsyncStorage.removeItem(RECENT_ROWS_KEY),
  ]);
}

// ─── AI chat cross-session memory ─────────────────────────────────────────────

const AI_SEEN_TITLES_KEY = 'ai_seen_titles_v1';
const AI_SEEN_TITLES_MAX = 60;

export async function loadAiSeenTitles(userId?: string | null): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(AI_SEEN_TITLES_KEY);
    const local: string[] = raw ? JSON.parse(raw) : [];
    if (!userId) return local;

    // Pull titles from all cloud AI conversations and merge — cross-device memory
    const { data } = await supabase
      .from('ai_conversations')
      .select('titles_mentioned')
      .eq('user_id', userId)
      .order('session_at', { ascending: false })
      .limit(10) as any;
    const cloudTitles: string[] = ((data ?? []) as any[])
      .flatMap(r => (r.titles_mentioned as string[]) ?? []);

    const merged = [...new Set([...local, ...cloudTitles])].slice(0, AI_SEEN_TITLES_MAX);
    // Write merged back to local so next load is fast
    AsyncStorage.setItem(AI_SEEN_TITLES_KEY, JSON.stringify(merged)).catch(() => {});
    return merged;
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
    const meta = row.profile_metadata ?? {};
    return {
      tasteProfile: row.taste_profile ?? '',
      tasteMode: (VALID_MODES.includes(row.taste_mode) ? row.taste_mode : 'discovery') as TasteMode,
      rows: (row.rows ?? []) as ThematicRow[],
      fingerprint: row.fingerprint ?? '',
      generatedAt: new Date(row.generated_at).getTime(),
      genreAffinity: row.genre_affinity ?? {},
      profile: meta.profile ?? undefined,
      thematicInterests: meta.thematicInterests ?? [],
      recentShift: meta.recentShift ?? null,
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
      profile_metadata: {
        profile: dna.profile ?? null,
        thematicInterests: dna.thematicInterests ?? [],
        recentShift: dna.recentShift ?? null,
      },
    } as any, { onConflict: 'user_id' });
  } catch {}
}

// ─── Supabase shown row persistence ──────────────────────────────────────────

export async function loadShownRowsFromCloud(userId: string): Promise<string[]> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('shown_rows')
      .select('row_title')
      .eq('user_id', userId)
      .gte('shown_at', cutoff)
      .order('shown_at', { ascending: false })
      .limit(15);
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

const STORAGE_KEY = 'tasteDNA_v7';
const DNA_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — DNA regens only when content changes or stale

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
  runtimeGte?: number;      // pacing proxy: min runtime in minutes (movies only)
  runtimeLte?: number;      // pacing proxy: max runtime in minutes (movies only)
  originCountry?: string;    // ISO 3166-1 alpha-2, e.g. 'GB', 'US' — filters by production country
  excludeGenres?: number[];  // genre IDs to exclude (TMDB without_genres param)
  withKeywords?: string;     // TMDB keyword IDs, pipe-separated for OR logic e.g. '10683|5734'
}

// ─── Extended taste profile (computed deterministically from metadata) ────────

export interface TasteProfile {
  dominantGenres: number[];
  avoidedGenres: number[];
  darknessScore: number;      // 0–1: crime + thriller + horror affinity
  prestigeScore: number;      // 0–1: drama + high-rating affinity
  indieAffinity: number;      // 0–1: proportion of low-popularity watches
  noveltyTolerance: number;   // 0–1: proportion of low-vote-count watches
  pacingPreference: 'slow' | 'medium' | 'fast';
  eraAffinity: { classic: number; nineties: number; modern: number };
  emotionalProfile: string[]; // e.g. ['dark', 'cerebral', 'adventurous']
}

export function computeTasteProfile(
  items: ContentItem[],
  playsMap: Map<number, number>,
  genreAffinity: GenreAffinity,
): TasteProfile {
  const dominantGenres = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a).slice(0, 4).map(([id]) => Number(id));

  const avoidedGenres = Object.entries(genreAffinity)
    .filter(([, w]) => w < 0.05).map(([id]) => Number(id));

  const darknessScore = Math.min(1,
    ((genreAffinity[80] ?? 0) + (genreAffinity[53] ?? 0) +
     (genreAffinity[27] ?? 0) + (genreAffinity[9648] ?? 0)) * 1.4);

  const avgRating = items.length > 0
    ? items.reduce((s, i) => s + (i.rating ?? 0), 0) / items.length : 7.0;
  const prestigeScore = Math.min(1,
    (genreAffinity[18] ?? 0) * 1.8 + Math.max(0, (avgRating - 6.5) / 3.5) * 0.3);

  const n = items.length;
  const indieAffinity = n > 0 ? items.filter(i => (i.voteCount ?? 0) < 5000).length / n : 0.3;
  const noveltyTolerance = n > 0 ? items.filter(i => (i.voteCount ?? 0) < 2000).length / n : 0.3;

  const fastGenres = [28, 12, 53, 14, 878, 10759];
  const slowGenres = [18, 9648, 99, 36, 10768];
  const fastScore = fastGenres.reduce((s, g) => s + (genreAffinity[g] ?? 0), 0);
  const slowScore = slowGenres.reduce((s, g) => s + (genreAffinity[g] ?? 0), 0);
  const pacingPreference: 'slow' | 'medium' | 'fast' =
    fastScore > slowScore * 1.6 ? 'fast' :
    slowScore > fastScore * 1.6 ? 'slow' : 'medium';

  let classicW = 0, ninetiesW = 0, modernW = 0, eraTotal = 0;
  for (const item of items) {
    const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : NaN;
    if (isNaN(year)) continue;
    const w = playsMap.get(item.id) ?? 1;
    eraTotal += w;
    if (year < 1990) classicW += w;
    else if (year < 2000) ninetiesW += w;
    else modernW += w;
  }
  const eraAffinity = eraTotal > 0
    ? { classic: classicW / eraTotal, nineties: ninetiesW / eraTotal, modern: modernW / eraTotal }
    : { classic: 0.1, nineties: 0.15, modern: 0.75 };

  const emotionalProfile: string[] = [];
  if (darknessScore > 0.45) emotionalProfile.push('dark');
  if (prestigeScore > 0.5) emotionalProfile.push('cerebral');
  if ((genreAffinity[35] ?? 0) > 0.2) emotionalProfile.push('playful');
  if ((genreAffinity[10749] ?? 0) > 0.18) emotionalProfile.push('romantic');
  if ((genreAffinity[27] ?? 0) > 0.18) emotionalProfile.push('thrill-seeking');
  if (indieAffinity > 0.5) emotionalProfile.push('adventurous');
  if ((genreAffinity[99] ?? 0) > 0.12) emotionalProfile.push('intellectually curious');
  if (eraAffinity.classic > 0.25) emotionalProfile.push('classicist');
  if (emotionalProfile.length === 0) emotionalProfile.push('discerning');

  return {
    dominantGenres, avoidedGenres, darknessScore, prestigeScore,
    indieAffinity, noveltyTolerance, pacingPreference, eraAffinity, emotionalProfile,
  };
}

export interface TasteDNA {
  tasteProfile: string;
  tasteMode: TasteMode;
  rows: ThematicRow[];
  fingerprint: string;       // content-only (no dateKey) — Gemini regen gated on content changes
  generatedAt: number;
  genreAffinity?: GenreAffinity;
  profile?: TasteProfile;           // extended dimensions, computed deterministically
  thematicInterests?: string[];     // Gemini-generated thematic labels
  recentShift?: string | null;      // Gemini-detected recent taste shift
}

// Content fingerprint — drives DNA regen gate (no dateKey: same content = same DNA)
export function computeContentFingerprint(
  movies: TraktWatchedMovie[],
  shows: TraktWatchedShow[],
): string {
  const movieIds = [...movies]
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 30).map(m => m.movie.ids.tmdb ?? 0).join(',');
  const showIds = [...shows]
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 20).map(s => s.show.ids.tmdb ?? 0).join(',');
  return `${movieIds}|${showIds}`;
}

// Temporal fingerprint — used for React Query cache key (drives 6h UI refresh)
export function computeFingerprint(
  movies: TraktWatchedMovie[],
  shows: TraktWatchedShow[],
  temporal: TemporalContext,
): string {
  return `${computeContentFingerprint(movies, shows)}|${temporal.dateKey}`;
}

// Load DNA if content fingerprint matches and it's not stale (24h max)
export async function loadCachedDNA(contentFingerprint: string): Promise<TasteDNA | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached: TasteDNA = JSON.parse(raw);
    if (cached.fingerprint !== contentFingerprint) return null;
    if (!Array.isArray(cached.rows) || cached.rows.length === 0) return null;
    if (Date.now() - (cached.generatedAt ?? 0) > DNA_MAX_AGE_MS) return null;
    return cached;
  } catch { return null; }
}

// Load whatever DNA is cached — for AI tab context (no fingerprint requirement)
// Falls back to profile snapshot written by the deterministic template system.
export async function loadCachedAnyDNA(): Promise<TasteDNA | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TasteDNA;

    // Fallback: profile snapshot written by template selector (no Gemini DNA present)
    const snapRaw = await AsyncStorage.getItem(PROFILE_SNAPSHOT_KEY);
    if (!snapRaw) return null;
    const snap = JSON.parse(snapRaw) as import('./templateSelector').ProfileSnapshot;
    return {
      tasteProfile: snap.tasteProfile,
      tasteMode: snap.tasteMode,
      rows: [],
      fingerprint: snap.fingerprint,
      generatedAt: snap.savedAt,
      genreAffinity: snap.genreAffinity,
      profile: snap.profile,
      thematicInterests: [],
      recentShift: null,
    };
  } catch { return null; }
}

const PROFILE_SNAPSHOT_KEY = 'profileSnapshot_v1';

export async function saveProfileSnapshot(
  snap: import('./templateSelector').ProfileSnapshot,
): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {}
}

export async function loadProfileSnapshot(): Promise<import('./templateSelector').ProfileSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function saveDNA(dna: TasteDNA): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dna));
  } catch {}
}

// ─── Taste neighborhood cache ─────────────────────────────────────────────────
// TMDB recommendation IDs for the user's top-played items — behavioural adjacency signal.
// Cached 24h so we don't fire 5 extra API calls on every 6h row rotation.

const NEIGHBORHOOD_KEY = 'tasteNeighborhood_v1';
const NEIGHBORHOOD_TTL = 24 * 60 * 60 * 1000;

export async function loadTasteNeighborhood(): Promise<Set<number> | null> {
  try {
    const raw = await AsyncStorage.getItem(NEIGHBORHOOD_KEY);
    if (!raw) return null;
    const { ts, ids } = JSON.parse(raw);
    if (Date.now() - ts > NEIGHBORHOOD_TTL) return null;
    return new Set(ids as number[]);
  } catch { return null; }
}

export async function saveTasteNeighborhood(ids: number[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NEIGHBORHOOD_KEY, JSON.stringify({ ts: Date.now(), ids }));
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

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DNA_FALLBACK_MODEL = 'qwen/qwen3-14b';

function buildDNAPrompt(
  recentMovies: string,
  recentShows: string,
  hasHistory: boolean,
  temporal: TemporalContext,
  recentRowTitles: string[],
  genreAffinity: GenreAffinity,
  precomputedMode: TasteMode,
  profile?: TasteProfile,
  recentMoviesOnly?: string, // last 10 items for recency shift detection
): string {
  const historySection = hasHistory
    ? `FULL WATCH HISTORY (sorted by play-count × recency; plays noted where > 1):
Movies: ${recentMovies || 'none'}
TV Shows: ${recentShows || 'none'}`
    : 'No watch history yet — generate editorial picks.';

  const affinityLines = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([id, w]) => `  ${GENRE_NAMES[Number(id)] ?? `Genre ${id}`}: ${Math.round(w * 100)}%`)
    .join('\n');
  const affinitySection = affinityLines
    ? `GENRE AFFINITY (play-weighted from full history):\n${affinityLines}` : '';

  const profileSection = profile ? `COMPUTED TASTE DIMENSIONS (deterministic, do not contradict):
  Pacing: ${profile.pacingPreference}
  Darkness: ${Math.round(profile.darknessScore * 100)}% (0=light, 100=intense/dark)
  Prestige: ${Math.round(profile.prestigeScore * 100)}% (0=mainstream, 100=critically acclaimed)
  Indie affinity: ${Math.round(profile.indieAffinity * 100)}% (watches lesser-seen content)
  Novelty tolerance: ${Math.round(profile.noveltyTolerance * 100)}%
  Era preference: ${Object.entries(profile.eraAffinity).sort(([,a],[,b]) => b-a)[0][0]} (classic=pre-1990, nineties=1990–99, modern=2000+)
  Emotional register: ${profile.emotionalProfile.join(', ')}` : '';

  const recentShiftSection = recentMoviesOnly && hasHistory
    ? `RECENT VIEWING (last 10, most recent first — use for recency-shift detection):
${recentMoviesOnly}` : '';

  const modeSection = `TASTE MODE (pre-computed): "${precomputedMode}"
${precomputedMode === 'late-night' ? 'Temporal override — MUST return tasteMode "late-night".' : 'Confirm or refine based on the full history.'}`;

  const temporalSection = `CONTEXT: ${temporal.description}${temporal.specialPeriod ? ` — ${temporal.specialPeriod}` : ''}`;

  const avoidSection = recentRowTitles.length > 0
    ? `RECENTLY SHOWN THEMES — avoid these and closely similar:\n${recentRowTitles.map(t => `• "${t}"`).join('\n')}` : '';

  const taskLine = hasHistory
    ? "Analyse this viewer's cinematic identity and generate exactly 5 discovery rows."
    : 'Generate exactly 5 editorial discovery rows.';

  const editorialGuidance = `ROW NAMING — PREMIUM EDITORIAL STANDARD:
Titles must read like sections from Sight & Sound, Criterion, or a top film festival programme.
Think: thematic, specific, atmospheric. Never genre labels.

GOOD: "Moral Labyrinths: Slow-Burn Crime" | "Prestige Sci-Fi That Lingers" | "Neo-Noir Essentials"
      "Quiet Devastation: Arthouse Drama" | "Modern Cannes Breakouts" | "The Paranoid Thriller"
      "Critics' Dark Obsessions" | "Auteur Cinema: Control & Chaos" | "Anatomy of Obsession"
      "Late-Night Cerebral Thrillers" | "New Hollywood Revisited" | "The Slow Revelation"

BAD (reject): "Drama Movies" | "Action Films" | "Thriller Shows" | "Popular Crime" | "Top Rated"`;

  return `You are an editorial curator for a premium cinematic discovery app — think Criterion meets A24.

${historySection}

${affinitySection}

${profileSection}

${recentShiftSection}

${modeSection}

${temporalSection}

${avoidSection}

TMDB genre IDs — Movies: 28=Action, 12=Adventure, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 14=Fantasy, 27=Horror, 9648=Mystery, 10749=Romance, 878=Science Fiction, 53=Thriller, 37=Western
TMDB genre IDs — TV: 10759=Action & Adventure, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 9648=Mystery, 10765=Sci-Fi & Fantasy, 10768=War & Politics, 37=Western

${taskLine}

STRUCTURE:
• 2 ANCHOR rows — stable core identity (dominant genres, prestige/darkness tone)
• 2 CONTEXTUAL rows — respond to ${temporal.description} and any detected recent shift
• 1 EXPLORATORY row — adjacent territory this viewer would love but hasn't settled into

${editorialGuidance}

ROW CONFIG:
- title: editorial collection name (see naming standard above)
- subtitle: one evocative sentence — the emotional promise of this row
- type: "movie" or "tv"
- genreIds: 1–3 TMDB IDs
- sortBy: "vote_average.desc" (quality) | "popularity.desc" (cultural moment) | "primary_release_date.desc" (fresh)
- voteAverageGte: 8.0 prestige | 7.5 strong | 7.0 discovery
- voteCountGte: ≥1000 movies | ≥300 TV
- releaseDateGte/releaseDateLte: include ONLY when era is integral to the theme

OUTPUT — ONLY valid JSON, no markdown, no prose:
{"tasteProfile":"You gravitate toward...","tasteMode":"prestige","thematicInterests":["neo-noir crime","psychological thriller"],"recentShift":null,"rows":[{"title":"...","subtitle":"...","type":"movie","genreIds":[18,53],"sortBy":"vote_average.desc","voteAverageGte":7.5,"voteCountGte":1000}]}`;
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
  historyItems: ContentItem[] = [],
  model: string = 'qwen/qwen3-32b',
): Promise<TasteDNA> {
  // Content fingerprint — DNA is reused across 6h rotations when watch history unchanged
  const fingerprint = computeContentFingerprint(movies, shows);

  // Compute extended profile deterministically before Gemini call
  const profile = historyItems.length > 0
    ? computeTasteProfile(historyItems, playsMap, genreAffinity)
    : undefined;

  // Sort by play-count × recency — rewatches and recent watches rank highest
  const sortedMovies = [...movies]
    .map(m => ({ ...m, _score: m.plays * recencyWeight(m.last_watched_at) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 80);

  const sortedShows = [...shows]
    .map(s => ({ ...s, _score: s.plays * recencyWeight(s.last_watched_at) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 60);

  const recentMovies = sortedMovies
    .map(m => m.plays > 1 ? `${m.movie.title} (${m.movie.year}) [${m.plays}×]` : `${m.movie.title} (${m.movie.year})`)
    .join(', ');

  const recentShows = sortedShows
    .map(s => s.plays > 1 ? `${s.show.title} (${s.show.year}) [${s.plays}×]` : `${s.show.title} (${s.show.year})`)
    .join(', ');

  // Last 10 movies by recency for shift detection
  const recentMoviesOnly = [...movies]
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 10)
    .map(m => `${m.movie.title} (${m.movie.year})`)
    .join(', ');

  const hasHistory = !!(recentMovies || recentShows);
  const hasRewatches = movies.some(m => m.plays > 1) || shows.some(s => s.plays > 1);
  const precomputedMode = inferTasteMode(genreAffinity, temporal, hasRewatches);

  const prompt = buildDNAPrompt(
    recentMovies, recentShows, hasHistory, temporal,
    recentRowTitles, genreAffinity, precomputedMode, profile, recentMoviesOnly,
  );

  const key = apiKey.trim().replace(/[\n\r\t]/g, '');

  const cascade = model === DNA_FALLBACK_MODEL ? [model] : [model, DNA_FALLBACK_MODEL];
  for (let i = 0; i < cascade.length; i++) {
    const modelId = cascade[i];
    try {
      console.log(`[TasteDNA] Trying ${modelId} (${temporal.description})`);
      const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://nextup.app',
          'X-Title': 'NextUp',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const raw: string = data.choices?.[0]?.message?.content ?? '';
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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

      let tasteMode: TasteMode = VALID_MODES.includes(parsed.tasteMode)
        ? parsed.tasteMode as TasteMode : precomputedMode;
      if (temporal.timeOfDay === 'late-night') tasteMode = 'late-night';

      const thematicInterests: string[] = Array.isArray(parsed.thematicInterests)
        ? parsed.thematicInterests.filter((t: any) => typeof t === 'string').slice(0, 5) : [];
      const recentShift: string | null = typeof parsed.recentShift === 'string' && parsed.recentShift
        ? parsed.recentShift : null;

      console.log(`[TasteDNA] ${rows.length} rows via ${modelId}, mode=${tasteMode}`);
      return {
        tasteProfile: String(parsed.tasteProfile ?? ''),
        tasteMode, rows, fingerprint,
        generatedAt: Date.now(),
        genreAffinity, profile, thematicInterests, recentShift,
      };
    } catch (e) {
      console.warn(`[TasteDNA] ${modelId} failed:`, String((e as any)?.message ?? '').slice(0, 100));
      if (i < cascade.length - 1) continue;
    }
  }

  console.warn('[TasteDNA] All models failed — editorial fallback');
  return {
    tasteProfile: '',
    tasteMode: precomputedMode,
    rows: getEditorialRows(temporal),
    fingerprint,
    generatedAt: Date.now(),
    genreAffinity, profile,
    thematicInterests: [], recentShift: null,
  };
}

// ─── Type import helper (avoid circular dependency on supabase.ts Database) ───
type Database = import('./supabase').Database;
