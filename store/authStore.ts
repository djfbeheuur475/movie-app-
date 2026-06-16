import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useApiKeysStore } from './apiKeysStore';
import { useWatchlistStore } from './watchlistStore';
import { usePreferencesStore } from './preferencesStore';

export interface LocalUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: LocalUser | null;
  isAuthenticated: boolean;
  isLoaded: boolean;

  loadUser: () => Promise<void>;
  signOut: () => Promise<void>;
  _refreshFromSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoaded: false,

  loadUser: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const u = session.user;
        set({
          user: {
            id: u.id,
            displayName: u.user_metadata?.full_name ?? u.email ?? 'User',
            email: u.email ?? '',
            avatarUrl: u.user_metadata?.avatar_url ?? null,
          },
          isAuthenticated: true,
          isLoaded: true,
        });
        return;
      }
    } catch (e) {
      console.warn('Auth session load error:', e);
    }
    set({ isLoaded: true });
  },

  _refreshFromSession: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const u = session.user;
    const localUser: LocalUser = {
      id: u.id,
      displayName: u.user_metadata?.full_name ?? u.email ?? 'User',
      email: u.email ?? '',
      avatarUrl: u.user_metadata?.avatar_url ?? null,
    };

    // Insert profile row for new users; update only identity fields for returning users
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: u.id,
        display_name: localUser.displayName,
        avatar_url: localUser.avatarUrl,
        trakt_connected: false,
        setup_done: false,
      });
    if (insertError?.code === '23505') {
      // Row exists — update identity fields only, preserve trakt_connected/setup_done
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          display_name: localUser.displayName,
          avatar_url: localUser.avatarUrl,
        })
        .eq('id', u.id);
      if (updateError) console.warn('[Auth] Profile update failed:', updateError.message);
    } else if (insertError) {
      console.warn('[Auth] Profile insert failed:', insertError.message, insertError.code);
    }

    // Check user_settings for stored API keys
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', u.id)
      .single();

    // Existing user with keys: restore to device SecureStore + load watchlist + restore preferences
    if (settings?.setup_done || settings?.tmdb_key) {
      await useApiKeysStore.getState().restoreFromCloud(settings);
      await useWatchlistStore.getState().syncFromCloud(u.id);
    }
    // Always restore preferences (non-blocking)
    usePreferencesStore.getState().restoreFromCloud(u.id).catch(() => {});

    set({ user: localUser, isAuthenticated: true, isLoaded: true });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, isAuthenticated: false });
  },
}));
