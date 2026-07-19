// Trakt Public List Integration
//
// Flow:
//   fetchPopularLists()          → top 200 Trakt lists by community engagement
//   keywordTagList(list)         → assigns tags + media type from list name (no AI, instant)
//   matchListsForSlot(...)       → picks best 2 list IDs for a given slot type
//   buildTraktPool(listIds, ...) → fetch items from matched lists → TMDB enrichment → CandidateItem[]
//
// List selection is now deterministic (keyword matcher), not AI-driven.
// AI theme-gen focuses on headings/genres — no list catalog needed in prompt.

import type { CandidateItem } from "../../types.ts";

const TRAKT_BASE = "https://api.trakt.tv";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TRAKT_CLIENT_ID = "f2709b8b2160742dabafd2f96bdbb3af4329d022c1a303d59e132435bf177003";

const TRAKT_HEADERS = {
  "Content-Type": "application/json",
  "trakt-api-version": "2",
  "trakt-api-key": TRAKT_CLIENT_ID,
  Accept: "application/json",
};

// ─── Trakt API helper ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function traktGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TRAKT_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 9_000);
  try {
    const res = await fetch(url.toString(), { headers: TRAKT_HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`Trakt ${res.status} on ${path}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

// ─── Popular list catalog ─────────────────────────────────────────────────────

export interface TraktListEntry {
  id: number;
  name: string;
  description: string;
  itemCount: number;
  likes: number;
}

export interface ListItem {
  tmdbId: number;
  mediaType: "movie" | "tv";
}

export async function fetchPopularLists(): Promise<TraktListEntry[]> {
  // Fetch three pages of popular lists in parallel (100 results each = up to 300 raw)
  const [p1, p2, p3] = await Promise.allSettled([
    traktGet("/lists/popular", { limit: "100", page: "1" }),
    traktGet("/lists/popular", { limit: "100", page: "2" }),
    traktGet("/lists/popular", { limit: "100", page: "3" }),
  ]);

  // Each entry is { like_count, comment_count, list: { name, description, item_count, ids, likes, ... } }
  // deno-lint-ignore no-explicit-any
  const raw: any[] = [
    ...(p1.status === "fulfilled" ? (p1.value ?? []) : []),
    ...(p2.status === "fulfilled" ? (p2.value ?? []) : []),
    ...(p3.status === "fulfilled" ? (p3.value ?? []) : []),
  ].map((entry: any) => ({ ...entry.list, likes: entry.list?.likes ?? entry.like_count ?? 0 }));

  return raw
    // deno-lint-ignore no-explicit-any
    .filter((l: any) =>
      l.ids?.trakt &&
      (l.item_count ?? 0) >= 20 &&
      (l.likes ?? 0) >= 30
    )
    // deno-lint-ignore no-explicit-any
    .map((l: any): TraktListEntry => ({
      id: l.ids.trakt as number,
      name: String(l.name ?? ""),
      description: String(l.description ?? ""),
      itemCount: (l.item_count ?? 0) as number,
      likes: (l.likes ?? 0) as number,
    }))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 200); // top 200 by community engagement
}

// ─── Keyword-based list tagging ───────────────────────────────────────────────
// Instant (~0ms), no AI call, covers 80%+ of well-named Trakt lists.

export interface TaggedList extends TraktListEntry {
  tags: string[];
  mediaType: "movie" | "tv" | "mixed";
}

const FESTIVAL_KW = ["cannes", "sundance", "venice", " tiff", "berlin", "tribeca", "palme", "film festival"];
const AWARDS_KW = ["oscar", "academy award", "emmy", "bafta", "golden globe", " award", "nominated", "nominee", "prize winner"];
const PRESTIGE_KW = ["criterion", "sight & sound", "sight and sound", "1001 movies", " afi ", " bfi ", "mubi", "masterpiece", "greatest of all time", "best ever", "all-time", "essential cinema"];
const HIDDEN_KW = ["hidden gem", "underrated", "overlooked", "under the radar", "unknown gem", "obscure", "underappreciated", "undiscovered", "unsung", "sleeper", "under-seen", "slept on"];
const TV_KW = [" tv ", " television", " series", " shows", " show", "episode", "binge"];
const MOVIE_KW = [" film", " films", " movie", " movies", " cinema", " feature"];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = ` ${text.toLowerCase()} `;
  return keywords.some((kw) => lower.includes(kw));
}

export function keywordTagList(list: TraktListEntry): TaggedList {
  const tags: string[] = [];
  const name = list.name;

  if (containsAny(name, FESTIVAL_KW)) tags.push("festival");
  if (containsAny(name, AWARDS_KW)) tags.push("awards");
  if (containsAny(name, PRESTIGE_KW)) tags.push("prestige");
  if (containsAny(name, HIDDEN_KW)) tags.push("hidden");

  const isTV = containsAny(name, TV_KW);
  const isMovie = containsAny(name, MOVIE_KW);
  const mediaType: "movie" | "tv" | "mixed" = (isTV && !isMovie) ? "tv" : (isMovie && !isTV) ? "movie" : "mixed";

  return { ...list, tags, mediaType };
}

// ─── Slot-to-list matcher ─────────────────────────────────────────────────────
// Deterministically assigns Trakt list IDs to editorial slots.
// Only discovery + prestige slots use Trakt (genre rows use TMDB discover).

export function matchListsForSlot(
  lists: TaggedList[],
  slotType: string,
  mediaTypeHint: "movie" | "tv" | "either" = "either",
): number[] {
  if (slotType !== "discovery" && slotType !== "prestige") return [];

  const matches = lists.filter((list) => {
    const hasEditorialTag = slotType === "discovery"
      ? list.tags.includes("hidden")
      : list.tags.some((t) => ["prestige", "awards", "festival"].includes(t));
    if (!hasEditorialTag) return false;
    if (mediaTypeHint === "either") return true;
    return list.mediaType === "mixed" || list.mediaType === mediaTypeHint;
  });

  matches.sort((a, b) => b.likes - a.likes);
  return matches.slice(0, 2).map((l) => l.id);
}

// ─── List items fetcher ───────────────────────────────────────────────────────

async function fetchListTmdbIds(
  listId: number,
  mediaType: "movie" | "tv",
): Promise<number[]> {
  const typePath = mediaType === "movie" ? "movies" : "shows";
  try {
    // deno-lint-ignore no-explicit-any
    const items: any[] = await traktGet(`/lists/${listId}/items/${typePath}`, { limit: "100" });
    return (items ?? [])
      .map((item) => {
        const obj = mediaType === "movie" ? item.movie : item.show;
        return typeof obj?.ids?.tmdb === "number" ? obj.ids.tmdb : null;
      })
      .filter((id): id is number => id !== null);
  } catch (e) {
    console.warn(`[trakt] list ${listId} items failed: ${(e as Error).message?.slice(0, 60)}`);
    return [];
  }
}

// ─── Fetch all items from a Trakt list (movies + shows, in list order) ───────

export async function fetchListItems(listId: number): Promise<ListItem[]> {
  try {
    // deno-lint-ignore no-explicit-any
    const raw: any[] = await traktGet(`/lists/${listId}/items`, { limit: "100" });
    return (raw ?? [])
      .filter((i: any) => i.type === "movie" || i.type === "show")
      .map((i: any): ListItem | null => {
        const mediaType = i.type === "movie" ? "movie" as const : "tv" as const;
        const obj = i.type === "movie" ? i.movie : i.show;
        const tmdbId = obj?.ids?.tmdb;
        return typeof tmdbId === "number" ? { tmdbId, mediaType } : null;
      })
      .filter((i): i is ListItem => i !== null);
  } catch (e) {
    console.warn(`[trakt] list ${listId} items failed: ${(e as Error).message?.slice(0, 60)}`);
    return [];
  }
}

// ─── TMDB detail fetcher ──────────────────────────────────────────────────────

export async function tmdbDetail(
  tmdbId: number,
  mediaType: "movie" | "tv",
  tmdbKey: string,
): Promise<CandidateItem | null> {
  const url = new URL(`${TMDB_BASE}/${mediaType}/${tmdbId}`);
  url.searchParams.set("api_key", tmdbKey);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const d: any = await res.json();
    return {
      tmdbId: d.id,
      mediaType,
      title: mediaType === "movie"
        ? (d.title ?? d.original_title ?? "")
        : (d.name ?? d.original_name ?? ""),
      year: parseInt(
        ((mediaType === "movie" ? d.release_date : d.first_air_date) ?? "").split("-")[0],
      ) || 0,
      voteAverage: d.vote_average ?? 0,
      voteCount: d.vote_count ?? 0,
      popularity: d.popularity ?? 0,
      genres: (d.genres ?? []).map((g: { id: number }) => g.id),
      overview: d.overview ?? "",
      posterPath: d.poster_path ?? null,
      backdropPath: d.backdrop_path ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// ─── Main export: build pool from AI-selected Trakt list IDs ─────────────────

export async function buildTraktPool(
  listIds: number[],
  mediaType: "movie" | "tv",
  minRating: number,
  watchedIds: Set<number>,
  watchlistIds: Set<number>,
  tmdbKey: string,
): Promise<CandidateItem[]> {
  if (listIds.length === 0) return [];

  console.log(`[trakt] fetching ${listIds.length} lists for ${mediaType}`);

  // Fetch TMDB IDs from all selected lists in parallel
  const idGroups = await Promise.allSettled(
    listIds.map((id) => fetchListTmdbIds(id, mediaType)),
  );

  const allIds = [
    ...new Set(
      idGroups
        .filter((r): r is PromiseFulfilledResult<number[]> => r.status === "fulfilled")
        .flatMap((r) => r.value),
    ),
  ]
    .filter((id) => !watchedIds.has(id) && !watchlistIds.has(id))
    .slice(0, 50); // cap at 50 — we show 15, 50 gives quality headroom without excess TMDB calls

  if (allIds.length === 0) {
    console.log(`[trakt] lists ${listIds.join(",")} — no unwatched items`);
    return [];
  }

  // Enrich with TMDB metadata in parallel
  const details = await Promise.allSettled(
    allIds.map((id) => tmdbDetail(id, mediaType, tmdbKey)),
  );

  const candidates = details
    .filter((r): r is PromiseFulfilledResult<CandidateItem | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((c): c is CandidateItem =>
      c !== null &&
      c.voteAverage >= Math.max(minRating - 0.5, 5.0) && // light tolerance — list is the curation
      c.voteCount >= 50 &&
      c.year > 0
    );

  console.log(`[trakt] lists ${listIds.join(",")}: ${candidates.length} candidates from ${allIds.length} items`);
  return candidates;
}
