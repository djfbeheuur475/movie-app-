import React, { useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { traktApi } from '../../lib/trakt';
import { askGemini } from '../../lib/gemini';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useWatchlistStore } from '../../store/watchlistStore';
import HeroSection from '../../components/home/HeroSection';
import ContentRow from '../../components/home/ContentRow';
import NewEpsRow from '../../components/home/NewEpsRow';
import type { ContentItem } from '../../types';

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

  const { data: traktMovies } = useQuery({
    queryKey: ['trakt-watched-movies', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const { data: traktShows } = useQuery({
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
      })),
      ...(traktShows ?? []).map((s) => ({
        tmdbId: s.show.ids.tmdb,
        mediaType: 'tv' as const,
        watchedAt: s.last_watched_at,
      })),
    ];
    const seen = new Set<number>();
    return combined
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

  // ─── New Eps This Week ─────────────────────────────────────────────────────
  // Merges watchlist TV shows + Trakt watched shows, fetches next_episode_to_air,
  // filters to shows with an episode airing within the next 7 days.

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
    return (newEpsShowDetails ?? []).filter((show: any) => {
      if (!show.next_episode_to_air?.air_date) return false;
      const [y, m, d] = show.next_episode_to_air.air_date.split('-').map(Number);
      const airDate = new Date(y, m - 1, d);
      return airDate >= today && airDate <= weekFromNow;
    });
  }, [newEpsShowDetails]);

  // ─── AI Picks: Movies ──────────────────────────────────────────────────────

  const { data: aiMovieItems, isLoading: aiMoviesLoading } = useQuery({
    queryKey: ['home-ai-picks-movies', geminiKey],
    queryFn: async (): Promise<ContentItem[]> => {
      const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
      const { tmdbIds } = await askGemini(
        cleanKey,
        [{ role: 'user', content: 'Recommend exactly 20 must-watch movies across different genres — thriller, comedy, drama, sci-fi, action, horror. Mix recent releases with timeless classics. Only include movies, no TV shows.' }],
        [],
        []
      );
      if (!tmdbIds.length) return [];
      const results = await Promise.allSettled(
        tmdbIds.slice(0, 20).map((id) => tmdbApi.getMovieDetail(id).then(normalizeMovie))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: hasGemini,
    staleTime: 1000 * 60 * 120,
    retry: 0,
  });

  // ─── AI Picks: TV Shows ────────────────────────────────────────────────────

  const { data: aiTVItems, isLoading: aiTVLoading } = useQuery({
    queryKey: ['home-ai-picks-tv', geminiKey],
    queryFn: async (): Promise<ContentItem[]> => {
      const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
      const { tmdbIds } = await askGemini(
        cleanKey,
        [{ role: 'user', content: 'Recommend exactly 20 must-watch TV shows across different genres — drama, thriller, comedy, sci-fi, crime, fantasy. Mix recent hits with beloved classics. Only include TV shows, no movies.' }],
        [],
        []
      );
      if (!tmdbIds.length) return [];
      const results = await Promise.allSettled(
        tmdbIds.slice(0, 20).map((id) => tmdbApi.getTVDetail(id).then(normalizeTVShow))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: hasGemini,
    staleTime: 1000 * 60 * 120,
    retry: 0,
  });

  // ─── Derived data ──────────────────────────────────────────────────────────

  const heroItem: ContentItem | null = useMemo(() => {
    if (!trending?.length) return null;
    const item = trending[Math.floor(Math.random() * Math.min(5, trending.length))];
    if ('title' in item) return normalizeMovie(item as any);
    if ('name' in item) return normalizeTVShow(item as any);
    return null;
  }, [trending]);

  const popularMovieItems: ContentItem[] = useMemo(
    () => (popularMovies ?? []).map(normalizeMovie),
    [popularMovies]
  );

  const popularShowItems: ContentItem[] = useMemo(
    () => (popularShows ?? []).map(normalizeTVShow),
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
        {heroItem && <HeroSection item={heroItem} />}

        {/* Rows */}
        <View style={styles.rows}>
          <ContentRow
            title="Popular Movies"
            items={popularMovieItems}
            isLoading={moviesLoading}
            showRating
          />
          <ContentRow
            title="Top Series"
            items={popularShowItems}
            isLoading={showsLoading}
            showRating
          />
          {hasGemini && (
            <ContentRow
              title="✦ AI Picks: Movies"
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
            <ContentRow
              title="Recently Watched"
              items={historyItems ?? []}
              isLoading={historyLoading}
              showRating
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
