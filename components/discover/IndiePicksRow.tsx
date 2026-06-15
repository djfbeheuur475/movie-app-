import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow, getPosterUrl } from '../../lib/tmdb';
import { hasGoodMetadata, getIndieBadge } from '../../lib/quality';
import { PosterSkeleton } from '../common/LoadingSkeleton';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import WatchedBadge from '../common/WatchedBadge';
import type { ContentItem } from '../../types';

const CARD_WIDTH = 152;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

const FESTIVAL_SOURCES = [
  'Cannes', 'Sundance', 'TIFF', 'Venice', 'Berlinale',
  'SXSW', 'Tribeca', 'Oscars', 'BAFTA', 'Spirit Awards',
];

// Returns date strings for the two cutoffs, computed at call time
function getDateCutoffs() {
  const now = new Date();
  const y = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${mm}-${dd}`;

  const recentFrom = new Date(now);
  recentFrom.setFullYear(y - 3);
  const recentFromStr = recentFrom.toISOString().slice(0, 10);

  const classicBefore = new Date(now);
  classicBefore.setFullYear(y - 5);
  const classicBeforeStr = classicBefore.toISOString().slice(0, 10);

  return { recentFrom: recentFromStr, classicBefore: classicBeforeStr, today };
}

// ─── Individual poster card ────────────────────────────────────────────────────

function IndiePosterCard({ item }: { item: ContentItem }) {
  const router = useRouter();
  const { isWatched } = useTraktWatched();
  const posterUrl = getPosterUrl(item.posterPath, 'medium');
  const badge = getIndieBadge(item);
  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const watched = isWatched(item.id, item.mediaType);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
      activeOpacity={0.72}
    >
      <View style={styles.posterWrap}>
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={styles.poster}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Text style={styles.fallbackChar}>{item.title?.charAt(0) ?? '?'}</Text>
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.82)']}
          style={styles.posterGradient}
        />

        {item.rating > 0 && (
          <View style={styles.ratingChip}>
            <Text style={styles.ratingStar}>★</Text>
            <Text style={styles.ratingVal}>{item.rating.toFixed(1)}</Text>
          </View>
        )}

        {badge && (
          <View style={[styles.badgeChip, { borderColor: badge.color + '55' }]}>
            <Text style={[styles.badgeLabel, { color: badge.color }]}>{badge.label}</Text>
          </View>
        )}

        {watched && <WatchedBadge />}
      </View>

      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      {year ? <Text style={styles.year}>{year}</Text> : null}
    </TouchableOpacity>
  );
}

// ─── Row config per variant ────────────────────────────────────────────────────

type Variant = 'recent' | 'classic';

function getVariantConfig(variant: Variant, mediaType: 'movie' | 'tv') {
  const { recentFrom, classicBefore } = getDateCutoffs();

  if (variant === 'recent') {
    return {
      icon: '🎬',
      title: `Recent Indie & Critics' Picks${mediaType === 'tv' ? ' — TV' : ''}`,
      sub: `Last 3 years · Festival darlings · Award winners`,
      dateGte: recentFrom,
      dateLte: undefined as string | undefined,
      queryKeySuffix: `recent-${recentFrom.slice(0, 7)}`, // month-level granularity
    };
  }
  return {
    icon: '🎞',
    title: `Classic Indie & Critics' Picks${mediaType === 'tv' ? ' — TV' : ''}`,
    sub: `5+ years ago · Essential arthouse · Critics' favourites`,
    dateGte: undefined as string | undefined,
    dateLte: classicBefore,
    queryKeySuffix: `classic-${classicBefore.slice(0, 4)}`, // year-level granularity
  };
}

// ─── Section row ───────────────────────────────────────────────────────────────

interface RowProps {
  mediaType?: 'movie' | 'tv';
  variant: Variant;
}

export default function IndiePicksRow({ mediaType = 'movie', variant }: RowProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  const hasAnimated = useRef(false);

  const config = getVariantConfig(variant, mediaType);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ['discover-indie-critics-picks', mediaType, config.queryKeySuffix],
      queryFn: async ({ pageParam }) => {
        const page = pageParam as number;
        const opts = { dateGte: config.dateGte, dateLte: config.dateLte };
        if (mediaType === 'tv') {
          const { results, total_pages } = await tmdbApi.getIndieCriticsPicksTV(page, opts);
          const items = results.map(normalizeTVShow).filter(hasGoodMetadata);
          return { items, nextPage: page < total_pages ? page + 1 : null };
        }
        const { results, total_pages } = await tmdbApi.getIndieCriticsPicks(page, opts);
        const items = results.map(normalizeMovie).filter(hasGoodMetadata);
        return { items, nextPage: page < total_pages ? page + 1 : null };
      },
      initialPageParam: 1,
      getNextPageParam: (last) => last.nextPage ?? undefined,
      staleTime: 1000 * 60 * 30,
    });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    if (hasAnimated.current) return;
    if (isLoading || items.length > 0) {
      hasAnimated.current = true;
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 320, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading, items.length]);

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <IndiePosterCard item={item} />
  ), []);

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <View style={styles.accentBar} />
        <View style={styles.headerText}>
          <Text style={styles.sectionTitle}>{config.icon} {config.title}</Text>
          <Text style={styles.sectionSub}>{config.sub}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.festivalRow}
      >
        {FESTIVAL_SOURCES.map((name) => (
          <View key={name} style={styles.festivalChip}>
            <Text style={styles.festivalChipText}>{name}</Text>
          </View>
        ))}
      </ScrollView>

      {isLoading ? (
        <FlatList
          data={Array(8).fill(null)}
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
          keyExtractor={(item) => `indie-${variant}-${item.id}`}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          onEndReached={hasNextPage ? () => fetchNextPage() : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </Animated.View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: 10,
  },
  accentBar: {
    width: 3,
    height: 38,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    marginTop: 2,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 0.1,
  },
  sectionSub: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
  festivalRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  festivalChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  festivalChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.4,
  },
  list: {
    paddingHorizontal: Spacing.lg,
  },
  loadingMore: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: CARD_WIDTH,
    marginRight: 12,
    ...Shadow.sm,
  },
  posterWrap: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    marginBottom: 7,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackChar: {
    ...Typography.title,
    color: Colors.textMuted,
  },
  posterGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '52%',
  },
  ratingChip: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '80',
  },
  ratingStar: {
    fontSize: 9,
    color: Colors.primary,
  },
  ratingVal: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  badgeChip: {
    position: 'absolute',
    bottom: 8,
    left: 7,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 16,
    marginBottom: 2,
  },
  year: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '400',
  },
});
