import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { refreshTraktToken, traktTokenExpiry, TRAKT_DEFAULT_CLIENT_ID } from '../lib/trakt';

const KEYS = {
  traktClientId: 'nextup_trakt_client_id',
  traktAccessToken: 'nextup_trakt_access_token',
  traktRefreshToken: 'nextup_trakt_refresh_token',
  traktTokenExpiresAt: 'nextup_trakt_token_expires_at',
  aiModel: 'nextup_ai_model',
  setupDone: 'nextup_setup_done',
} as const;

// Matches user_settings table column names
type CloudSettings = {
  trakt_client_id?: string | null;
  trakt_access_token?: string | null;
  trakt_refresh_token?: string | null;
  trakt_token_expires_at?: string | null;
};

// Refresh this far ahead of expiry. Trakt access tokens only live 24h.
const REFRESH_MARGIN_MS = 1000 * 60 * 60 * 2;

// Trakt rotates the refresh token on every use, so two concurrent refreshes
// (Home, Calendar and the watched hook all 401 at once after a day away)
// would race: the loser presents an already-used refresh token, gets
// invalid_grant, and wipes the token the winner just saved. Share one
// in-flight refresh instead.
let refreshInFlight: Promise<boolean> | null = null;

interface ApiKeysState {
  traktClientId: string;
  traktAccessToken: string;
  traktRefreshToken: string;
  /** ms epoch; 0 = unknown (tokens saved before expiry was tracked). */
  traktTokenExpiresAt: number;
  aiModel: string;
  isSetupDone: boolean;
  isLoaded: boolean;

  loadKeys: () => Promise<void>;
  saveKeys: (keys: Partial<Pick<ApiKeysState,
    'traktClientId' | 'traktAccessToken' | 'traktRefreshToken' | 'traktTokenExpiresAt' | 'aiModel'
  >>) => Promise<void>;
  markSetupDone: () => Promise<void>;
  clearKeys: () => Promise<void>;
  restoreFromCloud: (settings: CloudSettings) => Promise<void>;
  syncToCloud: (userId: string) => Promise<void>;
  /** Called when a Trakt 401 is received. Tries to refresh; clears tokens only if Trakt rejects the refresh token. Returns true if refreshed. */
  handleTraktUnauthorized: () => Promise<boolean>;
  /** Proactively refreshes if the access token is expired or about to be. Safe to call often. */
  ensureFreshTraktToken: () => Promise<void>;
  /** Explicit user disconnect — clears tokens locally and in the cloud. */
  disconnectTrakt: () => Promise<void>;
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  traktClientId: '',
  traktAccessToken: '',
  traktRefreshToken: '',
  traktTokenExpiresAt: 0,
  aiModel: '',
  isSetupDone: false,
  isLoaded: false,

  loadKeys: async () => {
    const [traktClientId, traktAccessToken, traktRefreshToken, traktTokenExpiresAt, aiModel, setupDone] =
      await Promise.all([
        SecureStore.getItemAsync(KEYS.traktClientId),
        SecureStore.getItemAsync(KEYS.traktAccessToken),
        SecureStore.getItemAsync(KEYS.traktRefreshToken),
        SecureStore.getItemAsync(KEYS.traktTokenExpiresAt),
        SecureStore.getItemAsync(KEYS.aiModel),
        SecureStore.getItemAsync(KEYS.setupDone),
      ]);

    set({
      traktClientId: (traktClientId ?? '').trim(),
      traktAccessToken: (traktAccessToken ?? '').trim(),
      traktRefreshToken: (traktRefreshToken ?? '').trim(),
      traktTokenExpiresAt: Number(traktTokenExpiresAt) || 0,
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
    if (trimmed.traktTokenExpiresAt !== undefined)
      writes.push(SecureStore.setItemAsync(KEYS.traktTokenExpiresAt, String(trimmed.traktTokenExpiresAt)));
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
      traktTokenExpiresAt: 0,
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
    // Only take the cloud's Trakt tokens if they're newer than what this
    // device holds — otherwise signing in again would overwrite a freshly
    // refreshed local token with an older cloud copy.
    const cloudExpiry = settings.trakt_token_expires_at ? Date.parse(settings.trakt_token_expires_at) : 0;
    const local = get();
    const localHasTokens = !!(local.traktAccessToken || local.traktRefreshToken);
    if (settings.trakt_access_token && (!localHasTokens || cloudExpiry > local.traktTokenExpiresAt)) {
      writes.push(SecureStore.setItemAsync(KEYS.traktAccessToken, settings.trakt_access_token));
      state.traktAccessToken = settings.trakt_access_token;
      if (settings.trakt_refresh_token) {
        writes.push(SecureStore.setItemAsync(KEYS.traktRefreshToken, settings.trakt_refresh_token));
        state.traktRefreshToken = settings.trakt_refresh_token;
      }
      writes.push(SecureStore.setItemAsync(KEYS.traktTokenExpiresAt, String(cloudExpiry)));
      state.traktTokenExpiresAt = cloudExpiry;
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
        trakt_refresh_token: s.traktRefreshToken || null,
        trakt_token_expires_at: s.traktTokenExpiresAt ? new Date(s.traktTokenExpiresAt).toISOString() : null,
        setup_done: true,
      }, { onConflict: 'id' });
  },

  handleTraktUnauthorized: () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const s = get();
      const clientId = s.traktClientId.trim() || TRAKT_DEFAULT_CLIENT_ID;
      if (!s.traktRefreshToken) {
        await get().saveKeys({ traktAccessToken: '' });
        return false;
      }
      const result = await refreshTraktToken(s.traktRefreshToken, clientId);
      if (result.kind === 'ok') {
        await get().saveKeys({
          traktAccessToken: result.token.access_token,
          traktRefreshToken: result.token.refresh_token,
          traktTokenExpiresAt: traktTokenExpiry(result.token),
        });
        await syncTokensToCloud();
        return true;
      }
      if (result.kind === 'invalid') {
        await get().saveKeys({ traktAccessToken: '', traktRefreshToken: '', traktTokenExpiresAt: 0 });
        await syncTokensToCloud();
      }
      // 'error' (offline, Trakt down): keep everything and try again next time.
      return false;
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  },

  ensureFreshTraktToken: async () => {
    const s = get();
    if (!s.traktRefreshToken) return;
    // Unknown expiry (connected before this was tracked) counts as due.
    if (s.traktTokenExpiresAt && s.traktTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS) return;
    await get().handleTraktUnauthorized();
  },

  disconnectTrakt: async () => {
    await get().saveKeys({ traktAccessToken: '', traktRefreshToken: '', traktTokenExpiresAt: 0 });
    await syncTokensToCloud();
  },
}));

async function syncTokensToCloud(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await useApiKeysStore.getState().syncToCloud(session.user.id);
  } catch (e) {
    console.warn('[Trakt] Cloud token sync failed:', e);
  }
}
