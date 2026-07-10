import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import PosterCard from '../common/PosterCard';
import { PosterSkeleton } from '../common/LoadingSkeleton';
import type { ContentItem } from '../../types';

interface Props {
  title: string;
  titleComponent?: React.ReactNode; // renders instead of title when provided
  subtitle?: string;
  items: ContentItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  onEndReached?: () => void;
  onSeeAll?: () => void;
  cardWidth?: number;
  showRating?: boolean;
  showType?: boolean;
  accent?: boolean;
}

export default function ContentRow({
  title,
  titleComponent,
  subtitle,
  items,
  isLoading,
  isLoadingMore,
  onEndReached,
  onSeeAll,
  cardWidth = 120,
  showRating = false,
  showType = false,
  accent = false,
}: Props) {
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

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <PosterCard item={item} width={cardWidth} showRating={showRating} showType={showType} />
  ), [cardWidth, showRating, showType]);

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={[styles.header, accent && styles.headerAccent]}>
        <View style={styles.titleBlock}>
          {titleComponent
            ? <Text style={[styles.title, accent && styles.titleAccent]}>{titleComponent}</Text>
            : <Text style={[styles.title, accent && styles.titleAccent]}>{title}</Text>
          }
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
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
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          renderItem={renderItem}
          ListFooterComponent={
            isLoadingMore ? (
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
  titleBlock: {
    flex: 1,
    gap: 2,
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
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '400',
  },
  seeAll: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: Spacing.lg,
  },
  loadingMore: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: Spacing.lg,
  },
});
