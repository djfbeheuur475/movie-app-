import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/config';

const supabaseUrl = Config.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = Config.SUPABASE_ANON_KEY || 'placeholder';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

export type Database = {
  public: {
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          trakt_connected: boolean;
          trakt_username: string | null;
          trakt_client_id: string | null;
          trakt_access_token: string | null;
          trakt_refresh_token: string | null;
          tmdb_api_key: string | null;
          gemini_api_key: string | null;
          setup_done: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          trakt_connected?: boolean;
          trakt_username?: string | null;
          trakt_client_id?: string | null;
          trakt_access_token?: string | null;
          trakt_refresh_token?: string | null;
          tmdb_api_key?: string | null;
          gemini_api_key?: string | null;
          setup_done?: boolean;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      user_preferences: {
        Row: {
          id: string;
          favorite_genres: number[];
          notifications_enabled: boolean;
          region: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['user_preferences']['Row'], 'updated_at'>;
        Update: Partial<Database['public']['Tables']['user_preferences']['Insert']>;
        Relationships: [];
      };
      user_settings: {
        Row: {
          id: string;
          tmdb_key: string | null;
          gemini_key: string | null;
          trakt_client_id: string | null;
          trakt_access_token: string | null;
          trakt_username: string | null;
          setup_done: boolean;
        };
        Insert: {
          id: string;
          tmdb_key?: string | null;
          gemini_key?: string | null;
          trakt_client_id?: string | null;
          trakt_access_token?: string | null;
          trakt_username?: string | null;
          setup_done?: boolean;
        };
        Update: Partial<Database['public']['Tables']['user_settings']['Insert']>;
        Relationships: [];
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
        Relationships: [];
      };
      taste_dna: {
        Row: {
          user_id: string;
          taste_profile: string | null;
          taste_mode: string | null;
          rows: unknown;
          fingerprint: string | null;
          genre_affinity: unknown;
          profile_metadata: unknown;
          generated_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['taste_dna']['Row'], 'generated_at' | 'updated_at'> & {
          generated_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['taste_dna']['Insert']>;
        Relationships: [];
      };
      shown_rows: {
        Row: {
          id: string;
          user_id: string;
          row_title: string;
          shown_at: string;
        };
        Insert: Omit<Database['public']['Tables']['shown_rows']['Row'], 'id' | 'shown_at'> & {
          shown_at?: string;
        };
        Update: Partial<Database['public']['Tables']['shown_rows']['Insert']>;
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          id: string;
          user_id: string;
          summary: string;
          titles_mentioned: string[];
          session_at: string;
        };
        Insert: Omit<Database['public']['Tables']['ai_conversations']['Row'], 'id' | 'session_at'> & {
          session_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ai_conversations']['Insert']>;
        Relationships: [];
      };
    };
  };
};
