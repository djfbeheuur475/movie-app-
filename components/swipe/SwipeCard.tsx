import React, { useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, Dimensions, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import type { ContentItem } from '../../types';

const { width: SW } = Dimensions.get('window');
export const CARD_WIDTH = SW - Spacing.xl * 2;
export const CARD_HEIGHT = Math.round(SW * 1.28);
const SWIPE_THRESHOLD = SW * 0.28;
const OUT_X = SW * 1.6;

export interface SwipeCardRef {
  swipeLeft: () => void;
  swipeRight: () => void;
}

interface Props {
  item: ContentItem;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onPress: () => void;
  isTop: boolean;
  stackIndex: number;
}

const SwipeCard = forwardRef<SwipeCardRef, Props>(
  ({ item, onSwipeLeft, onSwipeRight, onPress, isTop, stackIndex }, ref) => {
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const scale = useSharedValue(stackIndex === 0 ? 1 : stackIndex === 1 ? 0.94 : 0.88);

    useEffect(() => {
      const target = stackIndex === 0 ? 1 : stackIndex === 1 ? 0.94 : 0.88;
      scale.value = withSpring(target, { damping: 16, stiffness: 160 });
    }, [stackIndex]);

    useImperativeHandle(ref, () => ({
      swipeLeft: () => {
        tx.value = withTiming(-OUT_X, { duration: 300 }, (finished) => {
          if (finished) runOnJS(onSwipeLeft)();
        });
      },
      swipeRight: () => {
        tx.value = withTiming(OUT_X, { duration: 300 }, (finished) => {
          if (finished) runOnJS(onSwipeRight)();
        });
      },
    }));

    const gesture = Gesture.Pan()
      .enabled(isTop)
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = e.translationY * 0.2;
      })
      .onEnd((e) => {
        if (e.translationX > SWIPE_THRESHOLD) {
          tx.value = withTiming(OUT_X, { duration: 300 }, (finished) => {
            if (finished) runOnJS(onSwipeRight)();
          });
        } else if (e.translationX < -SWIPE_THRESHOLD) {
          tx.value = withTiming(-OUT_X, { duration: 300 }, (finished) => {
            if (finished) runOnJS(onSwipeLeft)();
          });
        } else {
          tx.value = withSpring(0, { damping: 18, stiffness: 200 });
          ty.value = withSpring(0, { damping: 18, stiffness: 200 });
        }
      });

    const cardStyle = useAnimatedStyle(() => {
      const rotate = interpolate(
        tx.value,
        [-SW / 2, 0, SW / 2],
        [-10, 0, 10],
        Extrapolation.CLAMP
      );
      return {
        transform: [
          { translateX: tx.value },
          { translateY: ty.value + stackIndex * 12 },
          { rotate: `${rotate}deg` },
          { scale: scale.value },
        ],
      };
    });

    const saveStyle = useAnimatedStyle(() => ({
      opacity: interpolate(tx.value, [0, SWIPE_THRESHOLD * 0.55], [0, 1], Extrapolation.CLAMP),
    }));

    const skipStyle = useAnimatedStyle(() => ({
      opacity: interpolate(tx.value, [-SWIPE_THRESHOLD * 0.55, 0], [1, 0], Extrapolation.CLAMP),
    }));

    const imageUrl = item.backdropPath
      ? `https://image.tmdb.org/t/p/w780${item.backdropPath}`
      : item.posterPath
      ? `https://image.tmdb.org/t/p/w500${item.posterPath}`
      : null;

    const year = item.releaseDate ? item.releaseDate.substring(0, 4) : '';

    return (
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.card, cardStyle]}>
          <TouchableOpacity activeOpacity={0.97} onPress={onPress} style={styles.fill}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.94)']}
              locations={[0.3, 0.6, 1]}
              style={StyleSheet.absoluteFill}
            />

            {/* SAVE badge */}
            <Animated.View style={[styles.badge, styles.badgeSave, saveStyle]}>
              <Text style={styles.badgeTextSave}>SAVE</Text>
            </Animated.View>

            {/* SKIP badge */}
            <Animated.View style={[styles.badge, styles.badgeSkip, skipStyle]}>
              <Text style={styles.badgeTextSkip}>SKIP</Text>
            </Animated.View>

            {/* Bottom info */}
            <View style={styles.info}>
              <View style={styles.metaRow}>
                {item.rating > 0 && (
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingText}>★ {item.rating.toFixed(1)}</Text>
                  </View>
                )}
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>
                    {item.mediaType === 'movie' ? 'Film' : 'Series'}
                  </Text>
                </View>
                {year ? <Text style={styles.yearText}>{year}</Text> : null}
              </View>

              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>

              {item.overview ? (
                <Text style={styles.overview} numberOfLines={3}>{item.overview}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    );
  }
);

export default SwipeCard;

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 14,
  },
  fill: {
    flex: 1,
  },
  placeholder: {
    backgroundColor: Colors.surfaceElevated,
  },
  badge: {
    position: 'absolute',
    top: 32,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 3,
  },
  badgeSave: {
    left: 18,
    borderColor: '#22c55e',
    transform: [{ rotate: '-12deg' }],
  },
  badgeSkip: {
    right: 18,
    borderColor: '#ef4444',
    transform: [{ rotate: '12deg' }],
  },
  badgeTextSave: {
    fontSize: 20,
    fontWeight: '900',
    color: '#22c55e',
    letterSpacing: 2,
  },
  badgeTextSkip: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ef4444',
    letterSpacing: 2,
  },
  info: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  ratingBadge: {
    backgroundColor: 'rgba(245,158,11,0.18)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  typeBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  yearText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
    lineHeight: 31,
  },
  overview: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.62)',
    lineHeight: 18,
    marginTop: 2,
  },
});
