import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { ManualWatchedItem, MediaType } from '../types';

const STORAGE_KEY = 'nextup_manual_watched_v1';

interface ManualWatchedState {
  items: ManualWatchedItem[];
  isLoading: boolean;

  loadManualWatched: () => Promise<void>;
  markWatched: (item: Omit<ManualWatchedItem, 'id' | 'user_id' | 'watched_at'>, userId?: string) => Promise<void>;
  unmarkWatched: (tmdbId: number, mediaType: MediaType, userId?: string) => Promise<void>;
  isManuallyWatched: (tmdbId: number, mediaType: MediaType) => boolean;
  syncFromCloud: (userId: string) => Promise<void>;
}

async function persist(items: ManualWatchedItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// Supabase PostgrestBuilder only has .then(), not .catch() — use this wrapper
function supabaseQuery(promise: PromiseLike<any>) {
  Promise.resolve(promise).then(null, (e) => console.warn('[ManualWatched] Supabase error:', e?.message ?? e));
}

export const useManualWatchedStore = create<ManualWatchedState>((set, get) => ({
  items: [],
  isLoading: false,

  loadManualWatched: async () => {
    set({ isLoading: true });
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const items: ManualWatchedItem[] = raw ? JSON.parse(raw) : [];
      set({ items, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  markWatched: async (item, userId) => {
    const existing = get().items.find(
      (i) => i.tmdb_id === item.tmdb_id && i.media_type === item.media_type
    );
    if (existing) return;

    const newItem: ManualWatchedItem = {
      ...item,
      id: `${item.tmdb_id}-${item.media_type}-${Date.now()}`,
      user_id: userId ?? 'local',
      watched_at: new Date().toISOString(),
    };
    const updated = [newItem, ...get().items];
    set({ items: updated });
    await persist(updated);

    if (userId) {
      supabaseQuery(
        supabase.from('manual_watched').upsert(
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

  unmarkWatched: async (tmdbId, mediaType, userId) => {
    const updated = get().items.filter(
      (i) => !(i.tmdb_id === tmdbId && i.media_type === mediaType)
    );
    set({ items: updated });
    await persist(updated);

    if (userId) {
      supabaseQuery(
        supabase.from('manual_watched')
          .delete()
          .eq('user_id', userId)
          .eq('tmdb_id', tmdbId)
          .eq('media_type', mediaType)
      );
    }
  },

  isManuallyWatched: (tmdbId, mediaType) =>
    get().items.some((i) => i.tmdb_id === tmdbId && i.media_type === mediaType),

  syncFromCloud: async (userId) => {
    const { data, error } = await supabase
      .from('manual_watched')
      .select('*')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false });

    if (error || !data || data.length === 0) return;

    const items: ManualWatchedItem[] = data.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      title: row.title,
      poster_path: row.poster_path,
      watched_at: row.watched_at,
    }));

    set({ items });
    await persist(items);
  },
}));
