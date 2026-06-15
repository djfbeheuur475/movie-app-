import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';

export interface GeminiReply {
  reply: string;
  movies: string[];      // movie titles (may include year suffix stripped before search)
  shows: string[];       // TV show titles
  movieYears: (number | null)[];  // year for each movie (parsed from "Title (YEAR)" format)
  showYears: (number | null)[];   // year for each show
  modelUsed: string;
  tmdbIds: number[];
  movieIds: number[];
  tvIds: number[];
}

// Model preference order. First model that responds successfully wins.
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

  // Temporal context — shapes recommendation mood
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late night';
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const month = now.getMonth() + 1;
  const specialPeriod = month === 10 ? ' — Halloween and horror season' : month === 12 ? ' — festive season' : month <= 2 ? ' — awards season' : '';
  const temporalNote = `Current context: ${dayName} ${timeOfDay}${specialPeriod}. Let this subtly inform the mood and tone of your recommendations.`;

  const historySection =
    recentMovies || recentShows
      ? `The user's recent watch history from Trakt:
- Movies: ${recentMovies || 'none recorded'}
- TV shows: ${recentShows || 'none recorded'}

Use this to personalise precisely — identify taste patterns, connect recommendations to what they've actually watched.`
      : '';

  const excludeSection = alreadyRecommended.length > 0
    ? `\nDO NOT recommend any of these (already suggested — includes prior sessions):\n${alreadyRecommended.join(', ')}\nAlways suggest completely fresh titles.\n`
    : '';

  return `You are NextUp — a premium cinematic concierge, not a chatbot.
You understand film and television at depth: genre, tone, pacing, craft, emotional register, director sensibility, cultural weight.
Today is ${today}. When users mention time ("this year", "last 6 months", "recent"), calculate the date range from today.
${temporalNote}
${historySection}${excludeSection}
VOICE:
- Speak like a knowledgeable friend who knows cinema deeply. Confident, precise, never generic.
- No filler: never open with "Great question!", "Of course!", "Absolutely!", "Sure!", "Certainly!".
- No lengthy preambles — get to the curation.
- Write 2–4 tight sentences of context, then the titles. Shorter is better.
- Connect each title to this viewer's specific taste — reference their history, the mood, the theme. No generic plot summaries.
- Trust that the user has seen a lot. Be specific about what earns each title its place.

QUALITY:
- Only titles with strong reception: 7.0+ TMDB rating, 500+ votes minimum.
- No obscure, adult, exploitation, or direct-to-video releases.
- English-language by default. Foreign cinema only if they ask or their history shows that preference.
- Mainstream and recognisable for the core picks, 1–2 discovery titles maximum.

FORMAT:
- Include 3–5 titles when asked for recommendations.
- movies array: include year in parentheses — "Title (YEAR)". Example: ["Sicario (2015)", "Blade Runner 2049 (2017)"]. Recommendations first, then any comparison references.
- shows array: include year in parentheses — "Title (YEAR)". Example: ["The Wire (2002)"]. Never mix movies and shows.
- If asked about one specific title: give a sharp 2–3 sentence take. No list needed.

CRITICAL: Output ONLY a raw JSON object. No prose before or after it. No markdown. No code fences.
{"reply":"your curation message here","movies":["Title One (2019)","Title Two (2021)",...],"shows":["Show One (2018)","Show Two (2022)",...]}`;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseResponse(rawText: string): Omit<GeminiReply, 'modelUsed'> {
  const stripped = rawText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();

  const emptyIds = { tmdbIds: [] as number[], movieIds: [] as number[], tvIds: [] as number[] };

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

  // Parse "Title (YEAR)" format — extracts clean title + year for each entry
  function parseTitlesWithYears(raw: string[]): { titles: string[]; years: (number | null)[] } {
    const titles: string[] = [];
    const years: (number | null)[] = [];
    for (const entry of raw) {
      const m = entry.match(/^(.*?)\s*\((\d{4})\)\s*$/);
      if (m) {
        titles.push(m[1].trim());
        years.push(parseInt(m[2], 10));
      } else {
        titles.push(entry.trim());
        years.push(null);
      }
    }
    return { titles, years };
  }

  const rawMovies = getStringArray(stripped, 'movies');
  const rawShows = getStringArray(stripped, 'shows');
  const { titles: movies, years: movieYears } = parseTitlesWithYears(rawMovies);
  const { titles: shows, years: showYears } = parseTitlesWithYears(rawShows);

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
              const innerMovies = parseTitlesWithYears(getStringArray(inner, 'movies'));
              const innerShows = parseTitlesWithYears(getStringArray(inner, 'shows'));
              return {
                reply: cleanMd(p2.reply),
                movies: innerMovies.titles, movieYears: innerMovies.years,
                shows: innerShows.titles, showYears: innerShows.years,
                ...emptyIds,
              };
            }
          } catch {}
        }
        return { reply: cleanMd(p.reply), movies, movieYears, shows, showYears, ...emptyIds };
      }
    } catch {
      const extracted = extractReplyText(jsonBlock);
      if (extracted) return { reply: cleanMd(extracted), movies, movieYears, shows, showYears, ...emptyIds };
    }
  }

  // 2. Final fallback — strip JSON wrapper and return plain text
  const plain = stripped
    .replace(/^\s*\{?\s*"reply"\s*:\s*"/, '')
    .replace(/",?\s*"(?:movies|shows|movieIds|tvIds|tmdbIds)"\s*:[\s\S]*$/, '')
    .replace(/"\s*}\s*$/, '');
  return { reply: cleanMd(plain) || cleanMd(stripped), movies, movieYears, shows, showYears, ...emptyIds };
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
      console.log(`[Gemini] Trying next fallback...`);
      continue;
    }
  }

  throw lastError;
}

// ─── Conversation summarisation ───────────────────────────────────────────────
// Condenses older conversation turns into a compact summary for the system prompt.
// Called when the chat grows beyond MAX_HISTORY_TURNS to cap token growth.

export async function summariseConversation(
  apiKey: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const key = apiKey.trim().replace(/[\n\r\t]/g, '');
  if (!key || messages.length < 2) return '';

  const genAI = new GoogleGenerativeAI(key);
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'NextUp'}: ${m.content}`)
    .join('\n');

  const prompt = `Summarise this film/TV recommendation conversation in 2–3 concise sentences.
Include: the viewer's stated mood or criteria, any genres/directors/themes they mentioned,
and which specific titles were recommended. Be terse — this summary is injected into a system prompt.

Conversation:
${transcript}

Summary:`;

  for (const modelId of MODEL_CASCADE) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch {
      continue;
    }
  }
  return '';
}

