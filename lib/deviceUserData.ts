import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from './secureStorage';
import { queryClient } from './queryClient';
import { useApiKeysStore } from '../store/apiKeysStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { useManualWatchedStore } from '../store/manualWatchedStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useFollowStore } from '../store/followStore';

// NextUp is multi-user: each person signs in to their own account and links
// their own Trakt. Almost everything device-local (Trakt tokens, watchlist,
// manual watches, preferences, taste DNA caches, React Query data) is stored
// under device-wide keys, so without this the next person to sign in on a
// shared phone/browser would inherit the previous person's Trakt account and
// lists. Their data is all in the cloud and restores on sign-in.

const DEVICE_OWNER_KEY = 'nextup_device_owner';

// Kept across a wipe: the Supabase session itself, and per-user bookkeeping
// that's namespaced by user id (so it can't leak between accounts).
const KEEP_PREFIXES = ['sb-', 'nextup_trakt_watchlist_imported_v1:'];

const SECURE_KEYS = ['nextup_followed_ids', 'nextup_unfollowed_ids'];

export async function wipeLocalUserData(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => !KEEP_PREFIXES.some((p) => k.startsWith(p))));
  } catch (e) {
    console.warn('[DeviceUserData] AsyncStorage wipe failed:', e);
  }
  await useApiKeysStore.getState().clearKeys().catch(() => {});
  await Promise.all(SECURE_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));

  for (const store of [useWatchlistStore, useManualWatchedStore, usePreferencesStore, useFollowStore] as const) {
    (store as any).setState((store as any).getInitialState(), true);
  }
  queryClient.clear();
}

/** Call once a session is known. Wipes the previous account's local data if a different user signs in. */
export async function claimDeviceFor(userId: string): Promise<void> {
  const previous = await AsyncStorage.getItem(DEVICE_OWNER_KEY).catch(() => null);
  if (previous && previous !== userId) await wipeLocalUserData();
  await AsyncStorage.setItem(DEVICE_OWNER_KEY, userId).catch(() => {});
}
