import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

export interface GeminiReply {
  reply: string;
  tmdbIds: number[];
}

function buildSystemPrompt(
  watchedMovies: TraktWatchedMovie[],
  watchedShows: TraktWatchedShow[]
): string {
  const recentMovies = watchedMovies
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
    .slice(0, 30)
    .map((m) => `${m.movie.title} (${m.movie.year})`)
    .join(', ');

  const recentShows = watchedShows
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
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

Respond in JSON with this exact format:
{ "reply": "your message here", "tmdbIds": [12345, 67890] }`;
}

// Update this string to use a newer model when released. Aliases:
// gemini-2.5-flash, gemini-2.5-pro, gemini-flash-latest, gemini-pro-latest
const GEMINI_MODEL = 'gemini-2.5-flash';

export async function askGemini(
  apiKey: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  watchedMovies: TraktWatchedMovie[] = [],
  watchedShows: TraktWatchedShow[] = []
): Promise<GeminiReply> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: buildSystemPrompt(watchedMovies, watchedShows),
  });

  // Convert message history to Gemini format.
  // Gemini requires history to start with 'user', so drop any leading assistant messages.
  const allHistory = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));
  const firstUserIdx = allHistory.findIndex((m) => m.role === 'user');
  const history = firstUserIdx >= 0 ? allHistory.slice(firstUserIdx) : [];

  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  const text = result.response.text().trim();

  // Parse JSON response
  try {
    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      reply: parsed.reply ?? text,
      tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds : [],
    };
  } catch {
    return { reply: text, tmdbIds: [] };
  }
}
