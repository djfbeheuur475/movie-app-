import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { refreshTraktToken, TRAKT_DEFAULT_CLIENT_ID } from '../lib/trakt';

const KEYS = {
  traktClientId: 'nextup_trakt_client_id',
  traktAccessToken: 'nextup_trakt_access_token',
  traktRefreshToken: 'nextup_trakt_refresh_token',
  aiModel: 'nextup_ai_model',
  setupDone: 'nextup_setup_done',
} as const;

// Matches user_settings table column names
type CloudSettings = {
  trakt_client_id?: string | null;
  trakt_access_token?: string | null;
};

interface ApiKeysState {
  traktClientId: string;
  traktAccessToken: string;
  traktRefreshToken: string;
  aiModel: string;
  isSetupDone: boolean;
  isLoaded: boolean;

  loadKeys: () => Promise<void>;
  saveKeys: (keys: Partial<Pick<ApiKeysState,
    'traktClientId' | 'traktAccessToken' | 'traktRefreshToken' | 'aiModel'
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
  traktAccessToken: '',
  traktRefreshToken: '',
  aiModel: '',
  isSetupDone: false,
  isLoaded: false,

  loadKeys: async () => {
    const [traktClientId, traktAccessToken, traktRefreshToken, aiModel, setupDone] =
      await Promise.all([
        SecureStore.getItemAsync(KEYS.traktClientId),
        SecureStore.getItemAsync(KEYS.traktAccessToken),
        SecureStore.getItemAsync(KEYS.traktRefreshToken),
        SecureStore.getItemAsync(KEYS.aiModel),
        SecureStore.getItemAsync(KEYS.setupDone),
      ]);

    set({
      traktClientId: (traktClientId ?? '').trim(),
      traktAccessToken: (traktAccessToken ?? '').trim(),
      traktRefreshToken: (traktRefreshToken ?? '').trim(),
      aiModel: (aiModel ?? '').trim(),
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
    if (trimmed.traktAccessToken !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, trimmed.traktAccessToken));
    if (trimmed.traktRefreshToken !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktRefreshToken, trimmed.traktRefreshToken));
    if (trimmed.aiModel !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.aiModel, trimmed.aiModel));
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
      traktAccessToken: '',
      traktRefreshToken: '',
      aiModel: '',
      isSetupDone: false,
    });
  },

  restoreFromCloud: async (settings) => {
    const writes: Promise<void>[] = [];
    const state: Partial<ApiKeysState> = {};

    if (settings.trakt_client_id) {
      writes.push(SecureStore.setItemAsync(KEYS.traktClientId, settings.trakt_client_id));
      state.traktClientId = settings.trakt_client_id;
    }
    if (settings.trakt_access_token) {
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, settings.trakt_access_token));
      state.traktAccessToken = settings.trakt_access_token;
    }
    writes.push(SecureStore.setItemAsync(KEYS.setupDone, 'true'));
    await Promise.all(writes);
    set((s) => ({ ...s, ...state, isSetupDone: true }));
  },

  syncToCloud: async (userId) => {
    const s = get();
    await supabase
      .from('user_settings')
      .upsert({
        id: userId,
        trakt_client_id: s.traktClientId || null,
        trakt_access_token: s.traktAccessToken || null,
        setup_done: true,
      }, { onConflict: 'id' });
  },

  handleTraktUnauthorized: async () => {
    const s = get();
    const clientId = s.traktClientId.trim() || TRAKT_DEFAULT_CLIENT_ID;
    if (!s.traktRefreshToken) {
      await get().saveKeys({ traktAccessToken: '' });
      return false;
    }
    const newToken = await refreshTraktToken(s.traktRefreshToken, clientId);
    if (newToken) {
      await get().saveKeys({
        traktAccessToken: newToken.access_token,
        traktRefreshToken: newToken.refresh_token,
      });
      return true;
    }
    await get().saveKeys({ traktAccessToken: '', traktRefreshToken: '' });
    return false;
  },
}));
