import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  tmdb: 'cineai_tmdb_api_key',
  backendUrl: 'cineai_backend_url',
  supabaseUrl: 'cineai_supabase_url',
  supabaseAnon: 'cineai_supabase_anon_key',
  setupDone: 'cineai_setup_done',
} as const;

interface ApiKeysState {
  tmdbKey: string;
  backendUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  isSetupDone: boolean;
  isLoaded: boolean;

  loadKeys: () => Promise<void>;
  saveKeys: (keys: Partial<Omit<ApiKeysState, 'isSetupDone' | 'isLoaded' | 'loadKeys' | 'saveKeys' | 'markSetupDone' | 'clearKeys'>>) => Promise<void>;
  markSetupDone: () => Promise<void>;
  clearKeys: () => Promise<void>;
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  tmdbKey: process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '',
  backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  isSetupDone: false,
  isLoaded: false,

  loadKeys: async () => {
    const [tmdbKey, backendUrl, supabaseUrl, supabaseAnonKey, setupDone] = await Promise.all([
      SecureStore.getItemAsync(KEYS.tmdb),
      SecureStore.getItemAsync(KEYS.backendUrl),
      SecureStore.getItemAsync(KEYS.supabaseUrl),
      SecureStore.getItemAsync(KEYS.supabaseAnon),
      SecureStore.getItemAsync(KEYS.setupDone),
    ]);

    set({
      tmdbKey: tmdbKey ?? process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '',
      backendUrl: backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001',
      supabaseUrl: supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      supabaseAnonKey: supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      isSetupDone: setupDone === 'true' || !!process.env.EXPO_PUBLIC_TMDB_API_KEY,
      isLoaded: true,
    });
  },

  saveKeys: async (keys) => {
    const writes: Promise<void>[] = [];
    if (keys.tmdbKey !== undefined) writes.push(SecureStore.setItemAsync(KEYS.tmdb, keys.tmdbKey));
    if (keys.backendUrl !== undefined) writes.push(SecureStore.setItemAsync(KEYS.backendUrl, keys.backendUrl));
    if (keys.supabaseUrl !== undefined) writes.push(SecureStore.setItemAsync(KEYS.supabaseUrl, keys.supabaseUrl));
    if (keys.supabaseAnonKey !== undefined) writes.push(SecureStore.setItemAsync(KEYS.supabaseAnon, keys.supabaseAnonKey));
    await Promise.all(writes);
    set((s) => ({ ...s, ...keys }));
  },

  markSetupDone: async () => {
    await SecureStore.setItemAsync(KEYS.setupDone, 'true');
    set({ isSetupDone: true });
  },

  clearKeys: async () => {
    await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
    set({
      tmdbKey: '',
      backendUrl: 'http://localhost:3001',
      supabaseUrl: '',
      supabaseAnonKey: '',
      isSetupDone: false,
    });
  },
}));
