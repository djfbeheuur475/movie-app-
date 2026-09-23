import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeriesProgress } from '../lib/seriesProgress.ts';

const eps = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ number: from + i, plays: 1 }));

const tmdb = {
  id: 1,
  seasons: [
    { season_number: 0, episode_count: 5 }, // specials — ignored
    { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 8 },
  ],
  last_episode_to_air: { season_number: 2, episode_number: 4 },
};

test('mid-season: counts aired episodes only and points at the next one', () => {
  const p = computeSeriesProgress({ seasons: [{ number: 1, episodes: eps(10) }, { number: 2, episodes: eps(2) }] }, tmdb);
  assert.equal(p?.label, 'Next S2 · E3');
  assert.equal(p?.fraction, 12 / 14);
});

test('end of a season rolls over to the next season', () => {
  const p = computeSeriesProgress({ seasons: [{ number: 1, episodes: eps(10) }] }, tmdb);
  assert.equal(p?.label, 'Next S2 · E1');
});

test('caught up with every aired episode', () => {
  const p = computeSeriesProgress({ seasons: [{ number: 1, episodes: eps(10) }, { number: 2, episodes: eps(4) }] }, tmdb);
  assert.equal(p?.label, 'Up to date');
  assert.equal(p?.fraction, 1);
});

test('specials and unplayed episodes do not count', () => {
  const p = computeSeriesProgress({
    seasons: [
      { number: 0, episodes: eps(5) },
      { number: 1, episodes: [...eps(3), { number: 4, plays: 0 }] },
    ],
  }, tmdb);
  assert.equal(p?.label, 'Next S1 · E4');
  assert.equal(p?.fraction, 3 / 14);
});

test('no episode data (pre-extended=progress cache) → no progress', () => {
  assert.equal(computeSeriesProgress({ seasons: [] }, tmdb), undefined);
});

test('show with nothing aired yet → no progress', () => {
  assert.equal(
    computeSeriesProgress({ seasons: [{ number: 1, episodes: eps(1) }] }, { ...tmdb, last_episode_to_air: null }),
    undefined,
  );
});
