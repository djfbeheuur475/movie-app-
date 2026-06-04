// Backend API client — keeps Trakt tokens, Gemini calls server-side
import axios from 'axios';
import { Config } from '../constants/config';
import { supabase } from './supabase';
import { useApiKeysStore } from '../store/apiKeysStore';

const api = axios.create({ baseURL: Config.BACKEND_URL });

api.interceptors.request.use(async (config) => {
  // Use stored backend URL if available
  const storedUrl = useApiKeysStore.getState().backendUrl;
  if (storedUrl) config.baseURL = storedUrl;

  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    config.headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  return config;
});

export const backendApi = {
  // ─── AI ──────────────────────────────────────────────────────────────────
  askGemini: async (messages: { role: string; content: string }[]) => {
    const { data } = await api.post('/api/ai/chat', { messages });
    return data as { reply: string; recommendations?: number[] };
  },

  // ─── Trakt ───────────────────────────────────────────────────────────────
  connectTrakt: async (code: string) => {
    const { data } = await api.post('/api/trakt/connect', { code });
    return data;
  },

  getTraktWatched: async () => {
    const { data } = await api.get('/api/trakt/watched');
    return data;
  },

  getTraktCalendar: async (startDate: string, days = 7) => {
    const { data } = await api.get('/api/trakt/calendar', {
      params: { start_date: startDate, days },
    });
    return data;
  },

  syncTraktHistory: async () => {
    const { data } = await api.post('/api/trakt/sync');
    return data;
  },

  // ─── Recommendations ─────────────────────────────────────────────────────
  getRecommendations: async (context: {
    watchHistory?: number[];
    genres?: number[];
    mood?: string;
  }) => {
    const { data } = await api.post('/api/recommendations', context);
    return data as { tmdbIds: number[]; explanation: string };
  },

  getAIExplanation: async (tmdbId: number, mediaType: 'movie' | 'tv') => {
    const { data } = await api.get(`/api/recommendations/explain`, {
      params: { tmdb_id: tmdbId, media_type: mediaType },
    });
    return data as { explanation: string };
  },
};
