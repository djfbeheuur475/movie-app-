import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  followed: 'nextup_followed_ids',
  unfollowed: 'nextup_unfollowed_ids',
};

interface FollowState {
  followed: number[];
  unfollowed: number[];
  loaded: boolean;

  load: () => Promise<void>;
  follow: (id: number) => void;
  unfollow: (id: number) => void;
  isFollowed: (id: number) => boolean;
  isUnfollowed: (id: number) => boolean;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  followed: [],
  unfollowed: [],
  loaded: false,

  load: async () => {
    try {
      const [f, u] = await Promise.all([
        SecureStore.getItemAsync(KEYS.followed),
        SecureStore.getItemAsync(KEYS.unfollowed),
      ]);
      set({
        followed: f ? (JSON.parse(f) as number[]) : [],
        unfollowed: u ? (JSON.parse(u) as number[]) : [],
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  follow: (id) => {
    const { followed, unfollowed } = get();
    const newFollowed = followed.includes(id) ? followed : [...followed, id];
    const newUnfollowed = unfollowed.filter((x) => x !== id);
    set({ followed: newFollowed, unfollowed: newUnfollowed });
    SecureStore.setItemAsync(KEYS.followed, JSON.stringify(newFollowed)).catch(() => {});
    SecureStore.setItemAsync(KEYS.unfollowed, JSON.stringify(newUnfollowed)).catch(() => {});
  },

  unfollow: (id) => {
    const { followed, unfollowed } = get();
    const newFollowed = followed.filter((x) => x !== id);
    const newUnfollowed = unfollowed.includes(id) ? unfollowed : [...unfollowed, id];
    set({ followed: newFollowed, unfollowed: newUnfollowed });
    SecureStore.setItemAsync(KEYS.followed, JSON.stringify(newFollowed)).catch(() => {});
    SecureStore.setItemAsync(KEYS.unfollowed, JSON.stringify(newUnfollowed)).catch(() => {});
  },

  isFollowed: (id) => get().followed.includes(id),
  isUnfollowed: (id) => get().unfollowed.includes(id),
}));
