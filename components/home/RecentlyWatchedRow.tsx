import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { getPosterUrl } from '../../lib/tmdb';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import WatchedBadge from '../common/WatchedBadge';
import { PosterSkeleton } from '../common/LoadingSkeleton';
import type { ContentItem } from '../../types';

const CARD_WIDTH = 120;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

interface Props {
  items: ContentItem[];
  isLoading?: boolean;
  // tmdbId -> last watched episode
  lastEpisodes: Map<number, { season: number; episode: number }>;
}

function RecentCard({
  item,
  lastEp,
}: {
  item: ContentItem;
  lastEp: { season: number; episode: number } | undefined;
}) {
  const router = useRouter();
  const { isWatched } = useTraktWatched();
  const posterUrl = getPosterUrl(item.posterPath, 'medium');
  const watched = isWatched(item.id, item.mediaType);

  const epCode =
    item.mediaType === 'tv' && lastEp
      ? `S${String(lastEp.season).padStart(2, '0')}E${String(lastEp.episode).padStart(2, '0')}`
      : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
      activeOpacity={0.78}
    >
      <View style={styles.posterWrap}>
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={styles.posterImg}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[styles.posterImg, styles.posterFallback]}>
            <Text style={styles.fallbackChar}>{item.title?.charAt(0) ?? '?'}</Text>
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={styles.gradient}
        />

        {item.rating > 0 && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>★ {item.rating.toFixed(1)}</Text>
          </View>
        )}

        {watched && <WatchedBadge />}
      </View>

      {epCode && (
        <Text style={styles.epCode}>{epCode}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function RecentlyWatchedRow({ items, isLoading, lastEpisodes }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;
    if (isLoading || items.length > 0) {
      hasAnimated.current = true;
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading, items.length]);

  const renderItem = useCallback(
    ({ item }: { item: ContentItem }) => (
      <RecentCard item={item} lastEp={lastEpisodes.get(item.id)} />
    ),
    [lastEpisodes]
  );

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recently Watched</Text>
      </View>

      {isLoading ? (
        <FlatList
          data={Array(6).fill(null)}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          renderItem={() => <PosterSkeleton width={CARD_WIDTH} />}
        />
      ) : (
        <FlatList
          data={items}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => `rw-${item.mediaType}-${item.id}`}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.xl },
  header: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Typography.heading,
    color: Colors.text,
  },
  list: { paddingHorizontal: Spacing.lg },

  card: {
    width: CARD_WIDTH,
    marginRight: 10,
  },
  posterWrap: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    marginBottom: 5,
    ...Shadow.md,
  },
  posterImg: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  fallbackChar: {
    ...Typography.title,
    color: Colors.textMuted,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
  },
  ratingBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '80',
  },
  ratingText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.primary,
  },

  title: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 14,
  },
  epCode: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 2,
    letterSpacing: 0.2,
  },
});
