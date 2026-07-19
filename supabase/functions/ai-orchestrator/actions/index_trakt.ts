// index_trakt action — downloads the top 200 Trakt public lists (name + description)
// and stores them in trakt_list_index.  No AI call needed — the homepage AI reads
// names + descriptions directly when picking lists for a user.
//
// Run once to populate, then weekly to stay current.
// POST { action: "index_trakt" }

import type { ActionContext } from "../types.ts";
import { CORS_HEADERS } from "../lib/constants.ts";
import { fetchPopularLists } from "../lib/trakt/index.ts";
import { writeCatalogIndex } from "../lib/trakt/catalog.ts";

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonError(msg: string, status = 500): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function handleIndexTrakt(ctx: ActionContext): Promise<Response> {
  const { admin } = ctx;

  console.log("[index_trakt] fetching top 200 Trakt lists...");

  let lists;
  try {
    lists = await fetchPopularLists();
  } catch (e) {
    return jsonError(`Trakt fetch failed: ${(e as Error).message}`);
  }

  // Store with empty tags — the homepage AI picks lists from names + descriptions directly
  const tagged = lists.map((l) => ({ ...l, tags: [], mediaType: "mixed" as const }));

  try {
    await writeCatalogIndex(admin, tagged);
  } catch (e) {
    return jsonError(`Index write failed: ${(e as Error).message}`);
  }

  console.log(`[index_trakt] done — ${tagged.length} lists indexed with names + descriptions`);
  return jsonOk({ success: true, indexed: tagged.length });
}
