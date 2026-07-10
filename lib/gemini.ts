import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TraktWatchedMovie, TraktWatchedShow } from './trakt';
import { GENRE_NAMES } from './tasteDna';
import type { TasteDNA } from './tasteDna';

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
  alreadyRecommended: string[] = [],
  favoriteGenres: number[] = [],
  tasteDNA?: TasteDNA,
): string {
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Temporal context — shapes recommendation mood
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late night';
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const month = now.getMonth() + 1;
  const specialPeriod = month === 10 ? ' — Halloween and horror season' : month === 12 ? ' — festive season' : month <= 2 ? ' — awards season' : '';
  const temporalNote = `Current context: ${dayName} ${timeOfDay}${specialPeriod}. Let this subtly inform mood and tone.`;

  // Recent watches (last 30 movies / 20 shows by date)
  const sortedMovies = [...watchedMovies].sort(
    (a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
  );
  const sortedShows = [...watchedShows].sort(
    (a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
  );

  const recentMovies = sortedMovies.slice(0, 30).map(m => `${m.movie.title} (${m.movie.year})`).join(', ');
  const recentShows = sortedShows.slice(0, 20).map(s => `${s.show.title} (${s.show.year})`).join(', ');

  // Most-replayed content — strongest signal for genuine taste (play count > 1 = rewatched)
  const lovedMovies = [...watchedMovies]
    .filter(m => m.plays > 1)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 8)
    .map(m => `${m.movie.title} (×${m.plays})`)
    .join(', ');

  // For TV: cap plays at 20 to prevent episode-heavy shows dominating; filter shows they got deep into
  const lovedShows = [...watchedShows]
    .sort((a, b) => Math.min(b.plays, 20) - Math.min(a.plays, 20))
    .slice(0, 6)
    .map(s => `${s.show.title} (${Math.min(s.plays, 20)} eps)`)
    .join(', ');

  const hasHistory = !!(recentMovies || recentShows);

  // Genre DNA from computed affinity scores — most precise taste signal available
  let genreDnaSection = '';
  if (tasteDNA?.genreAffinity && Object.keys(tasteDNA.genreAffinity).length > 0) {
    const sorted = Object.entries(tasteDNA.genreAffinity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
    const total = sorted.reduce((sum, [, w]) => sum + w, 0);
    if (total > 0) {
      const dist = sorted
        .map(([id, w]) => `${GENRE_NAMES[Number(id)] ?? `genre-${id}`} ${Math.round((w / total) * 100)}%`)
        .join(', ');
      genreDnaSection = `\nGENRE DNA (computed from full viewing history — use as the primary filter for every recommendation):\n${dist}\n`;
    }
  } else if (!hasHistory && favoriteGenres.length > 0) {
    genreDnaSection = `\nStated genre preferences: ${favoriteGenres.map(id => GENRE_NAMES[id] ?? `Genre ${id}`).join(', ')}\n`;
  }

  const historySection = hasHistory ? `
VIEWING HISTORY (from Trakt — do not recommend titles already here):
- Recently watched movies: ${recentMovies || 'none'}
- Recently watched TV: ${recentShows || 'none'}
${lovedMovies ? `- Most rewatched movies (genuine favourites): ${lovedMovies}` : ''}
${lovedShows ? `- Most-watched TV shows (deepest engagement): ${lovedShows}` : ''}
` : '';

  const excludeSection = alreadyRecommended.length > 0
    ? `\nALREADY RECOMMENDED (do not suggest again — includes prior sessions):\n${alreadyRecommended.join(', ')}\n`
    : '';

  // Cinematic identity — computed deterministically from viewing behaviour
  const dnaSection = tasteDNA ? (() => {
    const p = tasteDNA.profile;
    if (!p) return '';

    const eraTop = Object.entries(p.eraAffinity).sort(([, a], [, b]) => b - a)[0];
    const eraLabel = eraTop[0] === 'classic'
      ? `classic/pre-1990 (${Math.round(eraTop[1] * 100)}% of history)`
      : eraTop[0] === 'nineties'
      ? `90s cinema (${Math.round(eraTop[1] * 100)}% of history)`
      : `contemporary/post-2000 (${Math.round(eraTop[1] * 100)}% of history)`;

    const darkness = p.darknessScore;
    const toneLabel = darkness > 0.65
      ? 'dark, morally complex, bleak — actively prefers difficult content'
      : darkness > 0.40
      ? 'balanced with a pull toward moral complexity and tension'
      : darkness < 0.20
      ? 'light, accessible — avoid gratuitously dark or disturbing content'
      : 'moderate tone, comfortable with occasional darkness';

    const prestige = p.prestigeScore;
    const prestigeLabel = prestige > 0.70
      ? 'very high — almost exclusively watches acclaimed, award-circuit or critically-championed titles'
      : prestige > 0.50
      ? 'high — strongly prefers well-reviewed, substantive work over populist fare'
      : prestige > 0.30
      ? 'moderate — appreciates quality but open to mainstream picks'
      : 'mainstream-leaning — prioritise recognisable, broadly popular titles';

    const novelty = p.noveltyTolerance;
    const noveltyLabel = novelty > 0.60
      ? 'high novelty tolerance — actively seeks out lesser-known, under-the-radar titles'
      : novelty < 0.25
      ? 'low novelty tolerance — stick to well-known, widely-seen titles'
      : 'moderate — one discovery title per batch is enough';

    const pacing = p.pacingPreference;
    const pacingLabel = pacing === 'slow'
      ? 'slow-burn, patient storytelling — avoid rapid-cut action or pure crowd-pleasers'
      : pacing === 'fast'
      ? 'fast-paced, kinetic — avoid slow arthouse or contemplative films'
      : 'medium pacing — comfortable across a range of styles';

    return `
CINEMATIC IDENTITY (computed from full viewing history — treat as authoritative):
- Tone preference: ${toneLabel}
- Prestige affinity: ${prestigeLabel}
- Discovery appetite: ${noveltyLabel}
- Pacing preference: ${pacingLabel}
- Era: ${eraLabel}
- Taste summary: ${tasteDNA.tasteProfile || 'eclectic cinephile'}
${p.emotionalProfile?.length ? `- Emotional register: ${p.emotionalProfile.join(', ')}` : ''}
${tasteDNA.thematicInterests?.length ? `- Thematic interests: ${tasteDNA.thematicInterests.join(', ')}` : ''}
${tasteDNA.recentShift ? `- Recent taste shift detected: ${tasteDNA.recentShift}` : ''}

Every recommendation must pass through this identity. Do not default to generic popular titles — calibrate to this specific viewer.`;
  })() : '';

  // Language tolerance: if the user has watched non-English content, note it
  const hasNonEnglishHistory = [...watchedMovies, ...watchedShows].some(item => {
    const title = 'movie' in item ? item.movie.title : item.show.title;
    // Simple heuristic: if they've watched known non-English flagships
    return false; // Conservative — let the history speak for itself
  });
  const languageNote = hasHistory
    ? 'Foreign-language films/shows: recommend if the viewing history includes non-English content, or if the user asks.'
    : 'English-language by default unless the user requests otherwise.';

  return `You are NextUp — a premium cinematic concierge, not a chatbot.
You understand film and television at depth: genre, tone, pacing, craft, emotional register, director sensibility, cultural weight.
Today is ${today}. When users mention time ("this year", "last 6 months", "recent"), calculate the date range from today.
${temporalNote}
${genreDnaSection}${historySection}${dnaSection}${excludeSection}
VOICE:
- Speak like a knowledgeable friend who knows THIS SPECIFIC VIEWER deeply. Confident, precise, never generic.
- No filler openers: never "Great question!", "Of course!", "Absolutely!", "Sure!", "Certainly!".
- No intro paragraph. Skip it entirely. Go straight to the recommendations.
- The entire focus is WHY they specifically will love this — not what it is. "Your crime DNA and pull toward moral darkness puts you in Villeneuve's lane" beats "This is a tense crime thriller."
- Every sentence must be earned by their actual data: genre DNA percentages, tone preference, pacing, era affinity. If you know they're 40% crime and high prestige, say that. If they're a slow-burn arthouse watcher, speak to their pacing directly.
- Trust that the user has seen a lot. Be specific. Generic praise ("acclaimed", "critically loved") means nothing — say why it earns its place for THIS person.

QUALITY:
- Only titles with strong reception: 7.0+ TMDB rating, 500+ votes minimum.
- No obscure, adult, exploitation, or direct-to-video releases.
- ${languageNote}
- Match discovery depth to their novelty tolerance (see cinematic identity above).

FORMAT (recommendations):
- Include 3–5 titles.
- No intro paragraph. Start immediately with the first title.
- For each title: write the exact title name, then " — ", then one sentence (two max) explaining specifically why this viewer will love it. Ground every word in their taste profile. New line between each entry.
- Example reply format:
  "Sicario — Your crime DNA and pull toward moral darkness puts you in Villeneuve's lane. The controlled dread is exactly what your most-watched titles share.\n\nThe Americans — Matches your high-prestige, slow-burn TV preference almost exactly. Cold War moral weight, patient pacing."
- Title names in the reply must match the arrays exactly — this enables tapping through to the title page.
- movies array: "Title (YEAR)" format. shows array: "Title (YEAR)" format. Never mix the two arrays.
- If asked about one specific title: 2–3 sentences on why it fits this viewer's taste specifically. No list needed.

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
  alreadyRecommended: string[] = [],
  favoriteGenres: number[] = [],
  tasteDNA?: TasteDNA,
): Promise<GeminiReply> {
  const key = validateKey(apiKey);
  const genAI = new GoogleGenerativeAI(key);
  const systemInstruction = buildSystemPrompt(watchedMovies, watchedShows, alreadyRecommended, favoriteGenres, tasteDNA);

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

