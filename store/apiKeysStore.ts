import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';

const KEYS = {
  tmdb: 'nextup_tmdb_api_key',
  traktClientId: 'nextup_trakt_client_id',
  traktUsername: 'nextup_trakt_username',
  traktAccessToken: 'nextup_trakt_access_token',
  geminiKey: 'nextup_gemini_api_key',
  setupDone: 'nextup_setup_done',
} as const;

// Matches user_settings table column names
type CloudSettings = {
  tmdb_key?: string | null;
  gemini_key?: string | null;
  trakt_client_id?: string | null;
  trakt_access_token?: string | null;
  trakt_username?: string | null;
};

interface ApiKeysState {
  tmdbKey: string;
  traktClientId: string;
  traktUsername: string;
  traktAccessToken: string;
  geminiKey: string;
  isSetupDone: boolean;
  isLoaded: boolean;

  loadKeys: () => Promise<void>;
  saveKeys: (keys: Partial<Pick<ApiKeysState,
    'tmdbKey' | 'traktClientId' | 'traktUsername' | 'traktAccessToken' | 'geminiKey'
  >>) => Promise<void>;
  markSetupDone: () => Promise<void>;
  clearKeys: () => Promise<void>;
  restoreFromCloud: (settings: CloudSettings) => Promise<void>;
  syncToCloud: (userId: string) => Promise<void>;
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  tmdbKey: process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '',
  traktClientId: '',
  traktUsername: '',
  traktAccessToken: '',
  geminiKey: '',
  isSetupDone: false,
  isLoaded: false,

  loadKeys: async () => {
    const [tmdbKey, traktClientId, traktUsername, traktAccessToken, geminiKey, setupDone] =
      await Promise.all([
        SecureStore.getItemAsync(KEYS.tmdb),
        SecureStore.getItemAsync(KEYS.traktClientId),
        SecureStore.getItemAsync(KEYS.traktUsername),
        SecureStore.getItemAsync(KEYS.traktAccessToken),
        SecureStore.getItemAsync(KEYS.geminiKey),
        SecureStore.getItemAsync(KEYS.setupDone),
      ]);

    set({
      tmdbKey: (tmdbKey ?? process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '').trim(),
      traktClientId: (traktClientId ?? '').trim(),
      traktUsername: (traktUsername ?? '').trim(),
      traktAccessToken: (traktAccessToken ?? '').trim(),
      geminiKey: (geminiKey ?? '').trim(),
      isSetupDone: setupDone === 'true' || !!process.env.EXPO_PUBLIC_TMDB_API_KEY,
      isLoaded: true,
    });
  },

  saveKeys: async (keys) => {
    const trimmed = Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as typeof keys;
    const writes: Promise<void>[] = [];
    if (trimmed.tmdbKey !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.tmdb, trimmed.tmdbKey));
    if (trimmed.traktClientId !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktClientId, trimmed.traktClientId));
    if (trimmed.traktUsername !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktUsername, trimmed.traktUsername));
    if (trimmed.traktAccessToken !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, trimmed.traktAccessToken));
    if (trimmed.geminiKey !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.geminiKey, trimmed.geminiKey));
    await Promise.all(writes);
    set((s) => ({ ...s, ...trimmed }));
  },

  markSetupDone: async () => {
    await SecureStore.setItemAsync(KEYS.setupDone, 'true');
    set({ isSetupDone: true });
  },

  clearKeys: async () => {
    await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
    set({
      tmdbKey: '',
      traktClientId: '',
      traktUsername: '',
      traktAccessToken: '',
      geminiKey: '',
      isSetupDone: false,
    });
  },

  // Called on login for existing users — writes user_settings keys into SecureStore + state
  restoreFromCloud: async (settings) => {
    const writes: Promise<void>[] = [];
    const state: Partial<ApiKeysState> = {};

    if (settings.tmdb_key) {
      writes.push(SecureStore.setItemAsync(KEYS.tmdb, settings.tmdb_key));
      state.tmdbKey = settings.tmdb_key;
    }
    if (settings.gemini_key) {
      writes.push(SecureStore.setItemAsync(KEYS.geminiKey, settings.gemini_key));
      state.geminiKey = settings.gemini_key;
    }
    if (settings.trakt_client_id) {
      writes.push(SecureStore.setItemAsync(KEYS.traktClientId, settings.trakt_client_id));
      state.traktClientId = settings.trakt_client_id;
    }
    if (settings.trakt_access_token) {
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, settings.trakt_access_token));
      state.traktAccessToken = settings.trakt_access_token;
    }
    if (settings.trakt_username) {
      writes.push(SecureStore.setItemAsync(KEYS.traktUsername, settings.trakt_username));
      state.traktUsername = settings.trakt_username;
    }

    writes.push(SecureStore.setItemAsync(KEYS.setupDone, 'true'));
    await Promise.all(writes);
    set((s) => ({ ...s, ...state, isSetupDone: true }));
  },

  // Called when new user finishes onboarding — upserts into user_settings
  syncToCloud: async (userId) => {
    const s = get();
    await supabase
      .from('user_settings')
      .upsert({
        id: userId,
        tmdb_key: s.tmdbKey || null,
        gemini_key: s.geminiKey || null,
        trakt_client_id: s.traktClientId || null,
        trakt_access_token: s.traktAccessToken || null,
        trakt_username: s.traktUsername || null,
        setup_done: true,
      }, { onConflict: 'id' });
  },
}));
