import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PreferencesState {
  favoriteGenres: number[];
  recentSearches: string[];
  notificationsEnabled: boolean;
  region: string;

  setFavoriteGenres: (genres: number[]) => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setRegion: (region: string) => void;
  loadFromStorage: () => Promise<void>;
}

const STORAGE_KEY = 'cineai_preferences';

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  favoriteGenres: [],
  recentSearches: [],
  notificationsEnabled: true,
  region: 'US',

  setFavoriteGenres: (favoriteGenres) => {
    set({ favoriteGenres });
    persist(get);
  },

  addRecentSearch: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    set((s) => ({
      recentSearches: [trimmed, ...s.recentSearches.filter((q) => q !== trimmed)].slice(0, 10),
    }));
    persist(get);
  },

  clearRecentSearches: () => {
    set({ recentSearches: [] });
    persist(get);
  },

  setNotificationsEnabled: (notificationsEnabled) => {
    set({ notificationsEnabled });
    persist(get);
  },

  setRegion: (region) => {
    set({ region });
    persist(get);
  },

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        set(saved);
      }
    } catch {}
  },
}));

function persist(get: () => PreferencesState) {
  const { favoriteGenres, recentSearches, notificationsEnabled, region } = get();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ favoriteGenres, recentSearches, notificationsEnabled, region }));
}
