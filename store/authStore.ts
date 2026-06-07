import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'nextup_user_profile';

interface LocalUser {
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: LocalUser | null;
  isAuthenticated: boolean;
  isLoaded: boolean;

  loadUser: () => Promise<void>;
  setUser: (user: LocalUser) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoaded: false,

  loadUser: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const user = JSON.parse(raw) as LocalUser;
        set({ user, isAuthenticated: true, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setUser: async (user) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  signOut: async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ user: null, isAuthenticated: false });
  },
}));
