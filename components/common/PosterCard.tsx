import React from 'react';
import { Pressable, StyleSheet, View, Text, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, BorderRadius, Typography, Shadow } from '../../constants/theme';
import { getPosterUrl } from '../../lib/tmdb';
import type { ContentItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Props {
  item: ContentItem;
  width?: number;
  showTitle?: boolean;
  showRating?: boolean;
}

export default function PosterCard({ item, width = 120, showTitle = false, showRating = false }: Props) {
  const router = useRouter();
  const height = width * 1.5;
  const posterUrl = getPosterUrl(item.posterPath, width > 150 ? 'large' : 'medium');
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    router.push(`/title/${item.id}?type=${item.mediaType}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.93, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      }}
      style={[styles.container, { width, ...Shadow.md }]}
    >
      <Animated.View style={animatedStyle}>
        <View style={[styles.poster, { width, height, borderRadius: BorderRadius.md }]}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={[styles.image, { borderRadius: BorderRadius.md }]}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={[styles.placeholder, { borderRadius: BorderRadius.md }]}>
              <Text style={styles.placeholderText}>{item.title?.charAt(0) ?? '?'}</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={[styles.gradient, { borderRadius: BorderRadius.md }]}
          />
          {showRating && item.rating > 0 && (
            <View style={styles.ratingBadge}>
              <Text style={{ fontSize: 9, color: Colors.primary }}>★</Text>
              <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        {showTitle && (
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginRight: 10,
  },
  poster: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
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
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '80',
  },
  ratingText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  title: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 16,
  },
});
