import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Colors, Spacing, Typography } from '../../constants/theme';
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
}

export default function ContentRow({
  title,
  items,
  isLoading,
  onSeeAll,
  cardWidth = 120,
  showRating = false,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
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
    </View>
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
  title: {
    ...Typography.heading,
    color: Colors.text,
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
