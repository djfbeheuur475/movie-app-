// Stremio Addon — exposes a user's NextUp watchlist as a live Stremio catalog.
//
// Public, unauthenticated by design (Stremio's app makes plain GETs with no
// special headers) — the opaque per-user token in the URL path is the only
// "credential", looked up against user_settings.stremio_token.
//
// Routes:
//   GET /:token/manifest.json
//   GET /:token/catalog/:type/:id.json   (type = "movie" | "series")
//
// The watchlist itself is always read live — no caching of list membership
// or order. Only the TMDB->IMDb id conversion (which never changes for a
// given title) is cached, since Stremio's ecosystem (Cinemeta, stream
// addons) resolves everything by IMDb id, not TMDB id.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const MANIFEST = {
  id: "com.nextup.watchlist",
  version: "1.0.0",
  name: "NextUp Watchlist",
  description: "Your NextUp watchlist — always live, ordered by when you added each title.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "nextup-watchlist", name: "NextUp Watchlist" },
    { type: "series", id: "nextup-watchlist", name: "NextUp Watchlist" },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false },
};

const TMDB_BASE = "https://api.themoviedb.org/3";

interface WatchlistRow {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path: string | null;
}

// deno-lint-ignore no-explicit-any
async function resolveImdbIds(
  admin: any,
  tmdbKey: string,
  items: { tmdb_id: number; media_type: "movie" | "tv" }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  const orFilter = items
    .map((i) => `and(tmdb_id.eq.${i.tmdb_id},media_type.eq.${i.media_type})`)
    .join(",");
  const { data: cached } = await admin
    .from("tmdb_external_ids_cache")
    .select("tmdb_id, media_type, imdb_id")
    .or(orFilter);

  const cachedKeys = new Set<string>();
  // deno-lint-ignore no-explicit-any
  for (const row of (cached ?? []) as any[]) {
    cachedKeys.add(`${row.media_type}:${row.tmdb_id}`);
    if (row.imdb_id) result.set(`${row.media_type}:${row.tmdb_id}`, row.imdb_id);
  }

  const misses = items.filter((i) => !cachedKeys.has(`${i.media_type}:${i.tmdb_id}`));
  if (misses.length === 0) return result;

  const fetched = await Promise.allSettled(
    misses.map(async (i) => {
      const path = i.media_type === "movie"
        ? `/movie/${i.tmdb_id}/external_ids`
        : `/tv/${i.tmdb_id}/external_ids`;
      const res = await fetch(`${TMDB_BASE}${path}?api_key=${tmdbKey}`);
      if (!res.ok) throw new Error(`TMDB ${res.status}`);
      // deno-lint-ignore no-explicit-any
      const data: any = await res.json();
      return { ...i, imdb_id: (data.imdb_id as string | null) ?? null };
    }),
  );

  const toCache: { tmdb_id: number; media_type: string; imdb_id: string | null }[] = [];
  for (const r of fetched) {
    if (r.status === "fulfilled") {
      toCache.push({ tmdb_id: r.value.tmdb_id, media_type: r.value.media_type, imdb_id: r.value.imdb_id });
      if (r.value.imdb_id) result.set(`${r.value.media_type}:${r.value.tmdb_id}`, r.value.imdb_id);
    }
  }
  if (toCache.length > 0) {
    admin.from("tmdb_external_ids_cache")
      .upsert(toCache, { onConflict: "tmdb_id,media_type" })
      .then(() => {}, (e: Error) => console.warn("[stremio-addon] cache write failed:", e.message));
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  // Path is /functions/v1/stremio-addon/<token>/... — find our own segment
  // rather than assuming a fixed prefix depth.
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("stremio-addon");
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;

  const token = rest[0];
  if (!token) return json({ error: "Missing addon token" }, 400);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const tmdbKey = Deno.env.get("TMDB_API_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: settings } = await admin
      .from("user_settings")
      .select("id")
      .eq("stremio_token", token)
      .maybeSingle();

    if (!settings) return json({ error: "Unknown addon token" }, 404);
    const userId = settings.id as string;

    if (rest[1] === "manifest.json") {
      return json(MANIFEST);
    }

    if (rest[1] === "catalog" && rest[2] && rest[3]) {
      const type = rest[2]; // "movie" | "series"
      const mediaType: "movie" | "tv" = type === "series" ? "tv" : "movie";

      const { data: items, error } = await admin
        .from("watchlist")
        .select("tmdb_id, media_type, title, poster_path")
        .eq("user_id", userId)
        .eq("media_type", mediaType)
        .order("added_at", { ascending: false });

      if (error) {
        console.error("[stremio-addon] watchlist query failed:", error.message);
        return json({ metas: [] });
      }
      const rows = (items ?? []) as WatchlistRow[];
      if (rows.length === 0) return json({ metas: [] });

      const imdbMap = await resolveImdbIds(
        admin,
        tmdbKey,
        rows.map((i) => ({ tmdb_id: i.tmdb_id, media_type: i.media_type })),
      );

      const metas = rows
        .map((i) => {
          const imdbId = imdbMap.get(`${i.media_type}:${i.tmdb_id}`);
          if (!imdbId) return null;
          return {
            id: imdbId,
            type,
            name: i.title,
            poster: i.poster_path ? `https://image.tmdb.org/t/p/w500${i.poster_path}` : undefined,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      return json({ metas });
    }

    return json({ error: "Not found" }, 404);
  } catch (e: unknown) {
    console.error("[stremio-addon] unhandled error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Internal server error" }, 500);
  }
});
