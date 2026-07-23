import type { ActionContext } from "../../types.ts";
import type { TaggedList } from "../trakt/index.ts";
import { GENRE_NAMES } from "../constants.ts";

// Kept in sync with the client's own "recent" window (recentGenreAffinity in
// app/(tabs)/index.tsx) so "recent" means the same 21 days everywhere in the
// app, not two different definitions.
const RECENT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

function buildUserProfile(ctx: ActionContext): string {
  const lines: string[] = [];

  if (ctx.tasteDNA?.tasteProfile) {
    lines.push(ctx.tasteDNA.tasteProfile);
  }

  if (ctx.tasteDNA?.genreAffinity && Object.keys(ctx.tasteDNA.genreAffinity).length > 0) {
    const topGenres = Object.entries(ctx.tasteDNA.genreAffinity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([id]) => GENRE_NAMES[Number(id)])
      .filter(Boolean);
    if (topGenres.length) lines.push(`Top genres: ${topGenres.join(", ")}`);
  } else if (ctx.favoriteGenres.length) {
    const genres = ctx.favoriteGenres.slice(0, 6).map((id) => GENRE_NAMES[id]).filter(Boolean);
    if (genres.length) lines.push(`Favourite genres: ${genres.join(", ")}`);
  }

  if (ctx.tasteDNA?.thematicInterests?.length) {
    lines.push(`Thematic interests: ${ctx.tasteDNA.thematicInterests.slice(0, 5).join(", ")}`);
  }

  if (ctx.tasteDNA?.recentShift) {
    lines.push(`Recent shift: ${ctx.tasteDNA.recentShift}`);
  }

  // watchedMovies/watchedShows are sorted newest-first (see context.ts), so
  // this is genuinely "most recent", not just "first in whatever order Trakt
  // returned them".
  const recentMovies = ctx.watchedMovies.slice(0, 10).map((m) => m.movie.title).filter(Boolean);
  if (recentMovies.length) lines.push(`Recently watched movies: ${recentMovies.join(", ")}`);

  const recentShows = ctx.watchedShows.slice(0, 6).map((s) => s.show.title).filter(Boolean);
  if (recentShows.length) lines.push(`Recently watched shows: ${recentShows.join(", ")}`);

  // A tighter, genuinely-recent-only slice (last 3 weeks) as a secondary
  // signal — nudges picks toward a real short-term shift without letting a
  // couple of recent watches override the lifetime taste profile above.
  // Requires 2+ titles so one rewatch or one-off pick doesn't read as a trend.
  const now = Date.now();
  const isRecent = (watchedAt: string) => now - new Date(watchedAt).getTime() <= RECENT_WINDOW_MS;
  const trendTitles = [
    ...ctx.watchedMovies.filter((m) => isRecent(m.last_watched_at)).slice(0, 5).map((m) => m.movie.title),
    ...ctx.watchedShows.filter((s) => isRecent(s.last_watched_at)).slice(0, 5).map((s) => s.show.title),
  ].filter(Boolean);
  if (trendTitles.length >= 2) {
    lines.push(
      `Recent viewing trend (last 3 weeks — a secondary signal; let it nudge your picks toward this if it fits naturally, but don't abandon the overall taste profile above for it): ${trendTitles.join(", ")}`
    );
  }

  return lines.join("\n") || "No taste profile — pick varied well-known lists.";
}

export function buildListPickerPrompt(
  catalog: TaggedList[],
  ctx: ActionContext,
): { system: string; user: string } {
  const profile = buildUserProfile(ctx);

  // Format catalog compactly — include item count so AI can avoid short lists
  const catalogLines = catalog
    .map((l) => {
      const desc = l.description ? l.description.slice(0, 100) : "";
      return desc
        ? `${l.id}|${l.name} [${l.itemCount}]|${desc}`
        : `${l.id}|${l.name} [${l.itemCount}]`;
    })
    .join("\n");

  const system = `/no_think
You are a film & TV curator for a personalised streaming discovery app.
Pick exactly 6 Trakt community lists that best match this user's taste.
The list NAME will appear as the row headline — choose lists with clear, appealing names.
IMPORTANT: Only pick lists with 50+ items (the number in brackets). Shorter lists produce sparse rows.
Ensure variety across the 6 picks — mix genres, eras, or moods rather than 6 similar lists.
Output ONLY valid JSON — no markdown, no explanation outside the JSON.`;

  const user = `USER TASTE PROFILE:
${profile}

AVAILABLE TRAKT LISTS (id|name|description, sorted by community likes):
${catalogLines}

Return exactly 6 picks. The "reason" field becomes the row subheading shown under the headline.
{"picks":[{"id":12345,"reason":"One-line subheading for the row"},{"id":67890,"reason":"..."},{"id":11111,"reason":"..."},{"id":22222,"reason":"..."},{"id":33333,"reason":"..."},{"id":44444,"reason":"..."}]}`;

  return { system, user };
}
