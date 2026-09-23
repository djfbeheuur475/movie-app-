import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoredWatchPool } from '../lib/recommendations.ts';

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

test('recent watches outrank old ones at equal plays', () => {
  const pool = buildScoredWatchPool(
    [
      { plays: 1, last_watched_at: daysAgo(400), movie: { title: 'Old', year: 2000, ids: { tmdb: 1, imdb: '', trakt: 1 } } },
      { plays: 1, last_watched_at: daysAgo(2), movie: { title: 'New', year: 2026, ids: { tmdb: 2, imdb: '', trakt: 2 } } },
    ],
    [],
  );
  assert.equal(pool[0].title, 'New');
});

test('minPlaysForShows drops single-episode samples', () => {
  const s = (tmdb: number, plays: number) => ({
    plays, last_watched_at: daysAgo(1), seasons: [],
    show: { title: `S${tmdb}`, year: 2020, ids: { tmdb, imdb: '', trakt: tmdb, tvdb: 0 } },
  });
  const pool = buildScoredWatchPool([], [s(1, 1), s(2, 5)], 2);
  assert.deepEqual(pool.map((p) => p.tmdbId), [2]);
});
