import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WatchlistItem, MediaType } from '../types';

const STORAGE_KEY = 'nextup_watchlist_v2';

interface WatchlistState {
  items: WatchlistItem[];
  isLoading: boolean;

  loadWatchlist: () => Promise<void>;
  addToWatchlist: (item: Omit<WatchlistItem, 'id' | 'user_id' | 'added_at'>) => Promise<void>;
  removeFromWatchlist: (tmdbId: number, mediaType: MediaType) => Promise<void>;
  isInWatchlist: (tmdbId: number, mediaType: MediaType) => boolean;
}

async function persist(items: WatchlistItem[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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

  addToWatchlist: async (item) => {
    const existing = get().items.find(
      (i) => i.tmdb_id === item.tmdb_id && i.media_type === item.media_type
    );
    if (existing) return;

    const newItem: WatchlistItem = {
      ...item,
      id: `${item.tmdb_id}-${item.media_type}-${Date.now()}`,
      user_id: 'local',
      added_at: new Date().toISOString(),
    };
    const updated = [newItem, ...get().items];
    set({ items: updated });
    await persist(updated);
  },

  removeFromWatchlist: async (tmdbId, mediaType) => {
    const updated = get().items.filter(
      (i) => !(i.tmdb_id === tmdbId && i.media_type === mediaType)
    );
    set({ items: updated });
    await persist(updated);
  },

  isInWatchlist: (tmdbId, mediaType) =>
    get().items.some((i) => i.tmdb_id === tmdbId && i.media_type === mediaType),
}));
