import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimHistory, historySignature } from '../lib/traktHistorySlim.ts';

const movie = (tmdb: number, plays = 1, at = '2026-01-01T00:00:00.000Z') => ({
  plays, last_watched_at: at, last_updated_at: at,
  movie: { title: `M${tmdb}`, year: 2020, ids: { tmdb, imdb: `tt${tmdb}`, trakt: tmdb }, slug: 'x' },
});
const show = (tmdb: number, episodes: number) => ({
  plays: episodes, last_watched_at: '2026-02-01T00:00:00.000Z', reset_at: null,
  show: { title: `S${tmdb}`, year: 2020, ids: { tmdb, imdb: '', trakt: tmdb, tvdb: 0 }, slug: 'y' },
  seasons: [{ number: 1, episodes: Array.from({ length: episodes }, (_, i) => ({ number: i + 1, plays: 1, last_watched_at: 'x' })) }],
});

test('slimHistory keeps every item and drops fields the app never reads', () => {
  const slim = slimHistory([movie(1), movie(2)] as any, [show(10, 3)] as any);
  assert.equal(slim.movies.length, 2);
  assert.equal(slim.shows[0].seasons[0].episodes.length, 3);
  assert.deepEqual(Object.keys(slim.shows[0].seasons[0].episodes[0]).sort(), ['number', 'plays']);
  assert.ok(!('slug' in (slim.movies[0].movie as object)));
  assert.ok(!('reset_at' in slim.shows[0]));
});

test('signature changes when history changes, including episode-only changes', () => {
  const a = slimHistory([movie(1)] as any, [show(10, 3)] as any);
  const same = slimHistory([movie(1)] as any, [show(10, 3)] as any);
  const newMovie = slimHistory([movie(1), movie(2)] as any, [show(10, 3)] as any);
  const rewatch = slimHistory([movie(1, 2)] as any, [show(10, 3)] as any);
  const noEpisodes = slimHistory([movie(1)] as any, [{ ...show(10, 3), seasons: [] }] as any);
  assert.equal(historySignature(a), historySignature(same));
  assert.notEqual(historySignature(a), historySignature(newMovie));
  assert.notEqual(historySignature(a), historySignature(rewatch));
  // Regression: the episode-less cache from before extended=progress must not
  // look "unchanged" and skip the cloud upload.
  assert.notEqual(historySignature(a), historySignature(noEpisodes));
});
