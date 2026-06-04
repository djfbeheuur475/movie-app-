import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  View,
  Text,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
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

  const handlePress = () => {
    router.push(`/title/${item.id}?type=${item.mediaType}`);
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.75}
      style={[styles.container, { width, ...Shadow.md }]}
    >
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
        {showRating && item.rating > 0 && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
          </View>
        )}
      </View>
      {showTitle && (
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
      )}
    </TouchableOpacity>
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
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  ratingText: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: '700',
  },
  title: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 16,
  },
});
