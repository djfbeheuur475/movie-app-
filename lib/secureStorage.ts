import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store has no web implementation. On web these fall back to
// localStorage — the browser's own per-site storage, which is what a web app
// has; tokens there are only as safe as the site itself (no third-party scripts).
// Same API as SecureStore so callers don't branch.

const web = Platform.OS === 'web';

function local(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (!web) return SecureStore.getItemAsync(key);
  return local()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (!web) return SecureStore.setItemAsync(key, value);
  local()?.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (!web) return SecureStore.deleteItemAsync(key);
  local()?.removeItem(key);
}
