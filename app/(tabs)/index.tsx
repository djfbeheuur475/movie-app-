import React, { useMemo, useEffect, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { traktApi } from '../../lib/trakt';
import { filterAndRankContent, passesQualityFilter } from '../../lib/quality';
import {
  generateTasteDNA, loadCachedDNA, saveDNA, computeFingerprint,
  getTemporalContext, loadRecentRowTitles, saveShownRowTitles,
  computeGenreAffinity, deterministicPage,
  loadDNAFromCloud, saveDNAToCloud, loadShownRowsFromCloud, saveShownRowsToCloud,
  loadItemCooldowns, saveItemCooldowns,
} from '../../lib/tasteDna';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useAuthStore } from '../../store/authStore';
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
  const { traktClientId, traktUsername, traktAccessToken, geminiKey } = useApiKeysStore();
  const { items: watchlistItems } = useWatchlistStore();
  const { user } = useAuthStore();
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

  const { data: traktMovies, isFetched: traktMoviesFetched } = useQuery({
    queryKey: ['trakt-watched-movies', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const { data: traktShows, isFetched: traktShowsFetched } = useQuery({
    queryKey: ['trakt-watched-shows', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedShows(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

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
        score: s.plays * recencyWeight(s.last_watched_at),
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

  // Genre affinity — play-weighted from historyItems (full TMDB metadata with genre_ids)
  const genreAffinity = useMemo(
    () => computeGenreAffinity(historyItems ?? [], playsMap),
    [historyItems, playsMap]
  );

  // ─── Thematic rows (Taste DNA) ────────────────────────────────────────────
  // Temporal context drives row rotation — dateKey changes every 6h
  const temporal = useMemo(() => getTemporalContext(), []);

  const traktMovieFingerprint = (traktMovies ?? []).slice(0, 10).map((m) => m.movie.ids.tmdb).join(',');
  const traktShowFingerprint = (traktShows ?? []).slice(0, 10).map((s) => s.show.ids.tmdb).join(',');

  // Wait until Trakt has settled before firing so DNA gets real history
  const traktReady = !hasTrakt || (traktMoviesFetched && traktShowsFetched);

  const { data: thematicData, isLoading: thematicLoading, refetch: refetchThematic } = useQuery({
    queryKey: ['thematic-rows-v2', geminiKey, traktMovieFingerprint, traktShowFingerprint, temporal.dateKey],
    queryFn: async () => {
      const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
      const movies = traktMovies ?? [];
      const shows = traktShows ?? [];

      // Load recently-shown row themes (local + cloud) for avoidance prompt
      const [localTitles, cloudTitles] = await Promise.all([
        loadRecentRowTitles(),
        userId ? loadShownRowsFromCloud(userId) : Promise.resolve([] as string[]),
      ]);
      const recentRowTitles = [...new Set([...cloudTitles, ...localTitles])].slice(0, 20);

      // Check local cache first, then Supabase cloud cache
      const fingerprint = computeFingerprint(movies, shows, temporal);
      let dna = await loadCachedDNA(fingerprint);
      if (!dna && userId) {
        const cloudDna = await loadDNAFromCloud(userId);
        if (cloudDna?.fingerprint === fingerprint) {
          dna = cloudDna;
          console.log('[ThematicRows] Restored DNA from cloud');
        }
      }

      if (!dna) {
        console.log(`[ThematicRows] Generating DNA for ${temporal.description}...`);
        dna = await generateTasteDNA(
          cleanKey, movies, shows, temporal,
          recentRowTitles, genreAffinity, playsMap,
        );
        await saveDNA(dna);
        if (userId) saveDNAToCloud(userId, dna); // non-blocking
      } else {
        console.log('[ThematicRows] Using cached DNA');
      }

      const watchedIds = new Set<number>([
        ...movies.map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...shows.map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);

      // Load 7-day item-level cooldowns to suppress recently surfaced titles
      const cooldownIds = await loadItemCooldowns();

      const rowResults = await Promise.allSettled(
        dna.rows.map(async (row, rowIndex) => {
          // Deterministic page 1–3 per row, changes every 6h — prevents stale top-20
          const page = deterministicPage(temporal.dateKey, rowIndex);
          const raw = row.type === 'movie'
            ? (await tmdbApi.discoverMoviesTyped({
                genreIds: row.genreIds,
                sortBy: row.sortBy,
                voteAverageGte: row.voteAverageGte,
                voteCountGte: row.voteCountGte,
                releaseDateGte: row.releaseDateGte,
                releaseDateLte: row.releaseDateLte,
                page,
              })).map(normalizeMovie)
            : (await tmdbApi.discoverShowsTyped({
                genreIds: row.genreIds,
                sortBy: row.sortBy,
                voteAverageGte: row.voteAverageGte,
                voteCountGte: row.voteCountGte,
                firstAirDateGte: row.releaseDateGte,
                firstAirDateLte: row.releaseDateLte,
                page,
              })).map(normalizeTVShow);

          const items = raw
            .filter((item) => !watchedIds.has(item.id))
            .filter((item) => !cooldownIds.has(item.id))
            .filter((item) => passesQualityFilter(item, 'discover'))
            .slice(0, 20);

          return { ...row, items };
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
        .filter((r) => r.items.length > 0);

      console.log(`[ThematicRows] ${rows.length} rows loaded, mode=${dna.tasteMode}`);
      return { tasteProfile: dna.tasteProfile, tasteMode: dna.tasteMode, rows };
    },
    enabled: hasGemini && traktReady,
    staleTime: 1000 * 60 * 60 * 6,
    retry: 1,
  });

  const thematicRows = thematicData?.rows ?? [];
  const tasteMode = thematicData?.tasteMode ?? null;

  // Save shown row titles + surfaced item cooldowns after data loads
  useEffect(() => {
    if (thematicRows.length > 0) {
      const titles = thematicRows.map((r: any) => r.title);
      saveShownRowTitles(titles);
      if (userId) saveShownRowsToCloud(userId, titles);

      const surfacedIds = thematicRows.flatMap((r: any) => r.items.map((i: ContentItem) => i.id));
      if (surfacedIds.length > 0) saveItemCooldowns(surfacedIds);
    }
  }, [thematicData, userId]);
  const thematicWaiting = hasGemini && (!traktReady || thematicLoading);

  // ─── Because You Watched ───────────────────────────────────────────────────
  // Seed from the highest play-count × recency item (already sorted that way in recentIds)
  // Prefer an item watched more than once — signals genuine affinity over a one-off watch
  const seedItem = useMemo(() => {
    const rewatched = recentIds.find(i => (playsMap.get(i.tmdbId) ?? 1) >= 2);
    return rewatched ?? recentIds[0] ?? null;
  }, [recentIds, playsMap]);

  const { data: becauseYouWatchedItems } = useQuery({
    queryKey: ['because-you-watched', seedItem?.tmdbId, seedItem?.mediaType],
    queryFn: async () => {
      if (!seedItem) return [];
      const watchedSet = new Set<number>([
        ...(traktMovies ?? []).map((m) => m.movie.ids.tmdb).filter((id): id is number => !!id),
        ...(traktShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id),
      ]);
      const raw = seedItem.mediaType === 'movie'
        ? (await tmdbApi.getMovieRecommendations(seedItem.tmdbId)).map(normalizeMovie)
        : (await tmdbApi.getTVRecommendations(seedItem.tmdbId)).map(normalizeTVShow);
      return raw
        .filter((item) => !watchedSet.has(item.id))
        .filter((item) => passesQualityFilter(item, 'discover'))
        .slice(0, 20);
    },
    enabled: !!seedItem && traktReady,
    staleTime: 1000 * 60 * 60,
  });

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
    <SafeAreaView style={styles.container}>
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

        {/* Taste Mode chip — shown when DNA has loaded */}
        {tasteMode && <TasteModeChip mode={tasteMode} />}

        {/* Because You Watched */}
        {becauseYouWatchedItems && becauseYouWatchedItems.length > 0 && seedItem && (
          <ContentRow
            title={`Because You Watched ${seedItem.title}`}
            subtitle="Recommendations based on your last watch"
            items={becauseYouWatchedItems}
            isLoading={false}
            showRating
          />
        )}

        {/* Rows */}
        <View style={styles.rows}>
          {hasGemini ? (
            thematicWaiting ? (
              // Skeleton rows while DNA is being generated
              [0, 1, 2, 3, 4].map((i) => (
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
            ) : thematicRows.length > 0 ? (
              thematicRows.map((row, i) => (
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
              // Gemini configured but rows empty — fallback to popular
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
            )
          ) : (
            // No Gemini key — standard popular rows
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
