import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getBackdropUrl, getPosterUrl } from '../../lib/tmdb';
import type { ContentItem } from '../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55;

interface Props {
  item: ContentItem;
  aiExplanation?: string;
}

export default function HeroSection({ item, aiExplanation }: Props) {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const backdropUrl = getBackdropUrl(item.backdropPath, 'large');
  const posterUrl = getPosterUrl(item.posterPath, 'large');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [item.id]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
    >
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Image
        source={{ uri: backdropUrl ?? posterUrl ?? '' }}
        style={styles.backdrop}
        contentFit="cover"
        transition={500}
      />
      <LinearGradient
        colors={['transparent', 'rgba(10,10,10,0.6)', 'rgba(10,10,10,0.95)', Colors.background]}
        locations={[0, 0.4, 0.7, 1]}
        style={styles.gradient}
      />
      <View style={styles.content}>
        {/* Featured badge */}
        <View style={styles.featuredBadge}>
          <Text style={styles.featuredText}>
            FEATURED {item.mediaType === 'tv' ? 'SERIES' : 'FILM'}
            {item.rating > 0 ? `  ★ ${item.rating.toFixed(1)}` : ''}
          </Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>

        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
        ) : null}

        {aiExplanation && (
          <View style={styles.aiTag}>
            <Text style={styles.aiTagText}>✦ AI Pick</Text>
            <Text style={styles.aiExplanation} numberOfLines={2}>{aiExplanation}</Text>
          </View>
        )}

        <View style={styles.meta}>
          <Text style={styles.metaText}>{item.releaseDate?.slice(0, 4)}</Text>
        </View>

      </View>
    </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: HERO_HEIGHT,
    width: SCREEN_WIDTH,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  gradient: {
    ...StyleSheet.absoluteFill,
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
  aiTag: {
    marginBottom: Spacing.sm,
  },
  aiTagText: {
    ...Typography.label,
    color: Colors.primary,
    marginBottom: 2,
  },
  aiExplanation: {
    ...Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 18,
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
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  star: {
    color: Colors.accent,
    fontSize: 12,
  },
});
