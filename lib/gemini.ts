import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

export interface GeminiReply {
  reply: string;
  tmdbIds: number[];
  modelUsed: string;
}

// Model preference order. First model that responds successfully wins.
// Add newer models to the top; remove deprecated ones from the bottom.
const MODEL_CASCADE = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
] as const;

// ─── Key validation ───────────────────────────────────────────────────────────

function validateKey(raw: string): string {
  const key = raw.trim().replace(/[\n\r\t]/g, '');
  if (!key) {
    throw new Error('No Gemini API key configured. Add one in Settings.');
  }
  return key;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

// Call this to print all models the key can access. Useful for debugging.
export async function logAvailableModels(apiKey: string): Promise<void> {
  try {
    const key = validateKey(apiKey);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );
    const data: any = await res.json();
    if (data.error) {
      console.warn('[Gemini:listModels] Error:', data.error.status, data.error.message);
      return;
    }
    const names: string[] = (data.models ?? []).map((m: any) => m.name as string);
    console.log('[Gemini:listModels] All available models:', names);
    console.log(
      '[Gemini:listModels] Flash models:',
      names.filter((n) => n.toLowerCase().includes('flash'))
    );
  } catch (e) {
    console.warn('[Gemini:listModels] Failed to fetch model list:', e);
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  watchedMovies: TraktWatchedMovie[],
  watchedShows: TraktWatchedShow[]
): string {
  const recentMovies = watchedMovies
    .sort(
      (a, b) =>
        new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
    )
    .slice(0, 30)
    .map((m) => `${m.movie.title} (${m.movie.year})`)
    .join(', ');

  const recentShows = watchedShows
    .sort(
      (a, b) =>
        new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
    )
    .slice(0, 20)
    .map((s) => `${s.show.title} (${s.show.year})`)
    .join(', ');

  const historySection =
    recentMovies || recentShows
      ? `
The user's recent watch history from Trakt:
- Movies watched: ${recentMovies || 'none recorded'}
- TV shows watched: ${recentShows || 'none recorded'}

Use this history to personalise your recommendations. Identify their taste — genres, themes, directors, eras — and suggest titles they're likely to enjoy but haven't seen yet.`
      : '';

  return `You are NextUp AI, a knowledgeable and personable entertainment guide.
Your job is to help users decide what to watch next — movies and TV shows.
${historySection}

When making recommendations:
1. Be conversational and enthusiastic but concise.
2. Always include 3–5 specific title recommendations when relevant.
3. For each recommendation you make, include its TMDB ID in the tmdbIds array so the app can fetch posters and details.
4. Focus on movies AND TV shows unless the user specifies one.
5. If the user asks about a specific title, give a brief review or explanation.

You can also mention the AI Search addon for Stremio (https://stremio.itcon.au/aisearch/configure) as a way for users to discover AI-curated content directly inside Stremio.

CRITICAL: Output ONLY a raw JSON object. No prose before it, no prose after it, no markdown, no code fences, no explanation outside the JSON.
The JSON must have exactly this shape:
{"reply":"your conversational message here","tmdbIds":[12345,67890]}`;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseResponse(rawText: string): Omit<GeminiReply, 'modelUsed'> {
  // Strip markdown code fences if present
  const stripped = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  // Try parsing the whole stripped string first
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed.reply === 'string') {
      return {
        reply: parsed.reply,
        tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds : [],
      };
    }
  } catch {}

  // Gemini sometimes outputs prose before the JSON — find the embedded JSON object
  const jsonMatch = stripped.match(/\{[\s\S]*?"reply"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed.reply === 'string') {
        return {
          reply: parsed.reply,
          tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds : [],
        };
      }
    } catch {}
  }

  // Last resort: use the raw text but strip any markdown bold markers
  const plain = rawText.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  return { reply: plain, tmdbIds: [] };
}

// ─── Model fallback detection ─────────────────────────────────────────────────

function isModelUnavailableError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? '');
  return (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('MODEL_NOT_FOUND') ||
    msg.includes('not supported') ||
    msg.includes('deprecated') ||
    msg.includes('INVALID_ARGUMENT')
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function askGemini(
  apiKey: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  watchedMovies: TraktWatchedMovie[] = [],
  watchedShows: TraktWatchedShow[] = []
): Promise<GeminiReply> {
  const key = validateKey(apiKey);
  const genAI = new GoogleGenerativeAI(key);
  const systemInstruction = buildSystemPrompt(watchedMovies, watchedShows);

  // Gemini requires chat history to start with 'user'. Drop any leading assistant messages.
  const allHistory = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));
  const firstUserIdx = allHistory.findIndex((m) => m.role === 'user');
  const history = firstUserIdx >= 0 ? allHistory.slice(firstUserIdx) : [];
  const lastMessage = messages[messages.length - 1];

  let lastError: unknown;

  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const modelId = MODEL_CASCADE[i];
    console.log(`[Gemini] Trying model ${i + 1}/${MODEL_CASCADE.length}: ${modelId}`);

    try {
      const model = genAI.getGenerativeModel({ model: modelId, systemInstruction });
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const parsed = parseResponse(result.response.text().trim());
      console.log(`[Gemini] Success with model: ${modelId}`);
      return { ...parsed, modelUsed: modelId };
    } catch (e) {
      lastError = e;
      const errMsg = String((e as any)?.message ?? '').slice(0, 120);
      console.warn(`[Gemini] Model ${modelId} failed: ${errMsg}`);

      const isLast = i === MODEL_CASCADE.length - 1;
      if (!isLast && isModelUnavailableError(e)) {
        console.log(`[Gemini] Model unavailable — trying next fallback...`);
        continue;
      }
      throw e;
    }
  }

  throw lastError;
}
