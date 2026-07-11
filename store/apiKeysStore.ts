import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { refreshTraktToken } from '../lib/trakt';

const KEYS = {
  traktClientId: 'nextup_trakt_client_id',
  traktUsername: 'nextup_trakt_username',
  traktAccessToken: 'nextup_trakt_access_token',
  traktRefreshToken: 'nextup_trakt_refresh_token',
  geminiKey: 'nextup_gemini_api_key',
  setupDone: 'nextup_setup_done',
} as const;

// Matches user_settings table column names
type CloudSettings = {
  gemini_key?: string | null;
  trakt_client_id?: string | null;
  trakt_access_token?: string | null;
  trakt_username?: string | null;
};

interface ApiKeysState {
  traktClientId: string;
  traktUsername: string;
  traktAccessToken: string;
  traktRefreshToken: string;
  geminiKey: string;
  isSetupDone: boolean;
  isLoaded: boolean;

  loadKeys: () => Promise<void>;
  saveKeys: (keys: Partial<Pick<ApiKeysState,
    'traktClientId' | 'traktUsername' | 'traktAccessToken' | 'traktRefreshToken' | 'geminiKey'
  >>) => Promise<void>;
  markSetupDone: () => Promise<void>;
  clearKeys: () => Promise<void>;
  restoreFromCloud: (settings: CloudSettings) => Promise<void>;
  syncToCloud: (userId: string) => Promise<void>;
  /** Called when a Trakt 401 is received. Tries to refresh; clears token on failure. Returns true if refreshed. */
  handleTraktUnauthorized: () => Promise<boolean>;
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  traktClientId: '',
  traktUsername: '',
  traktAccessToken: '',
  traktRefreshToken: '',
  geminiKey: '',
  isSetupDone: false,
  isLoaded: false,

  loadKeys: async () => {
    const [traktClientId, traktUsername, traktAccessToken, traktRefreshToken, geminiKey, setupDone] =
      await Promise.all([
        SecureStore.getItemAsync(KEYS.traktClientId),
        SecureStore.getItemAsync(KEYS.traktUsername),
        SecureStore.getItemAsync(KEYS.traktAccessToken),
        SecureStore.getItemAsync(KEYS.traktRefreshToken),
        SecureStore.getItemAsync(KEYS.geminiKey),
        SecureStore.getItemAsync(KEYS.setupDone),
      ]);

    set({
      traktClientId: (traktClientId ?? '').trim(),
      traktUsername: (traktUsername ?? '').trim(),
      traktAccessToken: (traktAccessToken ?? '').trim(),
      traktRefreshToken: (traktRefreshToken ?? '').trim(),
      geminiKey: (geminiKey ?? '').trim(),
      isSetupDone: setupDone === 'true',
      isLoaded: true,
    });
  },

  saveKeys: async (keys) => {
    const trimmed = Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as typeof keys;
    const writes: Promise<void>[] = [];
    if (trimmed.traktClientId !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktClientId, trimmed.traktClientId));
    if (trimmed.traktUsername !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktUsername, trimmed.traktUsername));
    if (trimmed.traktAccessToken !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, trimmed.traktAccessToken));
    if (trimmed.traktRefreshToken !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktRefreshToken, trimmed.traktRefreshToken));
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
      traktClientId: '',
      traktUsername: '',
      traktAccessToken: '',
      traktRefreshToken: '',
      geminiKey: '',
      isSetupDone: false,
    });
  },

  // Called on login — writes cloud keys back into SecureStore + state
  restoreFromCloud: async (settings) => {
    const writes: Promise<void>[] = [];
    const state: Partial<ApiKeysState> = {};

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

  // Called when onboarding finishes or after connecting Trakt — upserts into user_settings
  syncToCloud: async (userId) => {
    const s = get();
    await supabase
      .from('user_settings')
      .upsert({
        id: userId,
        gemini_key: s.geminiKey || null,
        trakt_client_id: s.traktClientId || null,
        trakt_access_token: s.traktAccessToken || null,
        trakt_username: s.traktUsername || null,
        setup_done: true,
      }, { onConflict: 'id' });
  },

  // Called when Trakt returns 401. Tries to silently refresh; clears token on failure.
  handleTraktUnauthorized: async () => {
    const s = get();
    if (!s.traktRefreshToken || !s.traktClientId) {
      // No refresh token — clear access token so UI shows disconnected
      await get().saveKeys({ traktAccessToken: '' });
      return false;
    }
    const newToken = await refreshTraktToken(s.traktRefreshToken, s.traktClientId);
    if (newToken) {
      await get().saveKeys({
        traktAccessToken: newToken.access_token,
        traktRefreshToken: newToken.refresh_token,
      });
      return true;
    }
    // Refresh failed — clear both tokens so UI shows disconnected
    await get().saveKeys({ traktAccessToken: '', traktRefreshToken: '' });
    return false;
  },
}));
