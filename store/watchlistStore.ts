import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { WatchlistItem, MediaType } from '../types';

const STORAGE_KEY = 'nextup_watchlist_v2';

interface WatchlistState {
  items: WatchlistItem[];
  isLoading: boolean;

  loadWatchlist: () => Promise<void>;
  addToWatchlist: (item: Omit<WatchlistItem, 'id' | 'user_id' | 'added_at'>, userId?: string) => Promise<void>;
  removeFromWatchlist: (tmdbId: number, mediaType: MediaType, userId?: string) => Promise<void>;
  isInWatchlist: (tmdbId: number, mediaType: MediaType) => boolean;
  syncFromCloud: (userId: string) => Promise<void>;
}

async function persist(items: WatchlistItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// Supabase PostgrestBuilder only has .then(), not .catch() — use this wrapper
function supabaseQuery(promise: PromiseLike<any>) {
  Promise.resolve(promise).then(null, (e) => console.warn('[Watchlist] Supabase error:', e?.message ?? e));
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  items: [],
  isLoading: false,

  loadWatchlist: async () => {
    set({ isLoading: true });
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const items: WatchlistItem[] = raw ? JSON.parse(raw) : [];
      set({ items, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addToWatchlist: async (item, userId) => {
    const existing = get().items.find(
      (i) => i.tmdb_id === item.tmdb_id && i.media_type === item.media_type
    );
    if (existing) return;

    const newItem: WatchlistItem = {
      ...item,
      id: `${item.tmdb_id}-${item.media_type}-${Date.now()}`,
      user_id: userId ?? 'local',
      added_at: new Date().toISOString(),
    };
    const updated = [newItem, ...get().items];
    set({ items: updated });
    await persist(updated);

    if (userId) {
      supabaseQuery(
        supabase.from('watchlist').upsert(
          {
            user_id: userId,
            tmdb_id: item.tmdb_id,
            media_type: item.media_type,
            title: item.title,
            poster_path: item.poster_path ?? null,
          },
          { onConflict: 'user_id,tmdb_id,media_type' }
        )
      );
    }
  },

  removeFromWatchlist: async (tmdbId, mediaType, userId) => {
    const updated = get().items.filter(
      (i) => !(i.tmdb_id === tmdbId && i.media_type === mediaType)
    );
    set({ items: updated });
    await persist(updated);

    if (userId) {
      supabaseQuery(
        supabase.from('watchlist')
          .delete()
          .eq('user_id', userId)
          .eq('tmdb_id', tmdbId)
          .eq('media_type', mediaType)
      );
    }
  },

  isInWatchlist: (tmdbId, mediaType) =>
    get().items.some((i) => i.tmdb_id === tmdbId && i.media_type === mediaType),

  syncFromCloud: async (userId) => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error || !data || data.length === 0) return;

    const items: WatchlistItem[] = data.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      title: row.title,
      poster_path: row.poster_path,
      added_at: row.added_at,
    }));

    set({ items });
    await persist(items);
  },
}));
