import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

interface PreferencesState {
  favoriteGenres: number[];
  recentSearches: string[];
  notificationsEnabled: boolean;
  region: string;

  setFavoriteGenres: (genres: number[], userId?: string) => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  setNotificationsEnabled: (enabled: boolean, userId?: string) => void;
  setRegion: (region: string, userId?: string) => void;
  loadFromStorage: () => Promise<void>;
  syncToCloud: (userId: string) => Promise<void>;
  restoreFromCloud: (userId: string) => Promise<void>;
}

const STORAGE_KEY = 'nextup_preferences';

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  favoriteGenres: [],
  recentSearches: [],
  notificationsEnabled: true,
  region: 'US',

  setFavoriteGenres: (favoriteGenres, userId) => {
    set({ favoriteGenres });
    persistLocal(get);
    if (userId) syncPrefs(userId, get);
  },

  addRecentSearch: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    set((s) => ({
      recentSearches: [trimmed, ...s.recentSearches.filter((q) => q !== trimmed)].slice(0, 10),
    }));
    persistLocal(get);
  },

  clearRecentSearches: () => {
    set({ recentSearches: [] });
    persistLocal(get);
  },

  setNotificationsEnabled: (notificationsEnabled, userId) => {
    set({ notificationsEnabled });
    persistLocal(get);
    if (userId) syncPrefs(userId, get);
  },

  setRegion: (region, userId) => {
    set({ region });
    persistLocal(get);
    if (userId) syncPrefs(userId, get);
  },

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) set(JSON.parse(raw));
    } catch {}
  },

  syncToCloud: async (userId) => {
    await syncPrefs(userId, get);
  },

  restoreFromCloud: async (userId) => {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('favorite_genres, notifications_enabled, region')
      .eq('id', userId)
      .single();

    if (error || !data) return;

    const update = {
      favoriteGenres: (data.favorite_genres as number[]) ?? [],
      notificationsEnabled: data.notifications_enabled ?? true,
      region: data.region ?? 'US',
    };
    set(update);
    persistLocal(get);
  },
}));

function persistLocal(get: () => PreferencesState) {
  const { favoriteGenres, recentSearches, notificationsEnabled, region } = get();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ favoriteGenres, recentSearches, notificationsEnabled, region }));
}

async function syncPrefs(userId: string, get: () => PreferencesState) {
  const { favoriteGenres, notificationsEnabled, region } = get();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { id: userId, favorite_genres: favoriteGenres, notifications_enabled: notificationsEnabled, region },
      { onConflict: 'id' }
    );
  if (error) console.warn('[Prefs] Supabase sync failed:', error.message);
}
