import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/config';

export const supabase = createClient(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          trakt_connected: boolean;
          trakt_username: string | null;
          trakt_access_token: string | null;
          trakt_refresh_token: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      watchlist: {
        Row: {
          id: string;
          user_id: string;
          tmdb_id: number;
          media_type: 'movie' | 'tv';
          added_at: string;
          title: string;
          poster_path: string | null;
        };
        Insert: Omit<Database['public']['Tables']['watchlist']['Row'], 'id' | 'added_at'>;
        Update: Partial<Database['public']['Tables']['watchlist']['Insert']>;
      };
      ai_conversations: {
        Row: {
          id: string;
          user_id: string;
          messages: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['ai_conversations']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['ai_conversations']['Insert']>;
      };
    };
  };
};
