import { supabase } from './supabase';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';
import type { TasteDNA } from './tasteDna';

// All AI calls go through the ai-chat edge function — the OpenRouter key lives
// only in Supabase secrets. Never import a module that reads a provider key
// from EXPO_PUBLIC_* env: anything EXPO_PUBLIC_ is compiled into the bundle.

export interface AIReply {
  reply: string;
  movies: string[];
  shows: string[];
  movieYears: (number | null)[];
  showYears: (number | null)[];
  modelUsed: string;
  tmdbIds: number[];
  movieIds: number[];
  tvIds: number[];
}

// Default used when the user hasn't configured a model in Settings.
export const DEFAULT_AI_MODEL = 'qwen/qwen3-14b';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type AskDoneEvent = {
  t: 'd';
  r: string; m: string[]; s: string[];
  my: (number | null)[]; sy: (number | null)[];
  mu: string;
};

async function parseSSEStream(
  response: Response,
  onChunk: (text: string) => void,
): Promise<AskDoneEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;

      try {
        const event = JSON.parse(payload);
        if (event.t === 'c' && typeof event.v === 'string') {
          onChunk(event.v);
        } else if (event.t === 'd') {
          return event as AskDoneEvent;
        } else if (event.t === 'e') {
          throw new Error(event.msg ?? 'AI error');
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // incomplete JSON, skip
        throw e;
      }
    }
  }

  throw new Error('Stream ended without done event');
}

export async function askAI(
  messages: ChatMessage[],
  watchedMovies: TraktWatchedMovie[] = [],
  watchedShows: TraktWatchedShow[] = [],
  alreadyRecommended: string[] = [],
  favoriteGenres: number[] = [],
  _tasteDNA?: TasteDNA,       // fetched server-side from taste_dna table
  model?: string,
  onChunk?: (text: string) => void,
): Promise<AIReply> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const url = `${supabaseUrl}/functions/v1/ai-chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'ask',
      messages,
      watchedMovies: watchedMovies.slice(0, 50),
      watchedShows: watchedShows.slice(0, 30),
      favoriteGenres,
      model,
      inSessionTitles: alreadyRecommended,
    }),
  });

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try { const j = await response.json(); msg = j.error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  const contentType = response.headers.get('content-type') ?? '';

  // Streaming path
  if (contentType.includes('text/event-stream') && onChunk) {
    const done = await parseSSEStream(response, onChunk);
    return {
      reply: done.r,
      movies: done.m,
      shows: done.s,
      movieYears: done.my,
      showYears: done.sy,
      modelUsed: done.mu,
      tmdbIds: [],
      movieIds: [],
      tvIds: [],
    };
  }

  // Fallback: non-streaming JSON (shouldn't happen with current edge function)
  const data = await response.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function summariseConversation(
  messages: ChatMessage[],
  model?: string,
): Promise<string> {
  if (messages.length < 2) return '';

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { action: 'summarise', messages, model },
  });

  if (error) return '';
  return data?.summary ?? '';
}
