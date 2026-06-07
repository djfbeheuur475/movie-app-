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
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import HeroSection from '../../components/home/HeroSection';
import ContentRow from '../../components/home/ContentRow';
import type { ContentItem } from '../../types';

export default function HomeScreen() {
  const router = useRouter();

  const { data: trending, isLoading: trendingLoading, refetch: refetchTrending } = useQuery({
    queryKey: ['trending'],
    queryFn: () => tmdbApi.getTrending('all', 'week'),
  });

  const { data: popularMovies, isLoading: moviesLoading } = useQuery({
    queryKey: ['popular-movies'],
    queryFn: () => tmdbApi.getPopularMovies(),
  });

  const { data: popularShows, isLoading: showsLoading } = useQuery({
    queryKey: ['popular-shows'],
    queryFn: () => tmdbApi.getPopularShows(),
  });

  const { data: airingToday, isLoading: airingLoading } = useQuery({
    queryKey: ['airing-today'],
    queryFn: () => tmdbApi.getAiringToday(),
  });

  const { data: topRated, isLoading: topRatedLoading } = useQuery({
    queryKey: ['top-rated'],
    queryFn: () => tmdbApi.getTopRatedMovies(),
  });

  const { data: upcoming, isLoading: upcomingLoading } = useQuery({
    queryKey: ['upcoming-movies'],
    queryFn: () => tmdbApi.getUpcomingMovies(),
  });

  const heroItem: ContentItem | null = useMemo(() => {
    if (!trending?.length) return null;
    const item = trending[Math.floor(Math.random() * Math.min(5, trending.length))];
    if ('title' in item) return normalizeMovie(item as any);
    if ('name' in item) return normalizeTVShow(item as any);
    return null;
  }, [trending]);

  const trendingItems: ContentItem[] = useMemo(() => {
    return (trending ?? []).slice(0, 20).map((item) => {
      if ('title' in item) return normalizeMovie(item as any);
      return normalizeTVShow(item as any);
    });
  }, [trending]);

  const popularMovieItems: ContentItem[] = useMemo(
    () => (popularMovies ?? []).map(normalizeMovie),
    [popularMovies]
  );

  const popularShowItems: ContentItem[] = useMemo(
    () => (popularShows ?? []).map(normalizeTVShow),
    [popularShows]
  );

  const airingItems: ContentItem[] = useMemo(
    () => (airingToday ?? []).map(normalizeTVShow),
    [airingToday]
  );

  const topRatedItems: ContentItem[] = useMemo(
    () => (topRated ?? []).map(normalizeMovie),
    [topRated]
  );

  const upcomingItems: ContentItem[] = useMemo(
    () => (upcoming ?? []).map(normalizeMovie),
    [upcoming]
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
          <TouchableOpacity
            style={styles.aiButton}
            onPress={() => router.push('/(tabs)/ai')}
            activeOpacity={0.8}
          >
            <Text style={styles.aiButtonText}>✦ Ask AI</Text>
          </TouchableOpacity>
        </View>

        {/* Hero */}
        {heroItem && <HeroSection item={heroItem} />}

        {/* Rows */}
        <View style={styles.rows}>
          <ContentRow
            title="Trending This Week"
            items={trendingItems}
            isLoading={trendingLoading}
            showRating
          />
          <ContentRow
            title="New Episodes Tonight"
            items={airingItems}
            isLoading={airingLoading}
          />
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
          <ContentRow
            title="Hidden Gems"
            items={topRatedItems}
            isLoading={topRatedLoading}
            showRating
            cardWidth={140}
          />
          <ContentRow
            title="Coming Soon"
            items={upcomingItems}
            isLoading={upcomingLoading}
          />
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
  aiButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: 20,
  },
  aiButtonText: {
    ...Typography.label,
    color: Colors.background,
    fontWeight: '800',
  },
  rows: {
    paddingTop: Spacing.xl,
  },
});
