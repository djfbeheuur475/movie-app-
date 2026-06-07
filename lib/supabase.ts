// Supabase removed — replaced by local AsyncStorage-based storage.
// This stub prevents import errors in any files that haven't been updated yet.
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => { throw new Error('Supabase removed'); },
    signUp: async () => { throw new Error('Supabase removed'); },
    signOut: async () => { throw new Error('Supabase removed'); },
    signInWithOAuth: async () => { throw new Error('Supabase removed'); },
    setSession: async () => { throw new Error('Supabase removed'); },
  },
};
