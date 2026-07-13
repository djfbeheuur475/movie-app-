import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "qwen/qwen3-14b";
const FALLBACK_MODEL = "qwen/qwen3-8b";
const DAILY_LIMIT = 100;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENRE_NAMES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage { role: "user" | "assistant"; content: string }
interface WatchedMovie { movie: { title: string; year: number }; plays: number; last_watched_at: string }
interface WatchedShow { show: { title: string; year: number }; plays: number; last_watched_at: string }
interface TasteProfile {
  eraAffinity: Record<string, number>; darknessScore: number; prestigeScore: number;
  noveltyTolerance: number; pacingPreference: string; emotionalProfile?: string[];
}
interface TasteDNA {
  tasteProfile?: string; genreAffinity?: Record<string, number>;
  profile?: TasteProfile | null; thematicInterests?: string[]; recentShift?: string;
}
interface AIReply {
  reply: string; movies: string[]; shows: string[];
  movieYears: (number | null)[]; showYears: (number | null)[];
  modelUsed: string; tmdbIds: number[]; movieIds: number[]; tvIds: number[];
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  watchedMovies: WatchedMovie[], watchedShows: WatchedShow[],
  alreadyRecommended: string[], favoriteGenres: number[], tasteDNA?: TasteDNA | null,
): string {
  const today = new Date().toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "late night";
  const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()];
  const month = now.getMonth() + 1;
  const specialPeriod = month === 10 ? " — Halloween and horror season" : month === 12 ? " — festive season" : month <= 2 ? " — awards season" : "";
  const temporalNote = `Current context: ${dayName} ${timeOfDay}${specialPeriod}. Let this subtly inform mood and tone.`;

  const sortedMovies = [...watchedMovies].sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());
  const sortedShows = [...watchedShows].sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime());
  const recentMovies = sortedMovies.slice(0, 60).map((m) => `${m.movie.title} (${m.movie.year})`).join(", ");
  const recentShows = sortedShows.slice(0, 50).map((s) => `${s.show.title} (${s.show.year})`).join(", ");
  const lovedMovies = [...watchedMovies].filter((m) => m.plays > 1).sort((a, b) => b.plays - a.plays).slice(0, 15).map((m) => `${m.movie.title} (×${m.plays})`).join(", ");
  const lovedShows = [...watchedShows].sort((a, b) => Math.min(b.plays, 20) - Math.min(a.plays, 20)).slice(0, 12).map((s) => `${s.show.title} (${Math.min(s.plays, 20)} eps)`).join(", ");
  const hasHistory = !!(recentMovies || recentShows);

  let genreDnaSection = "";
  const genreAffinity = tasteDNA?.genreAffinity ?? {};
  if (Object.keys(genreAffinity).length > 0) {
    const sorted = Object.entries(genreAffinity).sort(([, a], [, b]) => b - a).slice(0, 8);
    const total = sorted.reduce((sum, [, w]) => sum + w, 0);
    if (total > 0) {
      const dist = sorted.map(([id, w]) => `${GENRE_NAMES[Number(id)] ?? `genre-${id}`} ${Math.round((w / total) * 100)}%`).join(", ");
      genreDnaSection = `\nGENRE DNA (computed from full viewing history — use as the primary filter for every recommendation):\n${dist}\n`;
    }
  } else if (!hasHistory && favoriteGenres.length > 0) {
    genreDnaSection = `\nStated genre preferences: ${favoriteGenres.map((id) => GENRE_NAMES[id] ?? `Genre ${id}`).join(", ")}\n`;
  }

  const historySection = hasHistory ? `\nVIEWING HISTORY (from Trakt — do not recommend titles already here):\n- Recently watched movies: ${recentMovies || "none"}\n- Recently watched TV: ${recentShows || "none"}\n${lovedMovies ? `- Most rewatched movies (genuine favourites): ${lovedMovies}` : ""}\n${lovedShows ? `- Most-watched TV shows (deepest engagement): ${lovedShows}` : ""}\n` : "";
  const excludeSection = alreadyRecommended.length > 0 ? `\nALREADY RECOMMENDED (do not suggest again — includes prior sessions):\n${alreadyRecommended.join(", ")}\n` : "";

  const dnaSection = (() => {
    const p = tasteDNA?.profile;
    if (!p) return "";
    const eraEntries = Object.entries(p.eraAffinity ?? {}).sort(([, a], [, b]) => b - a);
    if (!eraEntries.length) return "";
    const eraTop = eraEntries[0];
    const eraLabel = eraTop[0] === "classic" ? `classic/pre-1990 (${Math.round(eraTop[1] * 100)}% of history)` : eraTop[0] === "nineties" ? `90s cinema (${Math.round(eraTop[1] * 100)}% of history)` : `contemporary/post-2000 (${Math.round(eraTop[1] * 100)}% of history)`;
    const darkness = p.darknessScore ?? 0.5;
    const toneLabel = darkness > 0.65 ? "dark, morally complex, bleak — actively prefers difficult content" : darkness > 0.40 ? "balanced with a pull toward moral complexity and tension" : darkness < 0.20 ? "light, accessible — avoid gratuitously dark or disturbing content" : "moderate tone, comfortable with occasional darkness";
    const prestige = p.prestigeScore ?? 0.5;
    const prestigeLabel = prestige > 0.70 ? "very high — almost exclusively watches acclaimed, award-circuit or critically-championed titles" : prestige > 0.50 ? "high — strongly prefers well-reviewed, substantive work over populist fare" : prestige > 0.30 ? "moderate — appreciates quality but open to mainstream picks" : "mainstream-leaning — prioritise recognisable, broadly popular titles";
    const novelty = p.noveltyTolerance ?? 0.5;
    const noveltyLabel = novelty > 0.60 ? "high novelty tolerance — actively seeks out lesser-known, under-the-radar titles" : novelty < 0.25 ? "low novelty tolerance — stick to well-known, widely-seen titles" : "moderate — one discovery title per batch is enough";
    const pacing = p.pacingPreference ?? "medium";
    const pacingLabel = pacing === "slow" ? "slow-burn, patient storytelling — avoid rapid-cut action or pure crowd-pleasers" : pacing === "fast" ? "fast-paced, kinetic — avoid slow arthouse or contemplative films" : "medium pacing — comfortable across a range of styles";
    return `\nCINEMATIC IDENTITY (computed from full viewing history — treat as authoritative):\n- Tone preference: ${toneLabel}\n- Prestige affinity: ${prestigeLabel}\n- Discovery appetite: ${noveltyLabel}\n- Pacing preference: ${pacingLabel}\n- Era: ${eraLabel}\n- Taste summary: ${tasteDNA?.tasteProfile || "eclectic cinephile"}\n${p.emotionalProfile?.length ? `- Emotional register: ${p.emotionalProfile.join(", ")}` : ""}\n${tasteDNA?.thematicInterests?.length ? `- Thematic interests: ${tasteDNA.thematicInterests.join(", ")}` : ""}\n${tasteDNA?.recentShift ? `- Recent taste shift detected: ${tasteDNA.recentShift}` : ""}\n\nEvery recommendation must pass through this identity. Do not default to generic popular titles — calibrate to this specific viewer.`;
  })();

  const languageNote = hasHistory ? "Foreign-language films/shows: recommend if the viewing history includes non-English content, or if the user asks." : "English-language by default unless the user requests otherwise.";

  return `/no_think
You are NextUp — a premium cinematic concierge, not a chatbot.
You understand film and television at depth: genre, tone, pacing, craft, emotional register, director sensibility, cultural weight.
Today is ${today}. When users mention time ("this year", "last 6 months", "recent"), calculate the date range from today.
${temporalNote}
${genreDnaSection}${historySection}${dnaSection}${excludeSection}
VOICE:
- Speak like a knowledgeable friend who knows THIS SPECIFIC VIEWER deeply. Confident, precise, never generic.
- No filler openers: never "Great question!", "Of course!", "Absolutely!", "Sure!", "Certainly!".
- The entire focus is WHY they specifically will love this — not what it is.
- Every sentence must be earned by their actual data: genre DNA percentages, tone preference, pacing, era affinity.
- Trust that the user has seen a lot. Be specific. Generic praise means nothing.

QUALITY:
- Only titles with strong reception: 7.0+ TMDB rating, 500+ votes minimum.
- No obscure, adult, exploitation, or direct-to-video releases.
- ${languageNote}
- Match discovery depth to their novelty tolerance.
- IMPORTANT: Put movies in the movies array and TV shows in the shows array. Never cross them.

FORMAT (recommendations):
- Include 3–5 titles.
- Open with ONE short sentence (max 15 words) connecting the request to their specific taste profile.
- For each title: write the exact title name, then " — ", then one sentence (two max) why this viewer will love it. New line between each.
- Title names in the reply must match the arrays exactly.
- movies array: "Title (YEAR)" format. shows array: "Title (YEAR)" format. Never put a TV show in movies or vice versa.
- If asked about one specific title: 2–3 sentences on why it fits their taste. No list needed.

CRITICAL: Output ONLY a raw JSON object. No prose before or after. No markdown. No code fences.
The "reply" field MUST contain the full curation text: the opening sentence AND the per-title explanations ("Title — why they will love it"), separated by \\n\\n. Do NOT put the per-title blurbs anywhere other than inside "reply".
Example output structure:
{"reply":"[Opening sentence tailored to their taste.]\\n\\nTitle One (YEAR) — [One sentence on why this viewer specifically will love it.]\\n\\nTitle Two (YEAR) — [One sentence.]\\n\\nTitle Three (YEAR) — [One sentence.]","movies":["Title One (YEAR)","Title Three (YEAR)"],"shows":["Title Two (YEAR)"]}`;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseResponse(rawText: string): Omit<AIReply, "modelUsed"> {
  const stripped = rawText.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
  const emptyIds = { tmdbIds: [] as number[], movieIds: [] as number[], tvIds: [] as number[] };

  function cleanMd(text: string) { return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim(); }

  function getStringArray(text: string, field: string): string[] {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!match || !match[1].trim()) return [];
    const items: string[] = [];
    const itemRe = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = itemRe.exec(match[1])) !== null) {
      const title = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
      if (title) items.push(title);
    }
    return items;
  }

  function extractReplyText(jsonBlock: string): string | null {
    const keyIdx = jsonBlock.indexOf('"reply"');
    if (keyIdx === -1) return null;
    const colonIdx = jsonBlock.indexOf(":", keyIdx + 7);
    if (colonIdx === -1) return null;
    const quoteStart = jsonBlock.indexOf('"', colonIdx + 1);
    if (quoteStart === -1) return null;
    const afterOpen = jsonBlock.slice(quoteStart + 1);
    const endMarkers = ['","movies"', '","shows"', '","movieIds"', '","tvIds"', '","tmdbIds"'];
    let endIdx = -1;
    for (const marker of endMarkers) { const idx = afterOpen.indexOf(marker); if (idx !== -1 && (endIdx === -1 || idx < endIdx)) endIdx = idx; }
    const raw = endIdx !== -1 ? afterOpen.slice(0, endIdx) : afterOpen.replace(/"\s*}?\s*$/, "");
    if (!raw) return null;
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t");
  }

  function parseTitlesWithYears(raw: string[]): { titles: string[]; years: (number | null)[] } {
    const titles: string[] = []; const years: (number | null)[] = [];
    for (const entry of raw) {
      const m = entry.match(/^(.*?)\s*\((\d{4})\)\s*$/);
      if (m) { titles.push(m[1].trim()); years.push(parseInt(m[2], 10)); }
      else { titles.push(entry.trim()); years.push(null); }
    }
    return { titles, years };
  }

  const rawMovies = getStringArray(stripped, "movies");
  const rawShows = getStringArray(stripped, "shows");
  const { titles: movies, years: movieYears } = parseTitlesWithYears(rawMovies);
  const { titles: shows, years: showYears } = parseTitlesWithYears(rawShows);

  const first = stripped.indexOf("{"); const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const jsonBlock = stripped.slice(first, last + 1);
    try {
      const p = JSON.parse(jsonBlock);
      if (p && typeof p.reply === "string") {
        const inner = p.reply.trim();
        if (inner.startsWith("{")) {
          try {
            const p2 = JSON.parse(inner);
            if (p2?.reply) {
              const im = parseTitlesWithYears(Array.isArray(p2.movies) ? p2.movies : getStringArray(inner, "movies"));
              const is_ = parseTitlesWithYears(Array.isArray(p2.shows) ? p2.shows : getStringArray(inner, "shows"));
              return { reply: cleanMd(p2.reply), movies: im.titles, movieYears: im.years, shows: is_.titles, showYears: is_.years, ...emptyIds };
            }
          } catch { /* fall through */ }
        }
        const pm = parseTitlesWithYears(Array.isArray(p.movies) ? p.movies : rawMovies);
        const ps = parseTitlesWithYears(Array.isArray(p.shows) ? p.shows : rawShows);
        return { reply: cleanMd(p.reply), movies: pm.titles, movieYears: pm.years, shows: ps.titles, showYears: ps.years, ...emptyIds };
      }
    } catch {
      const extracted = extractReplyText(jsonBlock);
      if (extracted) return { reply: cleanMd(extracted), movies, movieYears, shows, showYears, ...emptyIds };
    }
  }

  const plain = stripped.replace(/^\s*\{?\s*"reply"\s*:\s*"/, "").replace(/",?\s*"(?:movies|shows|movieIds|tvIds|tmdbIds)"\s*:[\s\S]*$/, "").replace(/"\s*}\s*$/, "");
  return { reply: cleanMd(plain) || cleanMd(stripped), movies, movieYears, shows, showYears, ...emptyIds };
}

// ─── OpenRouter streaming call ────────────────────────────────────────────────

async function streamFromOpenRouter(
  key: string,
  modelId: string,
  messages: { role: string; content: string }[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<{ fullText: string; promptTokens: number; completionTokens: number }> {
  console.log(`[ai-chat] streaming → model: ${modelId}`);

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://nextup.app",
      "X-Title": "NextUp",
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true,
      // Prefer fast Qwen3 providers; disable thinking to avoid silent 5-30s think-blocks
      provider: { order: ["Fireworks", "Together", "Nebius"], allow_fallbacks: true },
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try { body = await response.json(); } catch { /* ignore */ }
    throw new Error(String((body?.error as any)?.message ?? body?.message ?? `HTTP ${response.status}`));
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  // Real-time thinking block filter.
  // Qwen3 emits <think>...</think> before the actual answer — strip it before streaming.
  type Phase = "waiting" | "thinking" | "streaming";
  let phase: Phase = "waiting";
  let pendingBuf = ""; // accumulates tokens while waiting or filtering think block
  const THINK_START = "<think>";
  const THINK_END = "</think>";

  const sendChunk = async (text: string) => {
    if (!text) return;
    await writer.write(encoder.encode(`data: ${JSON.stringify({ t: "c", v: text })}\n\n`));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data);
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
        const token: string = chunk.choices?.[0]?.delta?.content ?? "";
        if (!token) continue;

        // State machine to filter <think>...</think> blocks
        // fullText only accumulates post-thinking content so parseResponse gets clean JSON
        if (phase === "waiting") {
          pendingBuf += token;
          if (pendingBuf.startsWith(THINK_START)) {
            phase = "thinking";
            pendingBuf = pendingBuf.slice(THINK_START.length); // discard opening tag
          } else if (!THINK_START.startsWith(pendingBuf)) {
            // Not a thinking block — start streaming immediately
            phase = "streaming";
            fullText += pendingBuf;
            await sendChunk(pendingBuf);
            pendingBuf = "";
          }
          // else: pendingBuf is a prefix of THINK_START, keep waiting
        } else if (phase === "thinking") {
          pendingBuf += token;
          const endIdx = pendingBuf.indexOf(THINK_END);
          if (endIdx !== -1) {
            phase = "streaming";
            const after = pendingBuf.slice(endIdx + THINK_END.length).trimStart();
            pendingBuf = "";
            if (after) {
              fullText += after;
              await sendChunk(after);
            }
          }
          // else: still inside thinking block, discard
        } else {
          // Streaming — send every token directly
          fullText += token;
          await sendChunk(token);
        }
      } catch { /* skip malformed SSE line */ }
    }
  }

  // Flush pending buffer if we never entered a think block
  if (pendingBuf && phase !== "thinking") {
    await sendChunk(pendingBuf);
  }

  console.log(`[ai-chat] stream complete: ${fullText.length} chars`);
  return { fullText, promptTokens, completionTokens };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  try {
    // 1. Validate JWT — start body parse in parallel since it needs no auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonError("Unauthorized", 401);

    const bodyPromise = req.json().catch(() => ({}));

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) return jsonError("Unauthorized", 401);

    // 2. Admin client
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 3. Rate limit + context + body — all in parallel (saves ~100ms serial DB wait)
    const [body, { data: allowed, error: rlError }, dnaResult, conversationsResult] = await Promise.all([
      bodyPromise,
      admin.rpc("check_ai_rate_limit", { p_user_id: user.id, p_limit: DAILY_LIMIT }),
      admin.from("taste_dna").select("taste_profile, genre_affinity, profile_metadata").eq("user_id", user.id).maybeSingle(),
      admin.from("ai_conversations").select("titles_mentioned").eq("user_id", user.id).order("session_at", { ascending: false }).limit(5),
    ]);

    if (rlError) console.error("[ai-chat] Rate limit error:", rlError.message);
    if (allowed === false) return jsonError(`Daily AI limit reached (${DAILY_LIMIT}/day)`, 429);

    const { action = "ask", messages = [], watchedMovies = [], watchedShows = [], favoriteGenres = [], model, inSessionTitles = [] } = body;

    const orKey = Deno.env.get("OPENROUTER_KEY") ?? "";
    if (!orKey) return jsonError("AI service not configured", 503);

    const primaryModel = (typeof model === "string" && model.trim()) ? model.trim() : DEFAULT_MODEL;
    const cascade = primaryModel === FALLBACK_MODEL ? [primaryModel] : [primaryModel, FALLBACK_MODEL];

    // ── Summarise (non-streaming) ─────────────────────────────────────────────
    if (action === "summarise") {
      if (!Array.isArray(messages) || messages.length < 2) return jsonOk({ summary: "" });
      const transcript = messages.map((m: ChatMessage) => `${m.role === "user" ? "User" : "NextUp"}: ${m.content}`).join("\n");
      const prompt = `Summarise this film/TV recommendation conversation in 2–3 concise sentences. Include the viewer's mood/criteria, genres/directors/themes mentioned, and titles recommended. Be terse.\n\nConversation:\n${transcript}\n\nSummary:`;
      for (const modelId of cascade) {
        try {
          const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${orKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://nextup.app", "X-Title": "NextUp" },
            body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: prompt }], provider: { order: ["Fireworks", "Together"], allow_fallbacks: true }, chat_template_kwargs: { enable_thinking: false } }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          const text: string = (data.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          if (text) return jsonOk({ summary: text });
        } catch { continue; }
      }
      return jsonOk({ summary: "" });
    }

    // ── Ask (streaming) ───────────────────────────────────────────────────────

    const dnaRow = dnaResult.data;
    const tasteDNA: TasteDNA | null = dnaRow ? {
      tasteProfile: dnaRow.taste_profile ?? "",
      genreAffinity: dnaRow.genre_affinity ?? {},
      profile: dnaRow.profile_metadata?.profile ?? null,
      thematicInterests: dnaRow.profile_metadata?.thematicInterests ?? [],
      recentShift: dnaRow.profile_metadata?.recentShift ?? undefined,
    } : null;

    const dbTitles: string[] = (conversationsResult.data ?? []).flatMap((c: { titles_mentioned: string[] }) => c.titles_mentioned ?? []);
    const alreadyRecommended = [...new Set([...(inSessionTitles as string[]), ...dbTitles])];

    const systemPrompt = buildSystemPrompt(watchedMovies, watchedShows, alreadyRecommended, favoriteGenres, tasteDNA);
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...(messages as ChatMessage[]).map((m) => ({ role: m.role, content: m.content })),
    ];

    // 6. Set up streaming response
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // 7. Process AI call in background (response streams while this runs)
    ;(async () => {
      const startTime = Date.now();
      let modelUsed = primaryModel;
      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let success = false;
      let lastError = "";

      for (const modelId of cascade) {
        try {
          const result = await streamFromOpenRouter(orKey, modelId, chatMessages, writer, encoder);
          fullText = result.fullText;
          promptTokens = result.promptTokens;
          completionTokens = result.completionTokens;
          modelUsed = modelId;
          success = true;
          break;
        } catch (e: unknown) {
          lastError = (e as Error).message ?? String(e);
          console.warn(`[ai-chat] ${modelId} failed: ${lastError.slice(0, 200)}`);
        }
      }

      const latencyMs = Date.now() - startTime;

      if (!success) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ t: "e", msg: lastError })}\n\n`));
      } else {
        const parsed = parseResponse(fullText);
        const doneEvent = {
          t: "d",
          r: parsed.reply, m: parsed.movies, s: parsed.shows,
          my: parsed.movieYears, sy: parsed.showYears, mu: modelUsed,
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));

        // Log (fire-and-forget)
        admin.from("ai_requests").insert({
          user_id: user.id, model: modelUsed,
          prompt_tokens: promptTokens || null, completion_tokens: completionTokens || null,
          latency_ms: latencyMs, success: true,
        }).then(() => {}).catch((e: Error) => console.warn("[ai-chat] Log failed:", e.message));
      }

      writer.close();
    })();

    return new Response(readable, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (e: unknown) {
    console.error("[ai-chat] Unhandled error:", (e as Error).message);
    return jsonError("Internal server error", 500);
  }
});
