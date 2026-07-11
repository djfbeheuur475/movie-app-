import React, { useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { traktApi, TraktUnauthorizedError } from '../../lib/trakt';
import { filterAndRankContent, passesQualityFilter } from '../../lib/quality';
import {
  getTemporalContext, loadRecentRowTitles, saveShownRowTitles,
  computeGenreAffinity, computeTasteProfile, deterministicPage,
  computeContentFingerprint, inferTasteMode,
  loadShownRowsFromCloud, saveShownRowsToCloud,
  loadItemCooldowns, saveItemCooldowns,
  loadDiscoverCache, saveDiscoverCache,
  saveProfileSnapshot,
  loadTasteNeighborhood, saveTasteNeighborhood,
} from '../../lib/tasteDna';
import type { GenreAffinity, TasteProfile } from '../../lib/tasteDna';
import { selectRowTemplates, buildTasteNarration, applyProfileToTemplate, GENRE_LABELS } from '../../lib/templateSelector';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useAuthStore } from '../../store/authStore';
import { usePreferencesStore } from '../../store/preferencesStore';
import HeroSection from '../../components/home/HeroSection';
import ContentRow from '../../components/home/ContentRow';
import NewEpsRow from '../../components/home/NewEpsRow';
import RecentlyWatchedRow from '../../components/home/RecentlyWatchedRow';
import TasteModeChip from '../../components/home/TasteModeChip';
import LoadingSkeleton from '../../components/common/LoadingSkeleton';
import type { ContentItem } from '../../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_SKELETON_HEIGHT = SCREEN_HEIGHT * 0.55;

// ─── Niche content mismatch filter ───────────────────────────────────────────
// Niche genres and eras bleed into broad queries because TMDB applies them as
// secondary tags. Suppress content outside these niches unless the user's
// history shows real affinity for them. Default: assume NOT interested.

function isMismatchedNiche(
  item: ContentItem,
  templateGenreIds: number[],
  genreAffinity: GenreAffinity,
  profile?: TasteProfile,
  templateEraFit?: 'classic' | 'nineties' | 'modern',
): boolean {
  const itemGenres = new Set(item.genres ?? []);
  const templateGenres = new Set(templateGenreIds);
  const hasHistory = Object.keys(genreAffinity).length > 0;

  // Animation (16): filter unless the user has demonstrated real affinity (>10% of history).
  // When no history yet, still filter — animation almost never belongs in BYW or thematic rows
  // that didn't request it. Users who love animation will quickly cross the threshold.
  if (itemGenres.has(16) && !templateGenres.has(16)) {
    if (!hasHistory || (genreAffinity[16] ?? 0) < 0.10) return true;
  }
  // Family (10751): same logic, lower threshold
  if (itemGenres.has(10751) && !templateGenres.has(10751)) {
    if (!hasHistory || (genreAffinity[10751] ?? 0) < 0.08) return true;
  }
  // Kids TV (10762): always filter unless explicitly requested
  if (itemGenres.has(10762) && !templateGenres.has(10762)) {
    if (!hasHistory || (genreAffinity[10762] ?? 0) < 0.05) return true;
  }

  // Classic era (pre-1980): treat like animation — a niche the user must earn.
  // Skip this check for templates that explicitly target classic/vintage content
  // (new-hollywood, classic-cinema) so those rows still work for classic fans.
  if (templateEraFit !== 'classic') {
    const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2020;
    if (year < 1980) {
      const classicAffinity = profile?.eraAffinity.classic ?? 0;
      // Filter unless at least 15% of their history is classic-era content
      if (!hasHistory || classicAffinity < 0.15) return true;
    }
  }

  return false;
}

// ─── Behavioural ranking ───────────────────────────────────────────────────────
// Re-ranks TMDB Discover results by taste fit rather than generic quality sort.
// Quality becomes a floor (via voteAverageGte) rather than the ranking mechanism.

function rankItemsByProfile(
  items: ContentItem[],
  profile: TasteProfile | undefined,
  genreAffinity: GenreAffinity,
  tasteNeighborhood: Set<number>,
): ContentItem[] {
  if (!profile && Object.keys(genreAffinity).length === 0) return items;

  const affinityEntries = Object.entries(genreAffinity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id, w]) => [Number(id), w] as [number, number]);
  const totalAffinity = affinityEntries.reduce((s, [, w]) => s + w, 0);

  const darkness  = profile?.darknessScore    ?? 0.3;
  const novelty   = profile?.noveltyTolerance ?? 0.3;
  const prestige  = profile?.prestigeScore    ?? 0.5;
  const eraAff    = profile?.eraAffinity      ?? { classic: 0.1, nineties: 0.15, modern: 0.75 };

  const scored = items.map(item => {
    const genres = new Set(item.genres ?? []);

    // 1. Genre affinity match (normalised 0–1)
    const matched = affinityEntries.reduce((s, [id, w]) => s + (genres.has(id) ? w : 0), 0);
    const affinityScore = totalAffinity > 0 ? matched / totalAffinity : 0;

    // 2. Era fit
    const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2010;
    const era = year < 1990 ? 'classic' : year < 2000 ? 'nineties' : 'modern';
    const eraScore = eraAff[era] ?? 0.3;

    // 3. Quality fit — calibrated by prestige preference so high-prestige users rank by rating,
    //    while mainstream users aren't penalised for preferring popular films over obscure gems.
    const rating = item.rating ?? 0;
    const ratingNorm = Math.max(0, Math.min((rating - 6.0) / 4.0, 1));
    const qualityScore = ratingNorm * (0.4 + prestige * 0.6);

    // 4. Novelty fit — matches obscure vs popular content to user's tolerance.
    const votes = Math.max(item.voteCount ?? 0, 1);
    const popularityRatio = Math.min(Math.log10(votes) / Math.log10(100000), 1);
    const noveltyScore = novelty > 0.50 ? (1 - popularityRatio) : popularityRatio;

    // 5. Darkness fit
    const isDark = genres.has(27) || genres.has(53) || genres.has(80) || genres.has(9648);
    const darknessScore = isDark ? darkness : Math.max(0, 1 - darkness * 2);

    // 6. Taste neighbourhood bonus — items TMDB recommends based on films you've actually watched.
    const neighborBonus = tasteNeighborhood.has(item.id) ? 1 : 0;

    return {
      item,
      score: affinityScore  * 0.30
           + qualityScore   * 0.20
           + eraScore       * 0.12
           + noveltyScore   * 0.13
           + darknessScore  * 0.10
           + neighborBonus  * 0.15,
    };
  });

  return scored.sort((a, b) => b.score - a.score).map(x => x.item);
}

export default function HomeScreen() {
  const router = useRouter();
  const { traktClientId, traktUsername, traktAccessToken, geminiKey, handleTraktUnauthorized } = useApiKeysStore();
  const { items: watchlistItems } = useWatchlistStore();
  const { user } = useAuthStore();
  const { favoriteGenres } = usePreferencesStore();
  const userId = user?.id ?? null;
  const hasTrakt = !!(traktClientId && (traktUsername || traktAccessToken));
  const hasGemini = !!(geminiKey?.trim());

  // ─── Trending (hero only) ──────────────────────────────────────────────────

  const { data: trending, isLoading: trendingLoading, refetch: refetchTrending } = useQuery({
    queryKey: ['trending'],
    queryFn: () => tmdbApi.getTrending('all', 'week'),
  });

  // ─── Popular content ───────────────────────────────────────────────────────

  const { data: popularMovies, isLoading: moviesLoading } = useQuery({
    queryKey: ['popular-movies'],
    queryFn: () => tmdbApi.getPopularMovies(),
  });

  const { data: popularShows, isLoading: showsLoading } = useQuery({
    queryKey: ['popular-shows'],
    queryFn: () => tmdbApi.getPopularShows(),
  });

  // ─── Trakt watch history ───────────────────────────────────────────────────

  const queryClient = useQueryClient();

  const { data: traktMovies, isFetched: traktMoviesFetched, error: traktMoviesError } = useQuery({
    queryKey: ['trakt-watched-movies', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
    retry: (count, error) => !(error instanceof TraktUnauthorizedError) && count < 2,
  });

  const { data: traktShows, isFetched: traktShowsFetched } = useQuery({
    queryKey: ['trakt-watched-shows', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedShows(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
    retry: (count, error) => !(error instanceof TraktUnauthorizedError) && count < 2,
  });

  // When Trakt returns 401, try to refresh the token silently then re-fetch
  useEffect(() => {
    if (traktMoviesError instanceof TraktUnauthorizedError) {
      handleTraktUnauthorized().then((refreshed) => {
        if (refreshed) {
          queryClient.invalidateQueries({ queryKey: ['trakt-watched-movies'] });
          queryClient.invalidateQueries({ queryKey: ['trakt-watched-shows'] });
        }
      });
    }
  }, [traktMoviesError]);

  // tmdbId → play count from Trakt (used for affinity weighting)
  const playsMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of traktMovies ?? []) {
      if (m.movie.ids.tmdb) map.set(m.movie.ids.tmdb, m.plays);
    }
    for (const s of traktShows ?? []) {
      if (s.show.ids.tmdb) map.set(s.show.ids.tmdb, s.plays);
    }
    return map;
  }, [traktMovies, traktShows]);

  // Merge movies + shows, sort by play-count × recency, deduplicate, take top 12
  const recentIds = useMemo(() => {
    const recencyWeight = (watchedAt: string) => {
      const days = (Date.now() - new Date(watchedAt).getTime()) / 86400000;
      return Math.exp(-days / 90);
    };
    const combined = [
      ...(traktMovies ?? []).map((m) => ({
        tmdbId: m.movie.ids.tmdb,
        mediaType: 'movie' as const,
        watchedAt: m.last_watched_at,
        title: m.movie.title,
        score: m.plays * recencyWeight(m.last_watched_at),
      })),
      ...(traktShows ?? []).map((s) => ({
        tmdbId: s.show.ids.tmdb,
        mediaType: 'tv' as const,
        watchedAt: s.last_watched_at,
        title: s.show.title,
        // Cap TV plays at 12 — episode count otherwise inflates score vs movies
        score: Math.min(s.plays, 12) * recencyWeight(s.last_watched_at),
      })),
    ];
    const seen = new Set<number>();
    return combined
      .filter(({ tmdbId }) => !!tmdbId)
      .sort((a, b) => b.score - a.score)
      .filter(({ tmdbId }) => {
        if (seen.has(tmdbId)) return false;
        seen.add(tmdbId);
        return true;
      })
      .slice(0, 12);
  }, [traktMovies, traktShows]);

  const { data: historyItems, isLoading: historyLoading } = useQuery({
    queryKey: ['home-history', recentIds.map((i) => `${i.tmdbId}-${i.mediaType}`)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        recentIds.map(({ tmdbId, mediaType }) =>
          mediaType === 'movie'
            ? tmdbApi.getMovieDetail(tmdbId).then(normalizeMovie)
            : tmdbApi.getTVDetail(tmdbId).then(normalizeTVShow)
        )
      );
      return results
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: recentIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // Map tmdbId -> last watched episode (highest season+ep with plays > 0)
  const lastEpisodes = useMemo(() => {
    const map = new Map<number, { season: number; episode: number }>();
    for (const s of traktShows ?? []) {
      const tmdbId = s.show.ids.tmdb;
      if (!tmdbId) continue;
      let bestSeason = 0, bestEp = 0;
      for (const season of s.seasons ?? []) {
        for (const ep of season.episodes) {
          if (ep.plays > 0) {
            if (
              season.number > bestSeason ||
              (season.number === bestSeason && ep.number > bestEp)
            ) {
              bestSeason = season.number;
              bestEp = ep.number;
            }
          }
        }
      }
      if (bestSeason > 0) map.set(tmdbId, { season: bestSeason, episode: bestEp });
    }
    return map;
  }, [traktShows]);

  // ─── New Eps This Week ─────────────────────────────────────────────────────

  const watchlistShowIds = useMemo(
    () => watchlistItems.filter((i) => i.media_type === 'tv').map((i) => i.tmdb_id),
    [watchlistItems]
  );

  const newEpsShowIds = useMemo(() => {
    const traktIds = (traktShows ?? [])
      .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
      .map((s) => s.show.ids.tmdb)
      .filter((id): id is number => !!id);
    const seen = new Set(watchlistShowIds);
    const merged = [...watchlistShowIds];
    traktIds.forEach((id) => {
      if (!seen.has(id)) { seen.add(id); merged.push(id); }
    });
    return merged.slice(0, 24);
  }, [watchlistShowIds, traktShows]);

  const { data: newEpsShowDetails, isLoading: newEpsLoading } = useQuery({
    queryKey: ['home-new-eps', newEpsShowIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        newEpsShowIds.map((id) => tmdbApi.getTVDetail(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: newEpsShowIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  const newEpsThisWeek = useMemo((): any[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return (newEpsShowDetails ?? [])
      .filter((show: any) => {
        if (!show.next_episode_to_air?.air_date) return false;
        const [y, m, d] = show.next_episode_to_air.air_date.split('-').map(Number);
        const airDate = new Date(y, m - 1, d);
        return airDate >= today && airDate <= weekFromNow;
      })
      .sort((a: any, b: any) => {
        const [ay, am, ad] = a.next_episode_to_air.air_date.split('-').map(Number);
        const [by, bm, bd] = b.next_episode_to_air.air_date.split('-').map(Number);
        return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime();
      });
  }, [newEpsShowDetails]);

  // ─── Continue Watching ────────────────────────────────────────────────────
  // TV shows the user has started but not finished: last watched season < total
  // seasons, or the show is still returning. Sorted by most recently watched.
  const continueWatchingItems: ContentItem[] = useMemo(() => {
    if (!newEpsShowDetails?.length || lastEpisodes.size === 0) return [];

    const recencyMap = new Map<number, number>();
    for (const s of traktShows ?? []) {
      if (s.show.ids.tmdb) {
        recencyMap.set(s.show.ids.tmdb, new Date(s.last_watched_at).getTime());
      }
    }

    return (newEpsShowDetails as any[])
      .filter((show: any) => {
        const lastEp = lastEpisodes.get(show.id);
        if (!lastEp) return false; // watchlist-only, never played
        return (
          lastEp.season < show.number_of_seasons ||
          show.status === 'Returning Series'
        );
      })
      .sort((a: any, b: any) => {
        const ra = recencyMap.get(a.id) ?? 0;
        const rb = recencyMap.get(b.id) ?? 0;
        return rb - ra;
      })
      .slice(0, 16)
      .map(normalizeTVShow);
  }, [newEpsShowDetails, lastEpisodes, traktShows]);

  // Genre affinity — play-weighted from Trakt history; falls back to stated preferences
  const genreAffinity = useMemo((): GenreAffinity => {
    const fromHistory = computeGenreAffinity(historyItems ?? [], playsMap);
    if (Object.keys(fromHistory).length > 0 || favoriteGenres.length === 0) return fromHistory;
    // No Trakt history — bootstrap from user's stated genre preferences
    const weight = 1 / favoriteGenres.length;
    const synthetic: GenreAffinity = {};
    for (const id of favoriteGenres) synthetic[id] = weight;
    return synthetic;
  }, [historyItems, playsMap, favoriteGenres]);

  // Recent-shift affinity — genre affinity from items watched in the last 3 weeks only.
  // Used to boost template rows matching the user's current mood over their lifetime history.
  const recentGenreAffinity = useMemo((): GenreAffinity => {
    if (!historyItems?.length || !recentIds.length) return {};
    const threeWeeksMs = 21 * 24 * 60 * 60 * 1000;
    const recentIdSet = new Set(
      recentIds
        .filter(r => Date.now() - new Date(r.watchedAt).getTime() < threeWeeksMs)
        .map(r => r.tmdbId)
    );
    const recentItems = historyItems.filter(item => recentIdSet.has(item.id));
    if (recentItems.length === 0) return {};
    // Uniform weight per item — recency signal, not play count
    const uniformPlays = new Map(recentItems.map(item => [item.id, 1]));
    return computeGenreAffinity(recentItems, uniformPlays);
  }, [historyItems, recentIds]);

  // Top 2 genre IDs by affinity weight — used for the Trending in [Genre] row
  const topGenreEntries = useMemo(() =>
    Object.entries(genreAffinity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([id]) => Number(id)),
    [genreAffinity]
  );

  // ─── Thematic rows (Taste DNA) ────────────────────────────────────────────
  // Temporal context drives row rotation — dateKey changes every 6h
  const temporal = useMemo(() => getTemporalContext(), []);

  const traktMovieFingerprint = (traktMovies ?? []).slice(0, 10).map((m) => m.movie.ids.tmdb).join(',');
  const traktShowFingerprint = (traktShows ?? []).slice(0, 10).map((s) => s.show.ids.tmdb).join(',');

  // Wait until Trakt has settled before firing so DNA gets real history
  const traktReady = !hasTrakt || (traktMoviesFetched && traktShowsFetched);

  const { data: thematicData, isLoading: thematicLoading, refetch: refetchThematic } = useQuery({
    // Removed geminiKey from queryKey — homepage no longer calls Gemini
    queryKey: ['thematic-rows-v10', traktMovieFingerprint, traktShowFingerprint, temporal.dateKey],
    queryFn: async () => {
      const movies = traktMovies ?? [];
      const shows = traktShows ?? [];

      // Load recently-shown row themes (local + cloud) to avoid repetition
      const [localTitles, cloudTitles] = await Promise.all([
        loadRecentRowTitles(),
        userId ? loadShownRowsFromCloud(userId) : Promise.resolve([] as string[]),
      ]);
      const recentRowTitles = [...new Set([...cloudTitles, ...localTitles])].slice(0, 20);

      // Compute profile deterministically — no Gemini call
      const hasRewatches = movies.some(m => m.plays > 1) || shows.some(s => s.plays > 1);
      const tasteMode = inferTasteMode(genreAffinity, temporal, hasRewatches);
      const profile: TasteProfile | undefined = historyItems && historyItems.length > 0
        ? computeTasteProfile(historyItems, playsMap, genreAffinity)
        : undefined;

      // Build taste neighbourhood from TMDB recommendations for top-played items.
      // Cached 24h — these IDs become a ranking bonus signal inside each row.
      let tasteNeighborhood: Set<number> = (await loadTasteNeighborhood()) ?? new Set();
      if (tasteNeighborhood.size === 0 && historyItems && historyItems.length > 0) {
        const seeds = [...historyItems]
          .sort((a, b) => (playsMap.get(b.id) ?? 1) - (playsMap.get(a.id) ?? 1))
          .slice(0, 5);
        const neighborResults = await Promise.allSettled(
          seeds.map(item =>
            item.mediaType === 'movie'
              ? tmdbApi.getMovieRecommendations(item.id).then(r => r.map(normalizeMovie))
              : tmdbApi.getTVRecommendations(item.id).then(r => r.map(normalizeTVShow))
          )
        );
        const ids: number[] = [];
        for (const r of neighborResults) {
          if (r.status === 'fulfilled') r.value.forEach(item => ids.push(item.id));
        }
        if (ids.length > 0) {
          tasteNeighborhood = new Set(ids);
          saveTasteNeighborhood(ids); // non-blocking
        }
      }

      // Select templates deterministically — ZERO Gemini calls
      // Fallback: if dedup exhausts all eligible templates, run again without the exclusion list
      let selectedTemplates = selectRowTemplates(profile, genreAffinity, temporal, recentRowTitles, recentGenreAffinity);
      if (selectedTemplates.length === 0) {
        selectedTemplates = selectRowTemplates(profile, genreAffinity, temporal, [], recentGenreAffinity);
      }
      console.log(`[ThematicRows] ${selectedTemplates.length} templates, neighborhood=${tasteNeighborhood.size} ids, mode=${tasteMode}`);

      // Build taste narration without Gemini
      const tasteProfile = buildTasteNarration(profile, genreAffinity, tasteMode);

      // Save profile snapshot for AI tab (replaces DNA persistence on this path)
      const fingerprint = computeContentFingerprint(movies, shows);
      saveProfileSnapshot({ profile, genreAffinity, tasteMode, tasteProfile, fingerprint, savedAt: Date.now() });

      const watchedIds = new Set<number>([
        ...movies.map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...shows.map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);

      // Load 7-day item-level cooldowns to suppress recently surfaced titles
      const cooldownIds = await loadItemCooldowns(userId);

      const rowResults = await Promise.allSettled(
        selectedTemplates.map(async (rawTemplate, rowIndex) => {
          // Apply profile-driven parameter modulation — same template, different content pool per user
          const row = applyProfileToTemplate(rawTemplate, profile);

          // Fetch 3 pages (60 candidates) so heavy watchedIds filters still leave enough items
          const offsetPage = deterministicPage(temporal.dateKey, rowIndex); // 1–3
          const pages = offsetPage === 1 ? [1, 2, 3] : [1, offsetPage, Math.min(offsetPage + 1, 5)];

          async function fetchPage(p: number) {
            const cacheParams = {
              type: row.type, genreIds: row.genreIds, excludeGenres: row.excludeGenres ?? null,
              withKeywords: row.withKeywords ?? null, sortBy: row.sortBy,
              voteAverageGte: row.voteAverageGte, voteCountGte: row.voteCountGte,
              releaseDateGte: row.releaseDateGte ?? null, releaseDateLte: row.releaseDateLte ?? null,
              runtimeGte: row.runtimeGte ?? null, runtimeLte: row.runtimeLte ?? null,
              originCountry: row.originCountry ?? null, page: p,
            };
            const cached = await loadDiscoverCache(cacheParams);
            if (cached) return cached as ContentItem[];

            const results = row.type === 'movie'
              ? (await tmdbApi.discoverMoviesTyped({
                  genreIds: row.genreIds, excludeGenres: row.excludeGenres,
                  withKeywords: row.withKeywords, sortBy: row.sortBy,
                  voteAverageGte: row.voteAverageGte, voteCountGte: row.voteCountGte,
                  releaseDateGte: row.releaseDateGte, releaseDateLte: row.releaseDateLte,
                  runtimeGte: row.runtimeGte, runtimeLte: row.runtimeLte,
                  originCountry: row.originCountry, page: p,
                })).map(normalizeMovie)
              : (await tmdbApi.discoverShowsTyped({
                  genreIds: row.genreIds, excludeGenres: row.excludeGenres,
                  withKeywords: row.withKeywords, sortBy: row.sortBy,
                  voteAverageGte: row.voteAverageGte, voteCountGte: row.voteCountGte,
                  firstAirDateGte: row.releaseDateGte, firstAirDateLte: row.releaseDateLte,
                  originCountry: row.originCountry, page: p,
                })).map(normalizeTVShow);

            saveDiscoverCache(cacheParams, results); // non-blocking
            return results;
          }

          const pageResults = await Promise.all(pages.map(fetchPage));

          const seen = new Set<number>();
          const merged = pageResults.flat().filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });

          const filtered = merged
            .filter((item) => !watchedIds.has(item.id))
            .filter((item) => !cooldownIds.has(item.id))
            .filter((item) => passesQualityFilter(item, 'discover'))
            .filter((item) => !isMismatchedNiche(item, rawTemplate.genreIds, genreAffinity, profile, rawTemplate.eraFit));

          // Re-rank by behavioural fit — shifts from "best rated in genre" to "best for you"
          const items = rankItemsByProfile(filtered, profile, genreAffinity, tasteNeighborhood)
            .slice(0, 20);

          return { ...rawTemplate, items };
        })
      );

      // Cross-row dedup — same TMDB ID can't appear in two rows
      const seenIds = new Set<number>();
      const rows = rowResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value)
        .map((row) => ({
          ...row,
          items: row.items.filter((item: ContentItem) => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
          }),
        }))
        .filter((r) => r.items.length >= 3);

      console.log(`[ThematicRows] ${rows.length} rows ready`);
      return { tasteProfile, tasteMode, rows, profile };
    },
    enabled: traktReady, // no longer requires Gemini key
    staleTime: 1000 * 60 * 60 * 6,
    retry: 1,
  });

  const thematicRows = thematicData?.rows ?? [];
  const tasteMode = thematicData?.tasteMode ?? null;

  // Track which row titles have already been saved to cloud this session
  const savedCloudRowTitlesRef = useRef<Set<string>>(new Set());

  // Save shown row titles + surfaced item cooldowns after data loads
  useEffect(() => {
    if (thematicRows.length > 0) {
      const titles = thematicRows.map((r: any) => r.title);
      saveShownRowTitles(titles);

      // Only insert cloud rows that haven't been saved yet this session
      if (userId) {
        const newTitles = titles.filter((t: string) => !savedCloudRowTitlesRef.current.has(t));
        if (newTitles.length > 0) {
          saveShownRowsToCloud(userId, newTitles);
          newTitles.forEach((t: string) => savedCloudRowTitlesRef.current.add(t));
        }
      }

      const surfacedIds = thematicRows.flatMap((r: any) => r.items.map((i: ContentItem) => i.id));
      if (surfacedIds.length > 0) saveItemCooldowns(surfacedIds, userId);
    }
  }, [thematicData, userId]);
  const thematicWaiting = !traktReady || thematicLoading;

  // ─── If You Liked… ────────────────────────────────────────────────────────
  // Pick 2 seeds from the top-6 history pool. Seed2 is chosen to be as different
  // as possible from seed1 — prefer a different media type, then different top genre.
  // Both rotate daily so the pair changes overnight.
  const [seed1, seed2] = useMemo(() => {
    const pool = recentIds.slice(0, Math.min(6, recentIds.length));
    if (pool.length === 0) return [null, null] as const;

    const dayKey = temporal.dateKey.slice(0, 10);
    const dayHash = dayKey.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const i1 = dayHash % pool.length;
    const s1 = pool[i1];
    if (pool.length === 1) return [s1, null] as const;

    // Build a quick genre lookup from historyItems
    const historyGenres = new Map<number, Set<number>>(
      (historyItems ?? []).map(item => [item.id, new Set(item.genres ?? [])])
    );
    const s1Genres = historyGenres.get(s1.tmdbId) ?? new Set<number>();

    // Score each candidate for seed2: prefer different type, then fewer shared genres
    const candidates = pool
      .map((item, i) => {
        if (i === i1) return null;
        const typeDiff = item.mediaType !== s1.mediaType ? 2 : 0;
        const genres = historyGenres.get(item.tmdbId) ?? new Set<number>();
        const sharedGenres = [...s1Genres].filter(g => genres.has(g)).length;
        // Higher score = more different from seed1
        return { item, diversity: typeDiff + Math.max(0, 4 - sharedGenres) };
      })
      .filter((x): x is { item: typeof pool[0]; diversity: number } => x !== null);

    candidates.sort((a, b) => b.diversity - a.diversity || 0);
    // Among equally diverse candidates, rotate daily
    const topDiversity = candidates[0]?.diversity ?? 0;
    const topCandidates = candidates.filter(c => c.diversity === topDiversity);
    const s2 = topCandidates[dayHash % topCandidates.length]?.item ?? candidates[0]?.item ?? null;

    return [s1, s2] as const;
  }, [recentIds, temporal.dateKey, historyItems]);

  // Prevents caching unfiltered results when historyItems loads after first fire
  const bywAffinityKey = Object.keys(genreAffinity).length > 0 ? 'history' : 'empty';

  const { data: ifYouLikedRows } = useQuery({
    queryKey: ['if-you-liked-v1', seed1?.tmdbId, seed2?.tmdbId, bywAffinityKey],
    queryFn: async () => {
      const seeds = [seed1, seed2].filter((s): s is NonNullable<typeof s> => s != null);
      if (seeds.length === 0) return [];

      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);

      const dominant = Object.entries(genreAffinity)
        .sort(([, a], [, b]) => b - a).slice(0, 4).map(([id]) => Number(id));
      const profile = thematicData?.profile as TasteProfile | undefined;

      async function fetchSimilarItems(seed: typeof seeds[0]): Promise<ContentItem[]> {
        // /similar uses genre+keyword metadata; /recommendations uses collaborative filtering.
        // Merge with /similar prioritised — more accurate for niche content.
        const [similarRaw, recsRaw] = await Promise.all(
          seed.mediaType === 'movie'
            ? [
                tmdbApi.getMovieSimilar(seed.tmdbId).then(r => r.map(normalizeMovie)),
                tmdbApi.getMovieRecommendations(seed.tmdbId).then(r => r.map(normalizeMovie)),
              ]
            : [
                tmdbApi.getTVSimilar(seed.tmdbId).then(r => r.map(normalizeTVShow)),
                tmdbApi.getTVRecommendations(seed.tmdbId).then(r => r.map(normalizeTVShow)),
              ]
        );

        const seen = new Set<number>();
        const merged: ContentItem[] = [];
        for (const item of [...similarRaw, ...recsRaw]) {
          if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
        }

        const filtered = merged
          .filter((item) => !watchedSet.has(item.id))
          .filter((item) => passesQualityFilter(item, 'discover'))
          .filter((item) => !isMismatchedNiche(item, [], genreAffinity, profile));

        if (dominant.length === 0) return filtered.slice(0, 20);

        const ranked = filtered.map(item => {
          const itemGenres = new Set(item.genres ?? []);
          const genreMatch = dominant.filter(g => itemGenres.has(g)).length / dominant.length;
          const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4), 10) : 2010;
          const era = profile?.eraAffinity ?? { classic: 0.1, nineties: 0.15, modern: 0.75 };
          const eraScore = year < 1990 ? era.classic : year < 2000 ? era.nineties : era.modern;
          const prestige = profile?.prestigeScore ?? 0.5;
          const qualityBonus = prestige > 0.45 ? Math.max(0, ((item.rating ?? 0) - 7.0) / 3.0) * prestige : 0;
          const novelty = profile?.noveltyTolerance ?? 0.3;
          const popularityFit = novelty > 0.5
            ? Math.max(0, 1 - (item.voteCount ?? 0) / 8000) * 0.1
            : Math.min((item.voteCount ?? 0) / 5000, 1) * 0.1;
          return { item, score: genreMatch * 0.5 + eraScore * 0.15 + qualityBonus * 0.25 + popularityFit };
        });

        return ranked.sort((a, b) => b.score - a.score).map(x => x.item).slice(0, 20);
      }

      const rowData = await Promise.all(seeds.map(fetchSimilarItems));

      // Cross-row dedup: an item can only appear in the first "if you liked" row it fits
      const seenAcrossRows = new Set<number>();
      return seeds.map((seed, i) => ({
        seed,
        items: rowData[i].filter(item => {
          if (seenAcrossRows.has(item.id)) return false;
          seenAcrossRows.add(item.id);
          return true;
        }),
      })).filter(r => r.items.length >= 3);
    },
    enabled: !!seed1 && traktReady,
    staleTime: 1000 * 60 * 60,
  });

  // ─── Because You Watched rows ─────────────────────────────────────────────
  // Three independent seeds from the top of the recent-watch list, each
  // producing its own row titled with the actual show/movie name.
  const bywSeeds = recentIds.slice(0, 3);

  const { data: bywRows } = useQuery({
    queryKey: ['because-you-watched-v2', bywSeeds.map(s => `${s.tmdbId}-${s.mediaType}`).join(','), bywAffinityKey],
    queryFn: async () => {
      if (bywSeeds.length === 0) return [];
      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);
      const profile = thematicData?.profile as TasteProfile | undefined;
      const dominant = Object.entries(genreAffinity)
        .sort(([, a], [, b]) => b - a).slice(0, 4).map(([id]) => Number(id));

      async function fetchSeedItems(seed: typeof bywSeeds[0]): Promise<ContentItem[]> {
        const [similarRaw, recsRaw] = await Promise.all(
          seed.mediaType === 'movie'
            ? [
                tmdbApi.getMovieSimilar(seed.tmdbId).then(r => r.map(normalizeMovie)),
                tmdbApi.getMovieRecommendations(seed.tmdbId).then(r => r.map(normalizeMovie)),
              ]
            : [
                tmdbApi.getTVSimilar(seed.tmdbId).then(r => r.map(normalizeTVShow)),
                tmdbApi.getTVRecommendations(seed.tmdbId).then(r => r.map(normalizeTVShow)),
              ]
        );

        const seen = new Set<number>([seed.tmdbId]);
        const merged: ContentItem[] = [];
        for (const item of [...similarRaw, ...recsRaw]) {
          if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
        }

        const filtered = merged
          .filter(item => !watchedSet.has(item.id))
          .filter(item => passesQualityFilter(item, 'discover'))
          .filter(item => !isMismatchedNiche(item, [], genreAffinity, profile));

        if (dominant.length === 0) return filtered.slice(0, 20);

        return filtered
          .map(item => {
            const itemGenres = new Set(item.genres ?? []);
            const genreMatch = dominant.filter(g => itemGenres.has(g)).length / dominant.length;
            const prestige = profile?.prestigeScore ?? 0.5;
            const qualityBonus = prestige > 0.45 ? Math.max(0, ((item.rating ?? 0) - 7.0) / 3.0) * prestige : 0;
            return { item, score: genreMatch * 0.6 + qualityBonus * 0.4 };
          })
          .sort((a, b) => b.score - a.score)
          .map(x => x.item)
          .slice(0, 20);
      }

      const rowData = await Promise.all(bywSeeds.map(fetchSeedItems));

      // Cross-row dedup: a title can only appear in the first BYW row it fits
      const seenAcrossRows = new Set<number>();
      return bywSeeds.map((seed, i) => ({
        seed,
        items: rowData[i].filter(item => {
          if (seenAcrossRows.has(item.id)) return false;
          seenAcrossRows.add(item.id);
          return true;
        }),
      })).filter(r => r.items.length >= 3);
    },
    enabled: bywSeeds.length > 0 && traktReady,
    staleTime: 1000 * 60 * 60,
  });

  // ─── Trending in [Your Genre] row ────────────────────────────────────────
  // Discovers popular recent content filtered to the user's top 2 genres.
  // Title is dynamic: "Trending in Crime & Thriller".
  const { data: trendingInGenreData } = useQuery({
    queryKey: ['trending-in-genre-v1', topGenreEntries.join(',')],
    queryFn: async () => {
      const genreLabel = topGenreEntries
        .map(id => GENRE_LABELS[id])
        .filter(Boolean)
        .map(l => l!.charAt(0).toUpperCase() + l!.slice(1))
        .join(' & ');

      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      const dateGte = threeYearsAgo.toISOString().slice(0, 10);

      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);

      const [movieResults, tvResults] = await Promise.all([
        tmdbApi.discoverMoviesTyped({
          genreIds: topGenreEntries,
          sortBy: 'popularity.desc',
          voteAverageGte: 6.5,
          voteCountGte: 500,
          releaseDateGte: dateGte,
        }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverShowsTyped({
          genreIds: topGenreEntries,
          sortBy: 'popularity.desc',
          voteAverageGte: 7.0,
          voteCountGte: 200,
          firstAirDateGte: dateGte,
        }).then(r => r.map(normalizeTVShow)),
      ]);

      // Interleave movies and TV to vary media type across the row
      const seen = new Set<number>();
      const merged: ContentItem[] = [];
      const maxLen = Math.max(movieResults.length, tvResults.length);
      for (let i = 0; i < maxLen; i++) {
        if (movieResults[i] && !seen.has(movieResults[i].id)) {
          seen.add(movieResults[i].id);
          merged.push(movieResults[i]);
        }
        if (tvResults[i] && !seen.has(tvResults[i].id)) {
          seen.add(tvResults[i].id);
          merged.push(tvResults[i]);
        }
      }

      const profile = thematicData?.profile as TasteProfile | undefined;
      const items = merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .filter(item => !isMismatchedNiche(item, topGenreEntries, genreAffinity, profile))
        .slice(0, 24);

      return { title: `Trending in ${genreLabel || 'Your Genre'}`, items };
    },
    enabled: topGenreEntries.length > 0 && traktReady,
    staleTime: 1000 * 60 * 60 * 4,
  });

  // ─── Hidden Gems For You ─────────────────────────────────────────────────
  // Low vote count (floor 300, ceiling tuned to noveltyTolerance) + high quality (≥7.5).
  // Uses top 4 genres for a broader pool and skips the niche mismatch filter so
  // foreign, indie, and unusual content can surface freely.
  const { data: hiddenGemsData } = useQuery({
    queryKey: ['hidden-gems-v1', topGenreEntries.join(','), bywAffinityKey],
    queryFn: async () => {
      const profile = thematicData?.profile as TasteProfile | undefined;
      const novelty = profile?.noveltyTolerance ?? 0.3;

      // Adventurous users get a tighter upper cap — more obscure picks
      const voteCountMax = novelty > 0.60 ? 1500 : novelty > 0.35 ? 3000 : 5000;

      // Classic-affinity users get a wider date range to include older gems
      const classicAffinity = profile?.eraAffinity?.classic ?? 0;
      const yearFrom = classicAffinity > 0.20 ? 1970 : 2000;
      const dateGte = `${yearFrom}-01-01`;

      // Top 4 genres for a broader but still relevant candidate pool
      const gemGenreIds = Object.entries(genreAffinity)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 4)
        .map(([id]) => Number(id));

      if (gemGenreIds.length === 0) return { items: [] };

      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);

      // Fetch 2 pages each — the voteCount cap filters out ~half the raw results
      const [mP1, mP2, tvP1, tvP2] = await Promise.all([
        tmdbApi.discoverMoviesTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300, releaseDateGte: dateGte, page: 1 }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverMoviesTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 300, releaseDateGte: dateGte, page: 2 }).then(r => r.map(normalizeMovie)),
        tmdbApi.discoverShowsTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200, firstAirDateGte: dateGte, page: 1 }).then(r => r.map(normalizeTVShow)),
        tmdbApi.discoverShowsTyped({ genreIds: gemGenreIds, sortBy: 'vote_average.desc', voteAverageGte: 7.5, voteCountGte: 200, firstAirDateGte: dateGte, page: 2 }).then(r => r.map(normalizeTVShow)),
      ]);

      // Client-side voteCount ceiling keeps mainstream hits out
      const gemsMovies = [...mP1, ...mP2].filter(i => (i.voteCount ?? 0) <= voteCountMax);
      const gemsTV = [...tvP1, ...tvP2].filter(i => (i.voteCount ?? 0) <= voteCountMax);

      // Interleave to vary media type
      const seen = new Set<number>();
      const merged: ContentItem[] = [];
      const maxLen = Math.max(gemsMovies.length, gemsTV.length);
      for (let i = 0; i < maxLen; i++) {
        if (gemsMovies[i] && !seen.has(gemsMovies[i].id)) { seen.add(gemsMovies[i].id); merged.push(gemsMovies[i]); }
        if (gemsTV[i] && !seen.has(gemsTV[i].id)) { seen.add(gemsTV[i].id); merged.push(gemsTV[i]); }
      }

      const items = merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .slice(0, 24);

      return { items };
    },
    enabled: Object.keys(genreAffinity).length > 0 && traktReady,
    staleTime: 1000 * 60 * 60 * 6,
  });

  // ─── Watchlist-seeded row ─────────────────────────────────────────────────
  // Explicit intent: the user bookmarked this — find similar content they'd also want.
  // Seed = most recently added watchlist item not already watched.
  const watchlistSeed = useMemo(() => {
    if (!watchlistItems.length) return null;
    const watchedSet = new Set<number>([
      ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
      ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
    ]);
    return [...watchlistItems]
      .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
      .find(item => !watchedSet.has(item.tmdb_id)) ?? null;
  }, [watchlistItems, traktMovies, traktShows]);

  const { data: watchlistSeedItems } = useQuery({
    queryKey: ['watchlist-seed-v1', watchlistSeed?.tmdb_id, watchlistSeed?.media_type, bywAffinityKey],
    queryFn: async () => {
      if (!watchlistSeed) return [];
      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);
      const profile = thematicData?.profile as TasteProfile | undefined;

      const [similarRaw, recsRaw] = await Promise.all(
        watchlistSeed.media_type === 'movie'
          ? [
              tmdbApi.getMovieSimilar(watchlistSeed.tmdb_id).then(r => r.map(normalizeMovie)),
              tmdbApi.getMovieRecommendations(watchlistSeed.tmdb_id).then(r => r.map(normalizeMovie)),
            ]
          : [
              tmdbApi.getTVSimilar(watchlistSeed.tmdb_id).then(r => r.map(normalizeTVShow)),
              tmdbApi.getTVRecommendations(watchlistSeed.tmdb_id).then(r => r.map(normalizeTVShow)),
            ]
      );

      const seen = new Set<number>([watchlistSeed.tmdb_id]);
      const merged: ContentItem[] = [];
      for (const item of [...similarRaw, ...recsRaw]) {
        if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
      }

      return merged
        .filter(item => !watchedSet.has(item.id))
        .filter(item => passesQualityFilter(item, 'discover'))
        .filter(item => !isMismatchedNiche(item, [], genreAffinity, profile))
        .slice(0, 20);
    },
    enabled: !!watchlistSeed,
    staleTime: 1000 * 60 * 60,
  });

  // ─── Cross-row dedup (render-time) ────────────────────────────────────────
  // Personal rows take priority over thematic editorial rows.
  // Dedup order: BYW > IYL > watchlist-seed > thematic.

  const bywIds = useMemo(() => {
    const ids = new Set<number>();
    (bywRows ?? []).forEach(r => r.items.forEach((i: ContentItem) => ids.add(i.id)));
    return ids;
  }, [bywRows]);

  const filteredIylRows = useMemo(() =>
    (ifYouLikedRows ?? [])
      .map(r => ({ ...r, items: r.items.filter((i: ContentItem) => !bywIds.has(i.id)) }))
      .filter(r => r.items.length >= 3),
    [ifYouLikedRows, bywIds]
  );

  const iylIds = useMemo(() => {
    const ids = new Set<number>();
    filteredIylRows.forEach(r => r.items.forEach((i: ContentItem) => ids.add(i.id)));
    return ids;
  }, [filteredIylRows]);

  const filteredWatchlistSeedItems = useMemo(() =>
    (watchlistSeedItems ?? []).filter(i => !bywIds.has(i.id) && !iylIds.has(i.id)),
    [watchlistSeedItems, bywIds, iylIds]
  );

  const watchlistIds = useMemo(() => {
    const ids = new Set<number>();
    filteredWatchlistSeedItems.forEach(i => ids.add(i.id));
    return ids;
  }, [filteredWatchlistSeedItems]);

  const filteredTrendingGenreItems = useMemo(() =>
    (trendingInGenreData?.items ?? []).filter(
      i => !bywIds.has(i.id) && !iylIds.has(i.id) && !watchlistIds.has(i.id)
    ),
    [trendingInGenreData, bywIds, iylIds, watchlistIds]
  );

  // All personal IDs before hidden gems — used to dedup hidden gems itself
  const priorPersonalIds = useMemo(() => {
    const ids = new Set<number>([...bywIds, ...iylIds, ...watchlistIds]);
    filteredTrendingGenreItems.forEach(i => ids.add(i.id));
    return ids;
  }, [bywIds, iylIds, watchlistIds, filteredTrendingGenreItems]);

  const filteredHiddenGemsItems = useMemo(() =>
    (hiddenGemsData?.items ?? []).filter(i => !priorPersonalIds.has(i.id)),
    [hiddenGemsData, priorPersonalIds]
  );

  // Full personal ID set — thematic editorial rows are filtered against this
  const personalIds = useMemo(() => {
    const ids = new Set<number>([...priorPersonalIds]);
    filteredHiddenGemsItems.forEach(i => ids.add(i.id));
    return ids;
  }, [priorPersonalIds, filteredHiddenGemsItems]);

  const filteredThematicRows = useMemo(() =>
    thematicRows
      .map((row: any) => ({ ...row, items: row.items.filter((i: ContentItem) => !personalIds.has(i.id)) }))
      .filter((r: any) => r.items.length >= 3),
    [thematicRows, personalIds]
  );

  // ─── Derived data ──────────────────────────────────────────────────────────

  const heroItem: ContentItem | null = useMemo(() => {
    if (!trending?.length) return null;
    const qualified = (trending as any[])
      .slice(0, 10)
      .map((item: any) =>
        'title' in item ? normalizeMovie(item) : normalizeTVShow(item)
      )
      .filter((item) => passesQualityFilter(item, 'trending'));
    if (!qualified.length) return null;
    // Stable pick: use first item's id as seed so hero doesn't jump on re-render
    const seed = (trending[0] as any).id ?? 0;
    return qualified[seed % Math.min(3, qualified.length)];
  }, [trending]);

  // Trending row — mixed movies + TV, hero item excluded to avoid duplication
  const trendingItems: ContentItem[] = useMemo(() => {
    if (!trending?.length) return [];
    const heroId = heroItem?.id;
    return (trending as any[])
      .map((item: any) => ('title' in item ? normalizeMovie(item) : normalizeTVShow(item)))
      .filter((item) => passesQualityFilter(item, 'trending'))
      .filter((item) => item.id !== heroId)
      .slice(0, 20);
  }, [trending, heroItem]);

  const popularMovieItems: ContentItem[] = useMemo(
    () => filterAndRankContent((popularMovies ?? []).map(normalizeMovie), 'default', 20),
    [popularMovies]
  );

  const popularShowItems: ContentItem[] = useMemo(
    () => filterAndRankContent((popularShows ?? []).map(normalizeTVShow), 'default', 20),
    [popularShows]
  );

  const [isManualRefreshing, setIsManualRefreshing] = React.useState(false);
  const isRefreshing = trendingLoading || isManualRefreshing;

  const onRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    await Promise.all([refetchTrending(), refetchThematic()]);
    setIsManualRefreshing(false);
  }, [refetchTrending, refetchThematic]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/splash-logo.png')}
              style={styles.logoImage}
              contentFit="contain"
            />
            <Text style={styles.logoText}>Next<Text style={styles.logoAccent}>Up</Text></Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push('/(tabs)/search')}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="search-outline" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="settings-outline" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero */}
        {trendingLoading ? (
          <LoadingSkeleton width="100%" height={HERO_SKELETON_HEIGHT} borderRadius={0} />
        ) : heroItem ? (
          <HeroSection item={heroItem} />
        ) : null}

        {/* Rows */}
        <View style={styles.rows}>
          {/* Trending — always at the top so users can browse what's current */}
          {(trendingLoading || trendingItems.length > 0) && (
            <ContentRow
              title="Trending Now"
              subtitle="What everyone's watching this week"
              items={trendingItems}
              isLoading={trendingLoading}
              showRating
              showType
            />
          )}
          {/* Continue Watching — highest intent: user is mid-series */}
          {continueWatchingItems.length >= 2 && (
            <ContentRow
              title="Continue Watching"
              subtitle="Pick up where you left off"
              items={continueWatchingItems}
              isLoading={false}
              showRating
            />
          )}
          {/* Personal rows — most relevant to the user's current taste */}
          {(bywRows ?? []).map(({ seed, items }) => (
            <ContentRow
              key={`byw-${seed.tmdbId}`}
              title={`Because you watched ${seed.title}`}
              titleComponent={
                <>
                  {'Because you watched '}
                  <Text style={{ fontStyle: 'italic', color: Colors.textMuted }}>{seed.title}</Text>
                </>
              }
              subtitle="More like what you just finished"
              items={items}
              isLoading={false}
              showRating
            />
          ))}
          {filteredIylRows.map(({ seed, items }) => (
            <ContentRow
              key={`if-you-liked-${seed.tmdbId}`}
              title={`If you liked ${seed.title}...`}
              titleComponent={
                <>
                  {'If you liked '}
                  <Text style={{ fontStyle: 'italic', color: Colors.textMuted }}>{seed.title}</Text>
                  {'...'}
                </>
              }
              subtitle="You might also like these"
              items={items}
              isLoading={false}
              showRating
            />
          ))}
          {watchlistSeed && filteredWatchlistSeedItems.length >= 3 && (
            <ContentRow
              title={`Because you saved ${watchlistSeed.title}`}
              titleComponent={
                <>
                  {'Because you saved '}
                  <Text style={{ fontStyle: 'italic', color: Colors.textMuted }}>{watchlistSeed.title}</Text>
                </>
              }
              subtitle="Similar titles you haven't seen yet"
              items={filteredWatchlistSeedItems}
              isLoading={false}
              showRating
            />
          )}
          {trendingInGenreData && filteredTrendingGenreItems.length >= 3 && (
            <ContentRow
              title={trendingInGenreData.title}
              subtitle="Popular right now in the genres you love"
              items={filteredTrendingGenreItems}
              isLoading={false}
              showRating
            />
          )}
          {filteredHiddenGemsItems.length >= 3 && (
            <ContentRow
              title="Hidden Gems For You"
              subtitle="Critically loved, under the radar — matched to your taste"
              items={filteredHiddenGemsItems}
              isLoading={false}
              showRating
            />
          )}
          {hasTrakt && (
            <RecentlyWatchedRow
              items={historyItems ?? []}
              isLoading={historyLoading}
              lastEpisodes={lastEpisodes}
            />
          )}
          {(newEpsLoading || newEpsThisWeek.length > 0) && (
            <NewEpsRow
              title="New Eps This Week"
              shows={newEpsThisWeek}
              isLoading={newEpsLoading}
            />
          )}
          {/* Editorial/thematic rows below personal content */}
          {thematicWaiting ? (
            [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <ContentRow
                key={`skeleton-${i}`}
                title="✦ Curating your picks..."
                subtitle=""
                items={[]}
                isLoading
                showRating
                accent
              />
            ))
          ) : filteredThematicRows.length > 0 ? (
            filteredThematicRows.map((row, i) => (
              <ContentRow
                key={`thematic-${i}`}
                title={`✦ ${row.title}`}
                subtitle={row.subtitle}
                items={row.items}
                isLoading={false}
                showRating
                accent
              />
            ))
          ) : (
            <>
              <ContentRow
                title="Popular Movies"
                subtitle="Trending with audiences worldwide"
                items={popularMovieItems}
                isLoading={moviesLoading}
                showRating
              />
              <ContentRow
                title="Top Series"
                subtitle="Binge-worthy shows everyone's talking about"
                items={popularShowItems}
                isLoading={showsLoading}
                showRating
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logoImage: {
    width: 44,
    height: 36,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  logoAccent: {
    color: Colors.primary,
  },
  rows: {
    paddingTop: Spacing.xl,
  },
});
