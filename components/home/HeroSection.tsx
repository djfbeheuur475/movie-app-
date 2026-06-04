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

  const handlePress = () => {
    router.push(`/title/${item.id}?type=${item.mediaType}`);
  };

  return (
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
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {aiExplanation && (
          <View style={styles.aiTag}>
            <Text style={styles.aiTagText}>✦ AI Pick</Text>
            <Text style={styles.aiExplanation} numberOfLines={2}>{aiExplanation}</Text>
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.metaText}>{item.releaseDate?.slice(0, 4)}</Text>
          {item.rating > 0 && (
            <View style={styles.rating}>
              <Text style={styles.star}>★</Text>
              <Text style={styles.metaText}>{item.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.playButton} onPress={handlePress} activeOpacity={0.8}>
            <Text style={styles.playButtonText}>▶  More Info</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={handlePress} activeOpacity={0.8}>
            <Text style={styles.addButtonText}>+ Watchlist</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
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
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
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
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  playButton: {
    backgroundColor: Colors.text,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    flex: 1,
    alignItems: 'center',
  },
  playButtonText: {
    ...Typography.subheading,
    color: Colors.background,
  },
  addButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  addButtonText: {
    ...Typography.subheading,
    color: Colors.text,
  },
});
