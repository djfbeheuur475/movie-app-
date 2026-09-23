import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';
import { historySignature } from './traktHistorySlim';
export { slimHistory } from './traktHistorySlim';

// Last-known Trakt watch history, kept on-device and in Supabase so
// recommendations, watched ticks and "Recently watched" keep working from real
// history while Trakt is disconnected (expired token, reinstall, new device).

export interface TraktHistory {
  movies: TraktWatchedMovie[];
  shows: TraktWatchedShow[];
  /** ms epoch of the Trakt fetch this came from. */
  syncedAt: number;
}

const localKey = (owner: string) => `nextup_trakt_history_v1:${owner}`;
const cloudSigKey = (owner: string) => `nextup_trakt_history_v1:${owner}:cloud_sig`;

/** owner = NextUp user id, or 'guest'. userId is null for guests (local only). */
export async function loadTraktHistory(owner: string, userId: string | null): Promise<TraktHistory | null> {
  try {
    const raw = await AsyncStorage.getItem(localKey(owner));
    if (raw) return JSON.parse(raw) as TraktHistory;
  } catch (e) {
    console.warn('[TraktHistory] Local cache read failed:', e);
  }
  if (!userId) return null;

  // Nothing on this device (reinstall / new phone) — fall back to the cloud copy.
  const { data, error } = await supabase
    .from('trakt_history_cache')
    .select('movies, shows, signature, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const history: TraktHistory = {
    movies: (data.movies as TraktWatchedMovie[]) ?? [],
    shows: (data.shows as TraktWatchedShow[]) ?? [],
    syncedAt: Date.parse(data.updated_at) || 0,
  };
  await Promise.all([
    AsyncStorage.setItem(localKey(owner), JSON.stringify(history)),
    AsyncStorage.setItem(cloudSigKey(owner), data.signature),
  ]).catch(() => {});
  return history;
}

export async function saveTraktHistory(owner: string, userId: string | null, history: TraktHistory): Promise<void> {
  try {
    await AsyncStorage.setItem(localKey(owner), JSON.stringify(history));
  } catch (e) {
    console.warn('[TraktHistory] Local cache write failed:', e);
  }
  if (!userId) return;

  const sig = historySignature(history);
  const lastSig = await AsyncStorage.getItem(cloudSigKey(owner)).catch(() => null);
  if (sig === lastSig) return;
  const { error } = await supabase
    .from('trakt_history_cache')
    .upsert({
      user_id: userId,
      movies: history.movies,
      shows: history.shows,
      signature: sig,
      updated_at: new Date(history.syncedAt).toISOString(),
    }, { onConflict: 'user_id' });
  if (error) {
    console.warn('[TraktHistory] Cloud cache write failed:', error.message);
    return;
  }
  await AsyncStorage.setItem(cloudSigKey(owner), sig).catch(() => {});
}

/** Explicit "delete my imported history" — device and cloud copies. */
export async function clearTraktHistory(owner: string, userId: string | null): Promise<void> {
  await AsyncStorage.multiRemove([localKey(owner), cloudSigKey(owner)]).catch(() => {});
  if (userId) {
    const { error } = await supabase.from('trakt_history_cache').delete().eq('user_id', userId);
    if (error) console.warn('[TraktHistory] Cloud cache delete failed:', error.message);
  }
}
