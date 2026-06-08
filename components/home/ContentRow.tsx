import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import PosterCard from '../common/PosterCard';
import { PosterSkeleton } from '../common/LoadingSkeleton';
import type { ContentItem } from '../../types';

interface Props {
  title: string;
  items: ContentItem[];
  isLoading?: boolean;
  onSeeAll?: () => void;
  cardWidth?: number;
  showRating?: boolean;
  accent?: boolean;
}

export default function ContentRow({
  title,
  items,
  isLoading,
  onSeeAll,
  cardWidth = 120,
  showRating = false,
  accent = false,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!isLoading && items.length > 0) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading, items.length]);

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={[styles.header, accent && styles.headerAccent]}>
        <Text style={[styles.title, accent && styles.titleAccent]}>{title}</Text>
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <FlatList
          data={Array(8).fill(null)}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          renderItem={() => <PosterSkeleton width={cardWidth} />}
        />
      ) : (
        <FlatList
          data={items}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => `${item.mediaType}-${item.id}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <PosterCard item={item} width={cardWidth} showRating={showRating} />
          )}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerAccent: {
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.heading,
    color: Colors.text,
  },
  titleAccent: {
    color: Colors.primary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  seeAll: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: Spacing.lg,
  },
});
