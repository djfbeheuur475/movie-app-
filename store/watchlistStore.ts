import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { WatchlistItem, MediaType } from '../types';

interface WatchlistState {
  items: WatchlistItem[];
  isLoading: boolean;

  fetchWatchlist: () => Promise<void>;
  addToWatchlist: (item: Omit<WatchlistItem, 'id' | 'user_id' | 'added_at'>) => Promise<void>;
  removeFromWatchlist: (tmdbId: number, mediaType: MediaType) => Promise<void>;
  isInWatchlist: (tmdbId: number, mediaType: MediaType) => boolean;
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  items: [],
  isLoading: false,

  fetchWatchlist: async () => {
    set({ isLoading: true });
    const { data } = await supabase
      .from('watchlist')
      .select('*')
      .order('added_at', { ascending: false });
    set({ items: (data as WatchlistItem[]) ?? [], isLoading: false });
  },

  addToWatchlist: async (item) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('watchlist')
      .insert({ ...item, user_id: user.id })
      .select()
      .single();
    if (data) set((s) => ({ items: [data as WatchlistItem, ...s.items] }));
  },

  removeFromWatchlist: async (tmdbId, mediaType) => {
    await supabase
      .from('watchlist')
      .delete()
      .eq('tmdb_id', tmdbId)
      .eq('media_type', mediaType);
    set((s) => ({
      items: s.items.filter((i) => !(i.tmdb_id === tmdbId && i.media_type === mediaType)),
    }));
  },

  isInWatchlist: (tmdbId, mediaType) =>
    get().items.some((i) => i.tmdb_id === tmdbId && i.media_type === mediaType),
}));
