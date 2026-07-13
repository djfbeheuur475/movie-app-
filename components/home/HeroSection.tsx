import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getBackdropUrl, getPosterUrl } from '../../lib/tmdb';
import type { ContentItem } from '../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55;
const AUTO_ADVANCE_MS = 6000;

interface Props {
  items: ContentItem[];
}

function HeroSlide({ item, onPress }: { item: ContentItem; onPress: () => void }) {
  const backdropUrl = getBackdropUrl(item.backdropPath, 'large');
  const posterUrl = getPosterUrl(item.posterPath, 'large');

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.slide}>
      <Image
        source={{ uri: backdropUrl ?? posterUrl ?? '' }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={300}
      />
      <LinearGradient
        colors={['transparent', 'rgba(10,10,10,0.6)', 'rgba(10,10,10,0.95)', Colors.background]}
        locations={[0, 0.4, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        {item.rating > 0 && (
          <View style={styles.featuredBadge}>
            <Text style={styles.featuredText}>★ {item.rating.toFixed(1)}</Text>
          </View>
        )}
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
        ) : null}
        <View style={styles.meta}>
          <Text style={styles.metaText}>{item.releaseDate?.slice(0, 4)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HeroSection({ items }: Props) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<ContentItem>>(null);
  const activeIndexRef = useRef(0);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      const next = (activeIndexRef.current + 1) % items.length;
      activeIndexRef.current = next;
      setActiveIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  // Must be stable refs — FlatList warns if these change between renders
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0] != null) {
      const idx = viewableItems[0].index ?? 0;
      activeIndexRef.current = idx;
      setActiveIndex(idx);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  if (!items.length) return null;

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <HeroSlide
            item={item}
            onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
          />
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        decelerationRate="fast"
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: HERO_HEIGHT,
    width: SCREEN_WIDTH,
  },
  slide: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
  },
  content: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  featuredBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '22',
    borderWidth: 1,
    borderColor: Colors.primary + '80',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: Spacing.sm,
  },
  featuredText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: Spacing.xs,
  },
  overview: {
    ...Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: Spacing.md,
  },
  metaText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
});
