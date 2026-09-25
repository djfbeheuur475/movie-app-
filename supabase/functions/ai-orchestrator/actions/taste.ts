// Taste profile pipeline — explicit ratings → readable profile → "For You" rows.
//
//   taste_seed     titles worth rating: contrast pairs Qwen picks for this viewer
//                  (similar on the surface, split audiences) + titles from their
//                  own history, incl. shows they appear to have dropped
//   taste_profile  Qwen reads ratings + history + the person's own notes and
//                  writes a plain-English profile, stored in taste_profiles
//   for_you        purpose rows from the profile: Qwen free-picks (the approach
//                  that has worked best here), a Qwen pick over TMDB's recent
//                  releases for "new" (past the model's knowledge), all resolved
//                  to TMDB and filtered against history + ratings. Cached daily.
//
// Why: history says what was watched, not what was liked (the Jev experiment's
// Friends/Big Bang Theory picks came from exactly that gap).

import type { ActionContext } from "../types.ts";
import { CORS_HEADERS, DEFAULT_MODEL, FALLBACK_MODEL } from "../lib/constants.ts";
import { callOpenRouter } from "../lib/openrouter.ts";
import { recentReleasePool, resolveMany, tmdbDetails, type ResolvedTitle } from "../lib/tmdb-resolve.ts";

// Profile + rows are built rarely and cached, so they get the largest Qwen;
// chat keeps the fast 14B. Falls back down the family if a provider is out.
const TASTE_MODELS = ["qwen/qwen3-235b-a22b-2507", DEFAULT_MODEL, FALLBACK_MODEL];
const FOR_YOU_DAILY_LIMIT = 20;
const SEED_TARGET = 40;
const ROW_SIZE = 10;

type MediaType = "movie" | "tv";

interface RatingRow {
  tmdb_id: number; media_type: MediaType; title: string; year: number | null;
  rating: number | null; source: string; rated_at: string;
}

export interface TasteProfileDoc {
  summary: string;
  loves: string[];
  avoids: string[];
  acclaim: string;
  moods: { label: string; description: string }[];
  blindSpots: string[];
}

interface RowItem extends ResolvedTitle { reason: string }
interface ForYouRow { id: string; heading: string; subheading: string; items: RowItem[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
function extractJson(text: string): any | null {
  const s = text.replace(/```(?:json)?/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** One JSON-producing call, walking down the model list until something parses. */
// deno-lint-ignore no-explicit-any
async function askJson(ctx: ActionContext, system: string, user: string, maxTokens: number): Promise<{ data: any; model: string } | null> {
  for (const model of TASTE_MODELS) {
    try {
      const text = await callOpenRouter({
        key: ctx.openRouterKey, model, maxTokens,
        messages: [{ role: "system", content: `/no_think\n${system}` }, { role: "user", content: user }],
      });
      const data = extractJson(text);
      if (data) return { data, model };
      console.warn(`[taste] ${model} returned unparseable JSON: ${text.slice(0, 160)}`);
    } catch (e) {
      console.warn(`[taste] ${model} failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return null;
}

// Models add markdown emphasis around titles despite being asked not to; the app renders plain text.
const plain = (t: unknown) =>
  String(t ?? "").replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/(^|\s)_([^_]+)_(?=\s|[.,;:!?)]|$)/g, "$1$2").trim();

const key = (type: MediaType, id: number) => `${type}:${id}`;
const asType = (t: unknown): MediaType => (String(t).toLowerCase().startsWith("tv") || String(t).toLowerCase() === "show" ? "tv" : "movie");
const asYear = (y: unknown): number | null => { const n = parseInt(String(y)); return n > 1880 && n < 2100 ? n : null; };

interface HistoryShow { title: string; year: number; tmdb: number | null; eps: number | null; last: string }
interface HistoryMovie { title: string; year: number; tmdb: number | null; plays: number; last: string }

function readHistory(ctx: ActionContext) {
  const movies: HistoryMovie[] = ctx.watchedMovies.map((m) => ({
    title: m.movie.title, year: m.movie.year, tmdb: m.movie.ids?.tmdb ?? null, plays: m.plays, last: m.last_watched_at,
  }));
  const shows: HistoryShow[] = ctx.watchedShows.map((s) => ({
    title: s.show.title, year: s.show.year, tmdb: s.show.ids?.tmdb ?? null,
    // deno-lint-ignore no-explicit-any
    eps: typeof (s as any).episodes_watched === "number" ? (s as any).episodes_watched : null, last: s.last_watched_at,
  }));
  return { movies, shows };
}

/** Compact, prompt-ready read of watch history. Completion matters more than presence. */
function describeHistory(h: ReturnType<typeof readHistory>): string {
  const label = (t: { title: string; year: number }) => `${t.title} (${t.year})`;
  const committed = h.shows.filter((s) => (s.eps ?? 0) >= 10).slice(0, 30).map((s) => `${label(s)} [${s.eps} eps]`);
  const dropped = h.shows.filter((s) => s.eps !== null && s.eps >= 1 && s.eps <= 2).slice(0, 20).map(label);
  const sampled = h.shows.filter((s) => s.eps !== null && s.eps > 2 && s.eps < 10).slice(0, 20).map((s) => `${label(s)} [${s.eps} eps]`);
  const rewatched = h.movies.filter((m) => m.plays >= 3).slice(0, 15).map((m) => `${label(m)} ×${m.plays}`);
  const recentMovies = h.movies.slice(0, 40).map(label);
  if (!h.movies.length && !h.shows.length) return "No watch history connected.";
  return [
    `Shows watched deeply (10+ episodes): ${committed.join(", ") || "none"}`,
    `Shows sampled (3–9 episodes): ${sampled.join(", ") || "none"}`,
    `Shows apparently dropped after 1–2 episodes: ${dropped.join(", ") || "none"}`,
    `Films rewatched 3+ times: ${rewatched.join(", ") || "none"}`,
    `Recent films (newest first): ${recentMovies.join(", ") || "none"}`,
  ].join("\n");
}

function describeRatings(ratings: RatingRow[]): string {
  const by = (r: number) => ratings.filter((x) => x.rating === r).map((x) => `${x.title}${x.year ? ` (${x.year})` : ""}`);
  const sections: [string, string[]][] = [["LOVED", by(2)], ["LIKED", by(1)], ["MEH", by(0)], ["DISLIKED", by(-1)]];
  const body = sections.filter(([, t]) => t.length).map(([k, t]) => `${k}: ${t.join(", ")}`).join("\n");
  return body || "No ratings yet.";
}

async function loadRatings(ctx: ActionContext): Promise<RatingRow[]> {
  const { data, error } = await ctx.admin.from("title_ratings")
    .select("tmdb_id, media_type, title, year, rating, source, rated_at")
    .eq("user_id", ctx.userId).order("rated_at", { ascending: false });
  if (error) console.error("[taste] ratings load failed:", error.message);
  return (data ?? []) as RatingRow[];
}

// Well-known pairs that look alike but split audiences — used when the model
// can't produce its own, and to top up a short list.
const FALLBACK_PAIRS: [string, number, MediaType][][] = [
  [["Seinfeld", 1989, "tv"], ["Friends", 1994, "tv"]],
  [["Oppenheimer", 2023, "movie"], ["The Zone of Interest", 2023, "movie"]],
  [["Succession", 2018, "tv"], ["Suits", 2011, "tv"]],
  [["Parasite", 2019, "movie"], ["Knives Out", 2019, "movie"]],
  [["Top Gun: Maverick", 2022, "movie"], ["Dune", 2021, "movie"]],
  [["The Office", 2005, "tv"], ["Curb Your Enthusiasm", 2000, "tv"]],
  [["Past Lives", 2023, "movie"], ["La La Land", 2016, "movie"]],
  [["Breaking Bad", 2008, "tv"], ["Ozark", 2017, "tv"]],
  [["Everything Everywhere All at Once", 2022, "movie"], ["Arrival", 2016, "movie"]],
  [["Fleabag", 2016, "tv"], ["Ted Lasso", 2020, "tv"]],
  [["No Country for Old Men", 2007, "movie"], ["Heat", 1995, "movie"]],
  [["The Bear", 2022, "tv"], ["Normal People", 2020, "tv"]],
  [["Get Out", 2017, "movie"], ["Hereditary", 2018, "movie"]],
  [["True Detective", 2014, "tv"], ["Mindhunter", 2017, "tv"]],
  [["Anatomy of a Fall", 2023, "movie"], ["Gone Girl", 2014, "movie"]],
  [["Barbie", 2023, "movie"], ["Poor Things", 2023, "movie"]],
  [["The Crown", 2016, "tv"], ["Slow Horses", 2022, "tv"]],
  [["The Shawshank Redemption", 1994, "movie"], ["There Will Be Blood", 2007, "movie"]],
];

// ─── taste_seed ───────────────────────────────────────────────────────────────

export async function handleTasteSeed(ctx: ActionContext, tmdbKey: string): Promise<Response> {
  const ratings = await loadRatings(ctx);
  const rated = new Set(ratings.map((r) => key(r.media_type, r.tmdb_id)));
  const history = readHistory(ctx);

  // 1. From their own history: dropped shows first (the clearest likely dislikes),
  //    then shows/films they committed to, so the profile hears "loved" vs "just watched".
  const fromHistory: { tmdb: number; type: MediaType; prompt: string }[] = [];
  for (const s of history.shows.filter((s) => s.tmdb && s.eps !== null && s.eps >= 1 && s.eps <= 2).slice(0, 5)) {
    fromHistory.push({ tmdb: s.tmdb!, type: "tv", prompt: `You stopped after ${s.eps} episode${s.eps === 1 ? "" : "s"}` });
  }
  for (const s of history.shows.filter((s) => s.tmdb && (s.eps ?? 0) >= 6).slice(0, 5)) {
    fromHistory.push({ tmdb: s.tmdb!, type: "tv", prompt: `You watched ${s.eps} episodes` });
  }
  for (const m of history.movies.filter((m) => m.tmdb).slice(0, 6)) {
    fromHistory.push({ tmdb: m.tmdb!, type: "movie", prompt: "From your watch history" });
  }
  const historyPicks = fromHistory.filter((h) => !rated.has(key(h.type, h.tmdb)));

  // 2. Contrast pairs chosen for this viewer.
  const pairsWanted = Math.max(6, Math.ceil((SEED_TARGET - historyPicks.length) / 2));
  const system = `You design quick taste quizzes for a film & TV recommender. The viewer will rate each title Loved / Liked / Meh / Disliked / Haven't seen.
Choose PAIRS of well-known titles that look similar on the surface but split audiences, so each answer reveals something specific
(e.g. Seinfeld vs Friends: cynical observational comedy vs warm hang-out sitcom; Oppenheimer vs The Zone of Interest: acclaimed-and-gripping vs acclaimed-and-austere).
Rules:
- Strongly prefer titles from the viewer's history below — rating things they've actually watched is the most useful signal. Fill the rest with famous titles they've probably seen.
- Across decades. Include award winners and critics' favourites AND popular crowd-pleasers.
- Mix films and TV. Cover different genres, tones and levels of darkness, pace and seriousness.
- Never include titles from the "already rated" list.
- Output ONLY JSON: {"pairs":[{"a":{"title":"…","year":2019,"type":"movie"},"b":{"title":"…","year":2020,"type":"tv"},"tests":"what the pair distinguishes, ≤10 words"}]}`;
  const user = `Viewer's history:\n${describeHistory(history)}\n\nOlder films they've watched: ${history.movies.slice(40, 160).map((m) => m.title).join(", ") || "none"}\n\nAlready rated: ${ratings.slice(0, 80).map((r) => r.title).join(", ") || "nothing"}\n\nGive ${pairsWanted} pairs.`;
  const ai = await askJson(ctx, system, user, 2500);

  type Ask = { title: string; year: number | null; type: MediaType; prompt: string };
  const asks: Ask[] = [];
  // deno-lint-ignore no-explicit-any
  for (const p of (ai?.data?.pairs ?? []) as any[]) {
    const tests = typeof p?.tests === "string" ? p.tests : "";
    for (const side of [p?.a, p?.b]) {
      if (side?.title) asks.push({ title: String(side.title), year: asYear(side.year), type: asType(side.type), prompt: tests });
    }
  }
  if (asks.length < pairsWanted) {
    for (const pair of FALLBACK_PAIRS) for (const [title, year, type] of pair) asks.push({ title, year, type, prompt: "" });
  }

  const [historyResolved, askResolved] = await Promise.all([
    Promise.all(historyPicks.map((h) => tmdbDetails(h.tmdb, h.type, tmdbKey))),
    resolveMany(asks, tmdbKey),
  ]);

  const watched = new Set([
    ...history.movies.filter((m) => m.tmdb).map((m) => key("movie", m.tmdb!)),
    ...history.shows.filter((s) => s.tmdb).map((s) => key("tv", s.tmdb!)),
  ]);
  const seen = new Set<string>(rated);
  type SeedItem = ResolvedTitle & { prompt: string; fromHistory: boolean };
  const histItems: SeedItem[] = [];
  const pairItems: SeedItem[] = [];
  historyResolved.forEach((r, i) => {
    if (!r || seen.has(key(r.mediaType, r.tmdbId))) return;
    seen.add(key(r.mediaType, r.tmdbId));
    histItems.push({ ...r, prompt: historyPicks[i].prompt, fromHistory: true });
  });
  // Keep pairs adjacent in the quiz — the contrast is the point. Titles they've
  // watched are the most valuable to rate, so they're kept and labelled.
  askResolved.forEach((r, i) => {
    if (!r || seen.has(key(r.mediaType, r.tmdbId)) || r.voteCount < 200) return;
    seen.add(key(r.mediaType, r.tmdbId));
    const wasWatched = watched.has(key(r.mediaType, r.tmdbId));
    pairItems.push({ ...r, prompt: wasWatched ? "You've watched this" : asks[i].prompt, fromHistory: wasWatched });
  });

  // History picks are interleaved so the quiz doesn't open with a block of them.
  const ordered: SeedItem[] = [];
  while (histItems.length || pairItems.length) {
    ordered.push(...pairItems.splice(0, 4));
    if (histItems.length) ordered.push(histItems.shift()!);
  }

  return json({ items: ordered.slice(0, SEED_TARGET), model: ai?.model ?? "fallback", ratedCount: ratings.filter((r) => r.rating !== null).length });
}

// ─── taste_profile ────────────────────────────────────────────────────────────

export async function handleTasteProfile(ctx: ActionContext): Promise<Response> {
  const [ratings, { data: existing }] = await Promise.all([
    loadRatings(ctx),
    ctx.admin.from("taste_profiles").select("user_notes").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  const notes: string = (typeof ctx.rawBody.userNotes === "string" ? ctx.rawBody.userNotes : existing?.user_notes) ?? "";
  const answered = ratings.filter((r) => r.rating !== null);
  const history = readHistory(ctx);
  if (answered.length < 5 && !history.movies.length && !history.shows.length) {
    return json({ error: "Rate a few more titles first" }, 400);
  }

  const system = `You are a perceptive film & TV critic writing a taste profile for one viewer, to be read by them and used to pick their recommendations.
Evidence, strongest first: their own notes (treat as authoritative corrections), explicit ratings, then watch history (history shows what they watched, NOT what they liked — completion and rewatches are the signal; dropped shows lean negative).
Be specific and discriminating: say what separates what they like from similar things they don't (e.g. "sharp, cynical single-camera comedy — not warm laugh-track sitcoms"), and cite 1–3 real titles from their evidence in each point. No flattery, no generic statements like "enjoys good storytelling".
Describe taste only — never guess the viewer's gender, age, nationality or identity.
Plain text only: no markdown, no asterisks or underscores around titles.
Also judge how they relate to award-winning and critically acclaimed work: which kinds of acclaimed titles land with them and which don't.
Output ONLY JSON:
{"summary":"2–3 sentences in second person",
 "loves":["5–7 specific points, each citing example titles"],
 "avoids":["3–5 specific points, each citing example titles where possible"],
 "acclaim":"1–2 sentences on which kinds of acclaimed / award-winning work suit them",
 "moods":[{"label":"2–4 word mood name, e.g. Tense but not grim","description":"one sentence"}],
 "blindSpots":["2–3 areas they haven't explored but probably would enjoy"]}
Give 3–4 moods: distinct viewing moods this person evidently has.`;
  const user = `Viewer's own notes: ${notes.trim() || "none"}\n\nRatings:\n${describeRatings(answered)}\n\nWatch history:\n${describeHistory(history)}`;
  const ai = await askJson(ctx, system, user, 1800);
  if (!ai) return json({ error: "Couldn't build a profile right now — try again shortly" }, 502);

  const d = ai.data;
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map(plain).slice(0, n) : []) as string[];
  const profile: TasteProfileDoc = {
    summary: typeof d.summary === "string" ? plain(d.summary) : "",
    loves: strs(d.loves, 8),
    avoids: strs(d.avoids, 6),
    acclaim: typeof d.acclaim === "string" ? plain(d.acclaim) : "",
    // deno-lint-ignore no-explicit-any
    moods: (Array.isArray(d.moods) ? d.moods : []).filter((m: any) => m?.label).slice(0, 4)
      // deno-lint-ignore no-explicit-any
      .map((m: any) => ({ label: plain(m.label), description: plain(m.description) })),
    blindSpots: strs(d.blindSpots, 3),
  };
  if (!profile.summary || !profile.loves.length) return json({ error: "Profile came back incomplete — try again" }, 502);

  const now = new Date().toISOString();
  const { error } = await ctx.admin.from("taste_profiles").upsert({
    user_id: ctx.userId, profile, user_notes: notes || null, ratings_count: answered.length,
    profile_model: ai.model, profile_built_at: now, rows: null, rows_built_at: null, updated_at: now,
  });
  if (error) console.error("[taste] profile save failed:", error.message);

  return json({ profile, userNotes: notes, ratingsCount: answered.length, model: ai.model, builtAt: now });
}

// ─── for_you ──────────────────────────────────────────────────────────────────

interface RowSpec { id: string; heading: string; subheading: string; brief: string }

function describeProfile(p: TasteProfileDoc, notes: string | null): string {
  return [
    `Summary: ${p.summary}`,
    `Loves:\n- ${p.loves.join("\n- ")}`,
    `Avoids:\n- ${p.avoids.join("\n- ")}`,
    `Acclaim: ${p.acclaim}`,
    p.blindSpots.length ? `Unexplored but promising: ${p.blindSpots.join("; ")}` : "",
    notes ? `Viewer's own notes (authoritative): ${notes}` : "",
  ].filter(Boolean).join("\n");
}

const ITEM_FORMAT = `Output ONLY JSON: {"items":[{"title":"exact title","year":2019,"type":"movie","reason":"one sentence, second person, why it suits THEM — cite their taste, not a plot summary"}]}`;

async function freePickRow(
  ctx: ActionContext, spec: RowSpec, profileText: string, exclude: string[], tmdbKey: string,
): Promise<ForYouRow> {
  const system = `You are NextUp's recommender. You know film and TV deeply and pick for one specific viewer.
${spec.brief}
Rules: real, released titles only; mix films and TV unless the brief says otherwise; vary genre, era and tone within the row; never pick anything in the "exclude" list.
"type" is "movie" or "tv". ${ITEM_FORMAT}`;
  const user = `Viewer's taste profile:\n${profileText}\n\nAlready seen, rated or recommended — never pick these: ${[...new Set(exclude)].slice(0, 1200).join("; ")}\n\nPick 16 titles.`;
  const ai = await askJson(ctx, system, user, 2200);
  // deno-lint-ignore no-explicit-any
  const raw = ((ai?.data?.items ?? []) as any[]).filter((x) => x?.title).map((x) => ({
    title: String(x.title), year: asYear(x.year), type: asType(x.type), reason: typeof x.reason === "string" ? plain(x.reason) : "",
  }));
  const resolved = await resolveMany(raw, tmdbKey);
  const items: RowItem[] = [];
  resolved.forEach((r, i) => { if (r && r.voteCount >= 100 && r.posterPath) items.push({ ...r, reason: raw[i].reason }); });
  return { id: spec.id, heading: spec.heading, subheading: spec.subheading, items };
}

async function newReleasesRow(ctx: ActionContext, profileText: string, pool: ResolvedTitle[]): Promise<ForYouRow> {
  const row: ForYouRow = { id: "new", heading: "New & worth it", subheading: "Recent releases picked for your taste", items: [] };
  if (!pool.length) return row;
  const list = pool.slice(0, 60).map((p, i) =>
    `${i}|${p.title} (${p.year})|${p.mediaType}|★${p.voteAverage.toFixed(1)}|${p.overview.slice(0, 160).replace(/\s+/g, " ")}`).join("\n");
  const system = `You are NextUp's recommender. From the numbered list of recent releases, pick the ones this viewer is most likely to enjoy, best first.
Judge from the overviews and your knowledge; skip anything that clashes with what they avoid. Pick at most 12 — fewer is fine if little fits.
Output ONLY JSON: {"picks":[{"i":3,"reason":"one sentence, second person, why it suits THEM"}]}`;
  const ai = await askJson(ctx, system, `Viewer's taste profile:\n${profileText}\n\nRecent releases:\n${list}`, 1200);
  // deno-lint-ignore no-explicit-any
  for (const p of (ai?.data?.picks ?? []) as any[]) {
    const item = pool[Number(p?.i)];
    if (item && !row.items.some((x) => x.tmdbId === item.tmdbId)) row.items.push({ ...item, reason: typeof p.reason === "string" ? plain(p.reason) : "" });
  }
  return row;
}

export async function handleForYou(ctx: ActionContext, tmdbKey: string): Promise<Response> {
  const { data: tp } = await ctx.admin.from("taste_profiles")
    .select("profile, user_notes, rows, rows_built_at, profile_built_at").eq("user_id", ctx.userId).maybeSingle();
  if (!tp?.profile) return json({ needsProfile: true, rows: [] });

  const dateKey = typeof ctx.rawBody.clientDateKey === "string" ? ctx.rawBody.clientDateKey : new Date().toISOString().slice(0, 10);
  const force = ctx.rawBody.force === true;
  if (!force && tp.rows?.dateKey === dateKey && tp.rows_built_at && tp.rows_built_at >= tp.profile_built_at) {
    return json({ rows: tp.rows.rows, builtAt: tp.rows_built_at, cached: true });
  }

  // Regeneration is the only part that costs — rate-limit it here, not on cache hits.
  const { data: allowed } = await ctx.admin.rpc("check_ai_rate_limit", { p_user_id: ctx.userId, p_action: "for_you", p_limit: FOR_YOU_DAILY_LIMIT });
  if (allowed === false) {
    return tp.rows?.rows ? json({ rows: tp.rows.rows, builtAt: tp.rows_built_at, cached: true }) : json({ error: "Daily limit reached" }, 429);
  }

  const profile = tp.profile as TasteProfileDoc;
  const profileText = describeProfile(profile, tp.user_notes);
  const ratings = await loadRatings(ctx);
  const history = readHistory(ctx);
  const blocked = new Set<string>([
    ...ratings.map((r) => key(r.media_type, r.tmdb_id)),
    ...history.movies.filter((m) => m.tmdb).map((m) => key("movie", m.tmdb!)),
    ...history.shows.filter((s) => s.tmdb).map((s) => key("tv", s.tmdb!)),
  ]);
  const exclude = [
    ...ratings.map((r) => r.title),
    ...history.movies.map((m) => m.title),
    ...history.shows.map((s) => s.title),
  ];

  const specs: RowSpec[] = [
    { id: "safe", heading: "Safe bets", subheading: "Squarely your taste",
      brief: "Row brief: titles that sit squarely inside what this viewer loves. High confidence picks, well regarded." },
    { id: "acclaimed", heading: "Acclaimed & unseen", subheading: "Award winners and critics' favourites that fit you",
      brief: "Row brief: award winners and nominees (Oscars, BAFTAs, Emmys, Cannes, Venice, Berlin, Sundance) and critics' favourites (Metacritic 80+) — only the kinds of acclaimed work the profile's acclaim note says land with this viewer. Span decades." },
    { id: "stretch", heading: "Worth a stretch", subheading: "Just outside your usual — but it should click",
      brief: "Row brief: titles adjacent to their taste that they probably haven't considered — lean on the unexplored areas in the profile. Still high quality; nothing from their 'avoids'." },
  ];
  const moodSpecs: RowSpec[] = profile.moods.slice(0, 2).map((m, i) => ({
    id: `mood-${i}`, heading: m.label, subheading: m.description,
    brief: `Row brief: titles for this specific mood of theirs — "${m.label}": ${m.description}`,
  }));

  // Wave 1: the core rows + the recent-release pool, in parallel.
  const [pool, ...coreRows] = await Promise.all([
    recentReleasePool(tmdbKey).catch(() => [] as ResolvedTitle[]),
    ...specs.map((s) => freePickRow(ctx, s, profileText, exclude, tmdbKey)),
  ]);
  const picked = (coreRows as ForYouRow[]).flatMap((r) => r.items.map((i) => i.title));
  // Wave 2: mood rows see wave 1's picks (otherwise they converge on the same
  // titles and dedupe empties them), alongside the new-releases pick.
  const freshPool = (pool as ResolvedTitle[]).filter((p) => !blocked.has(key(p.mediaType, p.tmdbId)));
  const [newRow, ...moodRows] = await Promise.all([
    newReleasesRow(ctx, profileText, freshPool),
    ...moodSpecs.map((s) => freePickRow(ctx, s, profileText, [...picked, ...exclude], tmdbKey)),
  ]);

  // Order: safe bets, new, acclaimed, stretch, moods. A title appears once, in the first row that has it.
  const ordered = [coreRows[0], newRow, ...coreRows.slice(1), ...moodRows] as ForYouRow[];
  const used = new Set<string>(blocked);
  const rows = ordered.map((row) => {
    const items = row.items.filter((it) => {
      const k = key(it.mediaType, it.tmdbId);
      if (used.has(k)) return false;
      used.add(k);
      return true;
    }).slice(0, ROW_SIZE);
    return { ...row, items };
  });
  console.log(`[for_you] rows: ${ordered.map((r, i) => `${r.id} ${r.items.length}→${rows[i].items.length}`).join(", ")}`);
  const kept = rows.filter((r) => r.items.length >= 3);

  const now = new Date().toISOString();
  await ctx.admin.from("taste_profiles").update({ rows: { dateKey, rows: kept }, rows_built_at: now }).eq("user_id", ctx.userId);
  return json({ rows: kept, builtAt: now, cached: false });
}
