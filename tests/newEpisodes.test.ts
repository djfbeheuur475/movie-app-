import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewEpisodes, seasonsToFetch, type ShowForNewEpisodes } from '../lib/newEpisodes.ts';

const NOW = new Date(2026, 8, 25, 20, 0); // Fri 25 Sep 2026, 8pm local
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();
const ymd = (offsetDays: number) => {
  const d = new Date(2026, 8, 25 + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ep = (season: number, episode: number, offsetDays: number | null) =>
  ({ season_number: season, episode_number: episode, air_date: offsetDays === null ? null : ymd(offsetDays) });

const watchedSet = (keys: string[]) => {
  const s = new Set(keys);
  return (id: number, season: number, episode: number) => s.has(`${id}:${season}:${episode}`);
};

test('released + unwatched on an active show is "out", counting every unwatched new episode', () => {
  const shows: ShowForNewEpisodes[] = [{
    showId: 1, lastWatchedAt: daysAgo(3), next: ep(2, 5, 3),
    episodes: [ep(2, 1, -20), ep(2, 2, -10), ep(2, 3, -6), ep(2, 4, -2)],
  }];
  const [e] = buildNewEpisodes(shows, watchedSet(['1:2:1', '1:2:2']), NOW);
  assert.equal(e.status, 'out');
  assert.deepEqual([e.season, e.episode], [2, 3]); // first one they haven't seen
  assert.equal(e.unwatchedCount, 2);
  assert.equal(e.airDate, ymd(-2)); // freshest release, for sorting
});

test('already-watched releases fall back to the upcoming episode', () => {
  const shows: ShowForNewEpisodes[] = [{
    showId: 1, lastWatchedAt: daysAgo(1), next: ep(2, 5, 4),
    episodes: [ep(2, 3, -6), ep(2, 4, -2)],
  }];
  const [e] = buildNewEpisodes(shows, watchedSet(['1:2:3', '1:2:4']), NOW);
  assert.equal(e.status, 'upcoming');
  assert.deepEqual([e.season, e.episode, e.airDate], [2, 5, ymd(4)]);
});

test('shows not watched in the last two weeks are left out', () => {
  const shows: ShowForNewEpisodes[] = [{ showId: 1, lastWatchedAt: daysAgo(20), next: ep(1, 2, 1), episodes: [ep(1, 1, -1)] }];
  assert.equal(buildNewEpisodes(shows, () => false, NOW).length, 0);
});

test('releases older than the lookback, specials and far-off episodes are ignored', () => {
  const shows: ShowForNewEpisodes[] = [{
    showId: 1, lastWatchedAt: daysAgo(2), next: ep(3, 1, 12),
    episodes: [ep(2, 8, -30), ep(0, 1, -1)],
  }];
  assert.equal(buildNewEpisodes(shows, () => false, NOW).length, 0);
});

test('an episode out today is "today"; ordering is today, then out (newest first), then upcoming (soonest first)', () => {
  const shows: ShowForNewEpisodes[] = [
    { showId: 1, lastWatchedAt: daysAgo(1), next: ep(1, 3, 5), episodes: [] },
    { showId: 2, lastWatchedAt: daysAgo(1), next: null, episodes: [ep(1, 1, -8)] },
    { showId: 3, lastWatchedAt: daysAgo(1), next: ep(1, 2, 0), episodes: [] },
    { showId: 4, lastWatchedAt: daysAgo(1), next: null, episodes: [ep(1, 1, -1)] },
    { showId: 5, lastWatchedAt: daysAgo(1), next: ep(4, 1, 2), episodes: [] },
  ];
  const out = buildNewEpisodes(shows, () => false, NOW);
  assert.deepEqual(out.map((e) => [e.showId, e.status]), [[3, 'today'], [4, 'out'], [2, 'out'], [5, 'upcoming'], [1, 'upcoming']]);
});

test('seasonsToFetch only asks for a season whose latest episode is recent', () => {
  assert.deepEqual(seasonsToFetch(ep(3, 6, -5), NOW), [3]);
  assert.deepEqual(seasonsToFetch(ep(3, 6, -40), NOW), []);
  assert.deepEqual(seasonsToFetch(null, NOW), []);
});
