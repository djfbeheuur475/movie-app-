// Trakt Catalog Store
//
// Pre-indexes the top 200 Trakt public lists (name + description) so the
// homepage can read from DB (~100ms) rather than fetching Trakt live (~3s).
//
// Populate: POST { action: "index_trakt" }  — run once, refreshes after 7 days.

import type { TaggedList } from "./index.ts";

const CATALOG_STALE_MS = 7 * 24 * 3_600_000; // 7 days

// deno-lint-ignore no-explicit-any
export async function readCatalogIndex(admin: any): Promise<TaggedList[] | null> {
  const { data, error } = await admin
    .from("trakt_list_index")
    .select("trakt_id, name, description, item_count, likes, tags, media_type, indexed_at")
    .order("likes", { ascending: false });

  if (error || !data || data.length === 0) return null;

  const indexedAt = new Date(data[0]?.indexed_at ?? 0).getTime();
  if (Date.now() - indexedAt > CATALOG_STALE_MS) {
    console.log("[catalog] index is stale (>7d) — will re-index on next index_trakt call");
    return null;
  }

  // deno-lint-ignore no-explicit-any
  return data.map((row: any): TaggedList => ({
    id: row.trakt_id,
    name: row.name,
    description: row.description ?? "",
    itemCount: row.item_count,
    likes: row.likes,
    tags: Array.isArray(row.tags) ? row.tags : [],
    mediaType: (["movie", "tv", "mixed"].includes(row.media_type) ? row.media_type : "mixed") as "movie" | "tv" | "mixed",
  }));
}

// deno-lint-ignore no-explicit-any
export async function writeCatalogIndex(admin: any, lists: TaggedList[]): Promise<void> {
  const rows = lists.map((l) => ({
    trakt_id: l.id,
    name: l.name,
    description: l.description ?? "",
    item_count: l.itemCount,
    likes: l.likes,
    tags: l.tags,
    media_type: l.mediaType,
    indexed_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("trakt_list_index")
    .upsert(rows, { onConflict: "trakt_id" });

  if (error) throw new Error(`catalog index write failed: ${error.message}`);
  console.log(`[catalog] wrote ${rows.length} lists to trakt_list_index`);
}
