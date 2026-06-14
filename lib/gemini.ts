import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

export interface GeminiReply {
  reply: string;
  movies: string[];    // movie titles to resolve via TMDB search
  shows: string[];     // TV show titles to resolve via TMDB search
  modelUsed: string;
  // Legacy number-ID fields kept for backward compat (now always empty for chat)
  tmdbIds: number[];
  movieIds: number[];
  tvIds: number[];
}

export interface HomePicksResult {
  movieIds: number[];
  tvIds: number[];
  modelUsed: string;
}

// Model preference order. First model that responds successfully wins.
const MODEL_CASCADE = [
  'gemini-2.5-flash-preview-05-20',
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
  watchedShows: TraktWatchedShow[],
  alreadyRecommended: string[] = []
): string {
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
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

  const excludeSection = alreadyRecommended.length > 0
    ? `\nALREADY SUGGESTED THIS SESSION — do NOT recommend any of these again, even if the user asks for "more" or "different" options:\n${alreadyRecommended.join(', ')}\nAlways suggest fresh titles that are not on this list.\n`
    : '';

  return `You are NextUp AI, a knowledgeable and personable entertainment guide.
Your job is to help users decide what to watch next — movies and TV shows.
Today's date is ${today}. When users ask about recent content (e.g. "last 12 months", "this year", "new releases"), calculate the date range relative to today's date.
${historySection}${excludeSection}

QUALITY RULES — always follow these:
- Only recommend titles with strong audience reception (ideally 7.0+ on TMDB, at minimum 5.5+ with 500+ votes).
- Never recommend obscure titles with very low vote counts (under 200 votes).
- Never recommend adult, erotic, exploitation, or pornographic content.
- Prioritise English-language titles unless the user asks for foreign cinema or their history shows foreign film preferences.
- Prefer mainstream, recognisable titles for the core recommendations, with 1-2 discovery picks mixed in.
- Recommend across genre and tone variety — avoid recommending the same genre repeatedly.

When making recommendations:
1. Be conversational and enthusiastic but concise.
2. Always include 3–5 specific title recommendations when relevant. For each recommended title, include 1–2 sentences explaining why it suits this particular user — connect it to something in their watch history or the vibe they asked for. Keep the blurbs tight and personal, not generic plot summaries.
3. In the movies array, list the exact title of every movie you mention by name — your direct recommendations first, then any films you reference as comparisons or examples. In the shows array, do the same for every TV show. Use only the title (no year, no description). Never put movies in shows or vice versa.
4. Only recommend English-language mainstream titles (Hollywood, British, Australian) with strong audience reception. No foreign-language, obscure, or low-budget titles.
5. If the user asks about a specific title, give a brief review or explanation.
6. When recommending without a specific request, default to well-known, critically respected titles with broad appeal.

CRITICAL: Output ONLY a raw JSON object. No prose before it, no prose after it, no markdown, no code fences, no explanation outside the JSON.
The JSON must have exactly this shape:
{"reply":"your conversational message here","movies":["Title One","Title Two",...],"shows":["Show One","Show Two",...]}`;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseResponse(rawText: string): Omit<GeminiReply, 'modelUsed'> {
  const stripped = rawText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();

  const emptyIds = { tmdbIds: [], movieIds: [], tvIds: [] };

  function cleanMd(text: string): string {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim();
  }

  // Extract a JSON string array by field name — works on malformed JSON too
  function getStringArray(text: string, field: string): string[] {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!match || !match[1].trim()) return [];
    const items: string[] = [];
    const itemRe = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = itemRe.exec(match[1])) !== null) {
      const title = m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
      if (title) items.push(title);
    }
    return items;
  }

  // Extract reply text using string markers — handles unescaped quotes in reply content
  function extractReplyText(jsonBlock: string): string | null {
    const keyIdx = jsonBlock.indexOf('"reply"');
    if (keyIdx === -1) return null;
    const colonIdx = jsonBlock.indexOf(':', keyIdx + 7);
    if (colonIdx === -1) return null;
    const quoteStart = jsonBlock.indexOf('"', colonIdx + 1);
    if (quoteStart === -1) return null;
    const afterOpen = jsonBlock.slice(quoteStart + 1);
    const endMarkers = ['","movies"', '","shows"', '","movieIds"', '","tvIds"', '","tmdbIds"'];
    let endIdx = -1;
    for (const marker of endMarkers) {
      const idx = afterOpen.indexOf(marker);
      if (idx !== -1 && (endIdx === -1 || idx < endIdx)) endIdx = idx;
    }
    const raw = endIdx !== -1
      ? afterOpen.slice(0, endIdx)
      : afterOpen.replace(/"\s*}?\s*$/, '');
    if (!raw) return null;
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
  }

  const movies = getStringArray(stripped, 'movies');
  const shows = getStringArray(stripped, 'shows');

  // 1. Try proper JSON parse
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const jsonBlock = stripped.slice(first, last + 1);
    try {
      const p = JSON.parse(jsonBlock);
      if (p && typeof p.reply === 'string') {
        // Handle double-encoded reply
        const inner = p.reply.trim();
        if (inner.startsWith('{')) {
          try {
            const p2 = JSON.parse(inner);
            if (p2?.reply) {
              return {
                reply: cleanMd(p2.reply),
                movies: getStringArray(inner, 'movies'),
                shows: getStringArray(inner, 'shows'),
                ...emptyIds,
              };
            }
          } catch {}
        }
        return { reply: cleanMd(p.reply), movies, shows, ...emptyIds };
      }
    } catch {
      const extracted = extractReplyText(jsonBlock);
      if (extracted) return { reply: cleanMd(extracted), movies, shows, ...emptyIds };
    }
  }

  // 2. Final fallback — strip JSON wrapper and return plain text
  const plain = stripped
    .replace(/^\s*\{?\s*"reply"\s*:\s*"/, '')
    .replace(/",?\s*"(?:movies|shows|movieIds|tvIds|tmdbIds)"\s*:[\s\S]*$/, '')
    .replace(/"\s*}\s*$/, '');
  return { reply: cleanMd(plain) || cleanMd(stripped), movies, shows, ...emptyIds };
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
  watchedShows: TraktWatchedShow[] = [],
  alreadyRecommended: string[] = []
): Promise<GeminiReply> {
  const key = validateKey(apiKey);
  const genAI = new GoogleGenerativeAI(key);
  const systemInstruction = buildSystemPrompt(watchedMovies, watchedShows, alreadyRecommended);

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
      if (isLast) throw e;
      // Always try the next model — rate limits and quota errors should fall through too
      console.log(`[Gemini] Trying next fallback...`);
      continue;
    }
  }

  throw lastError;
}

// ─── Home picks — single call for both movies + TV ────────────────────────────

export async function askGeminiForHomePicks(
  apiKey: string,
  watchedMovies: TraktWatchedMovie[] = [],
  watchedShows: TraktWatchedShow[] = []
): Promise<HomePicksResult> {
  const key = validateKey(apiKey);
  const genAI = new GoogleGenerativeAI(key);

  const sortedMovies = watchedMovies
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());

  const sortedShows = watchedShows
    .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());

  const recentMovies = sortedMovies.slice(0, 50).map((m) => `${m.movie.title} (${m.movie.year})`).join(', ');
  const recentShows = sortedShows.slice(0, 35).map((s) => `${s.show.title} (${s.show.year})`).join(', ');

  const hasHistory = recentMovies || recentShows;

  const prompt = hasHistory
    ? `You are a world-class entertainment recommendation engine.

The user's watch history (most recent first):
MOVIES WATCHED: ${recentMovies || 'none'}
TV SHOWS WATCHED: ${recentShows || 'none'}

Before recommending, internally analyse their taste:
- What genres appear most (e.g. crime, sci-fi, drama, comedy)?
- What tone do they prefer (dark/intense vs light/fun vs emotional)?
- What era/decade do they gravitate toward?
- What quality level — mostly prestige/acclaimed or also mainstream blockbusters?
- Any recurring themes, styles, or director sensibilities?

Then recommend exactly 60 movies AND exactly 60 TV shows using that analysis. Every title must:
1. NOT appear anywhere in the watch history above
2. Be English-language (Hollywood, British, Australian, Canadian) — no subtitles, no foreign-language films unless their history clearly shows that preference
3. Be mainstream and recognisable — no obscure, arthouse, direct-to-video, or micro-budget releases
4. Have a TMDB rating of 7.0+ and at least 5,000 votes (movies) / 2,000 votes (TV)
5. Genuinely match the taste patterns you identified — if they love dark crime dramas, recommend dark crime dramas
6. Span a variety of genres, tones, and decades — do not cluster everything in one style
7. Be the kind of title Netflix or HBO would confidently promote

Reply with ONLY this JSON — no markdown, no explanation, nothing else before or after it:
{"movieIds":[tmdb_movie_id,...],"tvIds":[tmdb_tv_show_id,...]}`
    : `You are a world-class entertainment recommendation engine.

Recommend exactly 60 must-watch movies AND exactly 60 must-watch TV shows for someone with no history yet.

Every title must:
1. Be English-language (Hollywood, British, Australian, Canadian)
2. Be a widely-recognised mainstream title — the kind Netflix or HBO would prominently feature
3. Have a TMDB rating of 7.5+ and at least 10,000 votes
4. Span a variety of genres: thriller, drama, crime, sci-fi, action, comedy, horror — no single genre should dominate
5. Include a mix of modern hits (2010s–present) and beloved classics
6. No adult content, exploitation, B-movies, or direct-to-video releases

Reply with ONLY this JSON — no markdown, no explanation, nothing else before or after it:
{"movieIds":[tmdb_movie_id,...],"tvIds":[tmdb_tv_show_id,...]}`;

  let lastError: unknown;

  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    const modelId = MODEL_CASCADE[i];
    console.log(`[HomePicks] Trying model ${i + 1}/${MODEL_CASCADE.length}: ${modelId}`);
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const first = stripped.indexOf('{');
      const last = stripped.lastIndexOf('}');
      if (first !== -1 && last > first) {
        const parsed = JSON.parse(stripped.slice(first, last + 1));
        const movieIds: number[] = Array.isArray(parsed.movieIds)
          ? parsed.movieIds.filter((x: unknown) => typeof x === 'number')
          : [];
        const tvIds: number[] = Array.isArray(parsed.tvIds)
          ? parsed.tvIds.filter((x: unknown) => typeof x === 'number')
          : [];
        console.log(`[HomePicks] Success: ${movieIds.length} movies, ${tvIds.length} TV via ${modelId}`);
        return { movieIds, tvIds, modelUsed: modelId };
      }
      // Couldn't parse JSON — try next model
      lastError = new Error('No parseable JSON in response');
      if (i < MODEL_CASCADE.length - 1) continue;
    } catch (e) {
      lastError = e;
      const msg = String((e as any)?.message ?? '').slice(0, 120);
      console.warn(`[HomePicks] Model ${modelId} failed: ${msg}`);
      if (i < MODEL_CASCADE.length - 1) continue;
    }
  }

  console.warn('[HomePicks] All models failed, returning empty');
  return { movieIds: [], tvIds: [], modelUsed: 'none' };
}
