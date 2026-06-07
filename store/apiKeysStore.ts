import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  tmdb: 'nextup_tmdb_api_key',
  traktClientId: 'nextup_trakt_client_id',
  traktUsername: 'nextup_trakt_username',
  traktAccessToken: 'nextup_trakt_access_token',
  geminiKey: 'nextup_gemini_api_key',
  setupDone: 'nextup_setup_done',
} as const;

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
}));
