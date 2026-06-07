import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useWatchlistStore } from '../../store/watchlistStore';
import SwipeCard, { SwipeCardRef } from '../../components/swipe/SwipeCard';
import type { ContentItem } from '../../types';

const { width: SW } = Dimensions.get('window');

type Category = 'trending' | 'movies' | 'shows' | 'top';

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: 'trending', label: 'Trending', icon: '🔥' },
  { key: 'movies', label: 'Movies', icon: '🎬' },
  { key: 'shows', label: 'TV Shows', icon: '📺' },
  { key: 'top', label: 'Top Rated', icon: '⭐' },
];

export default function DiscoverScreen() {
  const router = useRouter();
  const { addToWatchlist } = useWatchlistStore();
  const topCardRef = useRef<SwipeCardRef>(null);

  const [category, setCategory] = useState<Category>('trending');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [savedCount, setSavedCount] = useState(0);

  const { data: trending, isLoading: loadingTrending } = useQuery({
    queryKey: ['swipe-trending'],
    queryFn: async (): Promise<ContentItem[]> => {
      const data = await tmdbApi.getTrending('all', 'week');
      return data.map((item: any) =>
        'title' in item ? normalizeMovie(item) : normalizeTVShow(item)
      );
    },
  });

  const { data: movies, isLoading: loadingMovies } = useQuery({
    queryKey: ['swipe-movies'],
    queryFn: async (): Promise<ContentItem[]> => {
      const data = await tmdbApi.getPopularMovies();
      return data.map(normalizeMovie);
    },
  });

  const { data: shows, isLoading: loadingShows } = useQuery({
    queryKey: ['swipe-shows'],
    queryFn: async (): Promise<ContentItem[]> => {
      const data = await tmdbApi.getPopularShows();
      return data.map(normalizeTVShow);
    },
  });

  const { data: topRated, isLoading: loadingTop } = useQuery({
    queryKey: ['swipe-top'],
    queryFn: async (): Promise<ContentItem[]> => {
      const data = await tmdbApi.getTopRatedMovies();
      return data.map(normalizeMovie);
    },
  });

  const items = useMemo<ContentItem[]>(() => {
    const map: Record<Category, ContentItem[] | undefined> = {
      trending,
      movies,
      shows,
      top: topRated,
    };
    return map[category] ?? [];
  }, [category, trending, movies, shows, topRated]);

  const isLoading =
    (category === 'trending' && loadingTrending) ||
    (category === 'movies' && loadingMovies) ||
    (category === 'shows' && loadingShows) ||
    (category === 'top' && loadingTop);

  const visibleCards = items.slice(currentIndex, currentIndex + 3);
  const remaining = items.length - currentIndex;
  const isDone = !isLoading && items.length > 0 && currentIndex >= items.length;

  const handleSwipeLeft = useCallback(() => {
    setCurrentIndex((i) => i + 1);
  }, []);

  const handleSwipeRight = useCallback(() => {
    const item = items[currentIndex];
    if (item) {
      addToWatchlist({
        tmdb_id: item.id,
        media_type: item.mediaType,
        title: item.title,
        poster_path: item.posterPath,
      });
      setSavedCount((c) => c + 1);
    }
    setCurrentIndex((i) => i + 1);
  }, [items, currentIndex, addToWatchlist]);

  const handlePress = useCallback(
    (item: ContentItem) => {
      router.push(`/title/${item.id}?type=${item.mediaType}`);
    },
    [router]
  );

  const handleCategoryChange = useCallback((cat: Category) => {
    setCategory(cat);
    setCurrentIndex(0);
    setSavedCount(0);
  }, []);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setSavedCount(0);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Discover</Text>
          {savedCount > 0 && (
            <Text style={styles.savedLabel}>{savedCount} saved to watchlist</Text>
          )}
        </View>
        {!isLoading && !isDone && remaining > 0 && (
          <View style={styles.progressPill}>
            <Text style={styles.progressText}>{remaining} left</Text>
          </View>
        )}
      </View>

      {/* Category pills */}
      <View style={styles.pills}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.pill, category === c.key && styles.pillActive]}
            onPress={() => handleCategoryChange(c.key)}
            activeOpacity={0.75}
          >
            <Text style={styles.pillIcon}>{c.icon}</Text>
            <Text style={[styles.pillText, category === c.key && styles.pillTextActive]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Deck area */}
      <View style={styles.deck}>
        {isLoading ? (
          <ActivityIndicator color={Colors.primary} size="large" />
        ) : isDone ? (
          <View style={styles.doneState}>
            <Text style={styles.doneEmoji}>🎉</Text>
            <Text style={styles.doneTitle}>You've seen them all!</Text>
            <Text style={styles.doneSub}>
              {savedCount > 0
                ? `${savedCount} title${savedCount > 1 ? 's' : ''} saved to your watchlist.`
                : 'Try a different category.'}
            </Text>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.82}>
              <Text style={styles.resetBtnText}>Start Over</Text>
            </TouchableOpacity>
          </View>
        ) : (
          [...visibleCards].reverse().map((item, revIdx) => {
            const stackIndex = visibleCards.length - 1 - revIdx;
            const isTop = stackIndex === 0;
            return (
              <SwipeCard
                key={`${category}-${item.id}`}
                ref={isTop ? topCardRef : null}
                item={item}
                stackIndex={stackIndex}
                isTop={isTop}
                onSwipeLeft={handleSwipeLeft}
                onSwipeRight={handleSwipeRight}
                onPress={() => handlePress(item)}
              />
            );
          })
        )}
      </View>

      {/* Action buttons */}
      {!isLoading && !isDone && visibleCards.length > 0 && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.skipBtn]}
            onPress={() => topCardRef.current?.swipeLeft()}
            activeOpacity={0.8}
          >
            <Text style={styles.skipIcon}>✕</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.infoBtn]}
            onPress={() => visibleCards[0] && handlePress(visibleCards[0])}
            activeOpacity={0.8}
          >
            <Text style={styles.infoIcon}>ℹ</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.saveBtn]}
            onPress={() => topCardRef.current?.swipeRight()}
            activeOpacity={0.8}
          >
            <Text style={styles.saveIcon}>♡</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* First-time swipe hint */}
      {!isLoading && !isDone && currentIndex === 0 && (
        <Text style={styles.hint}>← Skip · Swipe · Save →</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  savedLabel: {
    ...Typography.caption,
    color: '#22c55e',
    marginTop: 1,
  },
  progressPill: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progressText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  pills: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillIcon: {
    fontSize: 12,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  pillTextActive: {
    color: Colors.background,
    fontWeight: '700',
  },
  deck: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneState: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xxl,
  },
  doneEmoji: {
    fontSize: 56,
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  doneSub: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  resetBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 13,
  },
  resetBtnText: {
    ...Typography.subheading,
    color: Colors.background,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 99,
    borderWidth: 2,
  },
  skipBtn: {
    width: 58,
    height: 58,
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  infoBtn: {
    width: 46,
    height: 46,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveBtn: {
    width: 58,
    height: 58,
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34,197,94,0.1)',
  },
  skipIcon: {
    fontSize: 22,
    color: '#ef4444',
    fontWeight: '700',
  },
  infoIcon: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  saveIcon: {
    fontSize: 24,
    color: '#22c55e',
  },
  hint: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingBottom: Spacing.md,
    letterSpacing: 1,
  },
});
