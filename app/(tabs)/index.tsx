import React, { useMemo } from 'react';
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
import { askGeminiForHomePicks } from '../../lib/gemini';
import { filterAndRankContent, passesQualityFilter } from '../../lib/quality';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useWatchlistStore } from '../../store/watchlistStore';
import HeroSection from '../../components/home/HeroSection';
import ContentRow from '../../components/home/ContentRow';
import NewEpsRow from '../../components/home/NewEpsRow';
import RecentlyWatchedRow from '../../components/home/RecentlyWatchedRow';
import LoadingSkeleton from '../../components/common/LoadingSkeleton';
import type { ContentItem } from '../../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_SKELETON_HEIGHT = SCREEN_HEIGHT * 0.55;

export default function HomeScreen() {
  const router = useRouter();
  const { traktClientId, traktUsername, traktAccessToken, geminiKey } = useApiKeysStore();
  const { items: watchlistItems } = useWatchlistStore();
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

  // Merge movies + shows, sort by most recently watched, deduplicate, take top 12
  const recentIds = useMemo(() => {
    const combined = [
      ...(traktMovies ?? []).map((m) => ({
        tmdbId: m.movie.ids.tmdb,
        mediaType: 'movie' as const,
        watchedAt: m.last_watched_at,
        title: m.movie.title,
      })),
      ...(traktShows ?? []).map((s) => ({
        tmdbId: s.show.ids.tmdb,
        mediaType: 'tv' as const,
        watchedAt: s.last_watched_at,
        title: s.show.title,
      })),
    ];
    const seen = new Set<number>();
    return combined
      .filter(({ tmdbId }) => !!tmdbId)
      .sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime())
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

  // ─── AI Picks ─────────────────────────────────────────────────────────────
  // Fingerprint the first 10 Trakt IDs so the query key changes when history loads.
  const traktMovieFingerprint = (traktMovies ?? []).slice(0, 10).map((m) => m.movie.ids.tmdb).join(',');
  const traktShowFingerprint = (traktShows ?? []).slice(0, 10).map((s) => s.show.ids.tmdb).join(',');

  // If Trakt is connected, wait until both queries have settled (success OR failure)
  // before firing so Gemini gets real history — but don't block forever on a Trakt error.
  const traktReady = !hasTrakt || (traktMoviesFetched && traktShowsFetched);

  // Single Gemini call returns both movieIds and tvIds, avoiding rate-limit issues
  const { data: aiPicksData, isLoading: aiPicksLoading } = useQuery({
    queryKey: ['home-ai-picks-v8', geminiKey, traktMovieFingerprint, traktShowFingerprint],
    queryFn: async () => {
      const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
      const movies = traktMovies ?? [];
      const shows = traktShows ?? [];
      console.log('[AI Picks] firing — history:', movies.length, 'movies,', shows.length, 'shows');
      const { movieIds, tvIds, modelUsed } = await askGeminiForHomePicks(cleanKey, movies, shows);
      console.log('[AI Picks] via', modelUsed, '— movieIds:', movieIds.length, 'tvIds:', tvIds.length);

      // Hard-filter watched IDs that Gemini may have included anyway
      const watchedMovieIds = new Set(movies.map((m) => m.movie.ids.tmdb).filter(Boolean));
      const watchedShowIds = new Set(shows.map((s) => s.show.ids.tmdb).filter(Boolean));
      const unseenMovieIds = movieIds.filter((id) => !watchedMovieIds.has(id));
      const unseenTvIds = tvIds.filter((id) => !watchedShowIds.has(id));

      const [movieResults, tvResults] = await Promise.all([
        Promise.allSettled(unseenMovieIds.slice(0, 60).map((id) => tmdbApi.getMovieDetail(id).then(normalizeMovie))),
        Promise.allSettled(unseenTvIds.slice(0, 60).map((id) => tmdbApi.getTVDetail(id).then(normalizeTVShow))),
      ]);

      const PREFERRED_LANGS = new Set(['en', 'es', 'fr', 'ko', 'ja']);

      const movieItems = movieResults
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((item) =>
          !!item.posterPath &&
          (item.voteCount ?? 0) >= 500 &&
          (item.rating ?? 0) >= 6.5 &&
          PREFERRED_LANGS.has(item.originalLanguage ?? 'en')
        )
        .slice(0, 20);

      const tvItems = tvResults
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((item) =>
          !!item.posterPath &&
          (item.voteCount ?? 0) >= 200 &&
          (item.rating ?? 0) >= 6.5 &&
          PREFERRED_LANGS.has(item.originalLanguage ?? 'en')
        )
        .slice(0, 20);

      console.log('[AI Picks] resolved:', movieItems.length, 'movies,', tvItems.length, 'shows');
      return { movies: movieItems, shows: tvItems };
    },
    enabled: hasGemini && traktReady,
    staleTime: 1000 * 60 * 120,
    retry: 2,
    retryDelay: 3000,
  });

  const aiMovieItems = aiPicksData?.movies ?? [];
  const aiTVItems = aiPicksData?.shows ?? [];
  // Cover the full wait: Trakt fetching → Gemini call → TMDB resolution.
  // Without this, the rows show blank (no skeleton) while Trakt is still loading.
  const aiPicksWaiting = hasGemini && (!traktReady || aiPicksLoading);
  const aiMoviesLoading = aiPicksWaiting;
  const aiTVLoading = aiPicksWaiting;

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

  const isRefreshing = trendingLoading;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetchTrending}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/icon.png')}
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
          {hasGemini && (
            <ContentRow
              title="✦ AI Picks: Movies"
              subtitle="Curated by AI based on great taste"
              items={aiMovieItems ?? []}
              isLoading={aiMoviesLoading}
              showRating
              cardWidth={130}
              accent
            />
          )}
          {hasGemini && (
            <ContentRow
              title="✦ AI Picks: TV Shows"
              subtitle="Curated by AI based on great taste"
              items={aiTVItems ?? []}
              isLoading={aiTVLoading}
              showRating
              cardWidth={130}
              accent
            />
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
    gap: 8,
  },
  logoImage: {
    width: 34,
    height: 34,
    borderRadius: 8,
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
