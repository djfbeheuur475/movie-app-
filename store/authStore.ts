import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useApiKeysStore } from './apiKeysStore';
import { useWatchlistStore } from './watchlistStore';

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

    // Upsert base profile — only updates identity fields
    await supabase
      .from('profiles')
      .upsert(
        {
          id: u.id,
          email: localUser.email,
          display_name: localUser.displayName,
          avatar_url: localUser.avatarUrl,
        },
        { onConflict: 'id' }
      );

    // Check user_settings for stored API keys
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', u.id)
      .single();

    // Existing user with keys: restore to device SecureStore + load watchlist
    if (settings?.setup_done || settings?.tmdb_key) {
      await useApiKeysStore.getState().restoreFromCloud(settings);
      await useWatchlistStore.getState().syncFromCloud(u.id);
    }

    set({ user: localUser, isAuthenticated: true, isLoaded: true });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, isAuthenticated: false });
  },
}));
