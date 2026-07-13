import React, { useMemo, useEffect, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { traktApi, TraktUnauthorizedError, effectiveTraktClientId } from '../../lib/trakt';
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
import { isMismatchedNiche, rankItemsByProfile } from '../../lib/recommendations';
import type { RecsContext, WatchSeed } from '../../lib/recommendations';
import { useAIHomeFeed } from '../../hooks/useAIHomeFeed';
import { useBecauseYouWatched } from '../../hooks/useBecauseYouWatched';
import { useIfYouLiked } from '../../hooks/useIfYouLiked';
import { useHiddenGems } from '../../hooks/useHiddenGems';
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

export default function HomeScreen() {
  const router = useRouter();
  const { traktClientId, traktAccessToken, handleTraktUnauthorized } = useApiKeysStore();
  const { items: watchlistItems } = useWatchlistStore();
  const { user } = useAuthStore();
  const { favoriteGenres } = usePreferencesStore();
  const userId = user?.id ?? null;
  const hasTrakt = !!traktAccessToken;
  const traktClientIdEff = effectiveTraktClientId(traktClientId);

  // Stable for the lifetime of this component mount — changes only on app restart,
  // which gives each session a fresh template selection for thematic rows.
  const sessionKey = useRef(Date.now()).current;

  // ─── Trending (hero only) ──────────────────────────────────────────────────

  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ['trending'],
    queryFn: () => tmdbApi.getTrending('all', 'week'),
    staleTime: 1000 * 60 * 60 * 24,
  });

  // ─── Trakt watch history ───────────────────────────────────────────────────

  const queryClient = useQueryClient();

  const { data: traktMovies, isFetched: traktMoviesFetched, error: traktMoviesError } = useQuery({
    queryKey: ['trakt-watched-movies', traktClientIdEff, traktAccessToken],
    queryFn: () => traktApi.getWatchedMovies(traktClientIdEff, traktAccessToken),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
    retry: (count, error) => !(error instanceof TraktUnauthorizedError) && count < 2,
  });

  const { data: traktShows, isFetched: traktShowsFetched } = useQuery({
    queryKey: ['trakt-watched-shows', traktClientIdEff, traktAccessToken],
    queryFn: () => traktApi.getWatchedShows(traktClientIdEff, traktAccessToken),
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
            ? tmdbApi.getMovieBasic(tmdbId).then(normalizeMovie)
            : tmdbApi.getTVBasic(tmdbId).then(normalizeTVShow)
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
        newEpsShowIds.map((id) => tmdbApi.getTVBasic(id))
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
  // temporal is still used inside queryFn for deterministicPage + template context.
  // sessionKey in the query key ensures each app launch gets a fresh template
  // selection; tab navigation within the session serves the cache.
  const temporal = useMemo(() => getTemporalContext(), []);

  const traktMovieFingerprint = (traktMovies ?? []).slice(0, 10).map((m) => m.movie.ids.tmdb).join(',');
  const traktShowFingerprint = (traktShows ?? []).slice(0, 10).map((s) => s.show.ids.tmdb).join(',');

  // Wait until Trakt has settled before firing so DNA gets real history
  const traktReady = !hasTrakt || (traktMoviesFetched && traktShowsFetched);

  // ─── AI Home Feed (orchestrator) ──────────────────────────────────────────
  const { data: aiFeed, isLoading: aiFeedLoading } = useAIHomeFeed({
    watchedMovies: traktMovies ?? [],
    watchedShows: traktShows ?? [],
    enabled: traktReady && !!userId,
  });

  const aiHeroSection = aiFeed?.sections.find((s) => s.type === 'hero');
  // Cap at 4 rows — the server sends up to 5 (4 DNA rows + 1 trending fallback).
  // The fallback only appears when a DNA pool is empty, keeping the count at 4.
  const aiRowSections = (aiFeed?.sections.filter((s) => s.type === 'row' || s.type === 'spotlight') ?? []).slice(0, 4);

  const { data: thematicData, isLoading: thematicLoading } = useQuery({
    queryKey: ['thematic-rows-v10', traktMovieFingerprint, traktShowFingerprint, sessionKey],
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
    staleTime: 1000 * 60 * 60 * 24,
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

  // ─── Daily seed rotation (BYW + IYL) ─────────────────────────────────────
  // dayHash increments by ~1 each calendar day (sum of date-string char codes),
  // so with a 7-item pool each pick cycles through all 7 items over 7 days.
  const dayHash = useMemo(() => {
    const dayKey = temporal.dateKey.slice(0, 10);
    return dayKey.split('').reduce((acc: number, ch: string) => acc + ch.charCodeAt(0), 0);
  }, [temporal.dateKey]);

  // IYL seed: one title from the top 7, changes every day
  const seed1 = useMemo((): WatchSeed | null => {
    const pool = recentIds.slice(0, Math.min(7, recentIds.length));
    if (pool.length === 0) return null;
    return pool[dayHash % pool.length];
  }, [recentIds, dayHash]);

  // BYW seed: same pool, offset by half so it never picks the same title as IYL
  const bywSeed = useMemo((): WatchSeed | null => {
    const pool = recentIds.slice(0, Math.min(7, recentIds.length));
    if (pool.length === 0) return null;
    const offset = Math.max(1, Math.floor(pool.length / 2));
    return pool[(dayHash + offset) % pool.length];
  }, [recentIds, dayHash]);

  // ─── Shared recommendation context ──────────────────────────────────────────
  const recsCtx: RecsContext = {
    traktMovies,
    traktShows,
    genreAffinity,
    profile: thematicData?.profile as TasteProfile | undefined,
    traktReady,
  };

  // ─── Row module hooks ─────────────────────────────────────────────────────────
  const bywSeeds: WatchSeed[] = bywSeed ? [bywSeed] : [];
  const { data: bywRows } = useBecauseYouWatched(bywSeeds, recsCtx);
  const { data: ifYouLikedRows } = useIfYouLiked(seed1, null, recsCtx);
  const { data: hiddenGemsData } = useHiddenGems(topGenreEntries, recsCtx);

  // ─── Cross-row dedup (render-time) ────────────────────────────────────────

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

  const personalIds = useMemo(() => new Set<number>([...bywIds, ...iylIds]), [bywIds, iylIds]);

  const filteredHiddenGemsItems = useMemo(() =>
    (hiddenGemsData?.items ?? []).filter(i => !personalIds.has(i.id)),
    [hiddenGemsData, personalIds]
  );

  const filteredThematicRows = useMemo(() =>
    thematicRows.filter((r: any) => r.items.length >= 3),
    [thematicRows]
  );

  // ─── Derived data ──────────────────────────────────────────────────────────

  // Hero carousel — AI items when available, otherwise trending sorted by affinity
  const heroItems: ContentItem[] = useMemo(() => {
    if (aiHeroSection?.items.length) return aiHeroSection.items;

    if (!trending?.length) return [];
    const qualified = (trending as any[])
      .map((item: any) => ('title' in item ? normalizeMovie(item) : normalizeTVShow(item)))
      .filter((item) => passesQualityFilter(item, 'trending'));
    if (!qualified.length) return [];

    if (Object.keys(genreAffinity).length > 0) {
      return qualified
        .map(item => {
          const itemGenres = new Set(item.genres ?? []);
          const score = Object.entries(genreAffinity)
            .reduce((s, [id, w]) => s + (itemGenres.has(Number(id)) ? w : 0), 0);
          return { item, score };
        })
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item)
        .slice(0, 10);
    }

    return qualified.slice(0, 10);
  }, [aiHeroSection, trending, genreAffinity]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
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
        ) : heroItems.length > 0 ? (
          <HeroSection items={heroItems} />
        ) : null}

        {/* Rows */}
        <View style={styles.rows}>
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
          {filteredHiddenGemsItems.length >= 3 && (
            <ContentRow
              title="Hidden Gems For You"
              subtitle="Critically loved, under the radar — matched to your taste"
              items={filteredHiddenGemsItems}
              isLoading={false}
              showRating
            />
          )}
          {/* AI-curated rows — Brain + Candidate Builder + Curator pipeline */}
          {aiFeedLoading && traktReady && !!userId ? (
            [0, 1, 2, 3].map((i) => (
              <ContentRow
                key={`ai-skeleton-${i}`}
                title="✦ Curating your picks..."
                subtitle=""
                items={[]}
                isLoading
                showRating
                accent
              />
            ))
          ) : aiRowSections.length > 0 ? (
            aiRowSections.map((section) => (
              <ContentRow
                key={section.id}
                title={`✦ ${section.heading ?? section.id}`}
                subtitle={section.subheading}
                items={section.items}
                isLoading={false}
                showRating
                accent
              />
            ))
          ) : !aiFeedLoading && filteredThematicRows.length > 0 ? (
            // Fallback to thematic rows if AI feed failed
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
          ) : null}
          {(newEpsLoading || newEpsThisWeek.length > 0) && (
            <NewEpsRow
              title="New Eps This Week"
              shows={newEpsThisWeek}
              isLoading={newEpsLoading}
            />
          )}
          {hasTrakt && (
            <RecentlyWatchedRow
              items={historyItems ?? []}
              isLoading={historyLoading}
              lastEpisodes={lastEpisodes}
            />
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
