import AsyncStorage from '@react-native-async-storage/async-storage';
import { traktApi } from './trakt';
import { tmdbApi } from './tmdb';
import { useWatchlistStore } from '../store/watchlistStore';

// One-way import: Trakt watchlist → NextUp watchlist. Each Trakt entry is
// imported once; anything the user later removes in NextUp stays removed
// (it isn't re-added on the next sync just because it's still on Trakt).

const importedKey = (owner: string) => `nextup_trakt_watchlist_imported_v1:${owner}`;

export async function importTraktWatchlist(
  clientId: string,
  accessToken: string,
  owner: string,
  userId: string | null,
): Promise<number> {
  const entries = await traktApi.getWatchlist(clientId, accessToken);

  let imported: Set<string>;
  try {
    imported = new Set(JSON.parse((await AsyncStorage.getItem(importedKey(owner))) ?? '[]'));
  } catch {
    imported = new Set();
  }

  const store = useWatchlistStore.getState();
  let added = 0;
  // Oldest first, so the most recently listed ends up at the top.
  const candidates = entries
    .filter((e) => e.type === 'movie' || e.type === 'show')
    .sort((a, b) => a.listed_at.localeCompare(b.listed_at));

  for (const entry of candidates) {
    const mediaType = entry.type === 'movie' ? 'movie' : 'tv';
    const tmdbId = (entry.movie ?? entry.show)?.ids.tmdb;
    if (!tmdbId) continue;
    const key = `${mediaType}:${tmdbId}`;
    if (imported.has(key)) continue;
    imported.add(key);
    if (store.isInWatchlist(tmdbId, mediaType)) continue;

    // Trakt has no artwork — the watchlist grid needs a poster.
    const detail = await (mediaType === 'movie'
      ? tmdbApi.getMovieBasic(tmdbId)
      : tmdbApi.getTVBasic(tmdbId)
    ).catch(() => null);
    const title = (entry.movie ?? entry.show)?.title ?? '';
    await store.addToWatchlist(
      { tmdb_id: tmdbId, media_type: mediaType, title, poster_path: detail?.poster_path ?? null },
      userId ?? undefined,
    );
    added++;
  }

  await AsyncStorage.setItem(importedKey(owner), JSON.stringify([...imported])).catch(() => {});
  return added;
}
