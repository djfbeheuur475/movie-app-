import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { PosterSkeleton } from '../common/LoadingSkeleton';
import { getPosterUrl } from '../../lib/tmdb';
import type { NewEpisodeEntry } from '../../lib/newEpisodes';

const CARD_WIDTH = 120;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatAirDate(dateStr: string): { dayLabel: string; dateLabel: string } {
  // Parse without timezone shift (treat as local date)
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const isToday = date.getTime() === today.getTime();
  const isTomorrow = date.getTime() === tomorrow.getTime();

  const dayLabel = isToday ? 'TODAY' : isTomorrow ? 'TMW' : DAY_SHORT[date.getDay()];
  const dateLabel = `${MONTH_SHORT[m - 1]} ${d}`;
  return { dayLabel, dateLabel };
}

function NewEpsCard({ show, entry }: { show: any; entry: NewEpisodeEntry }) {
  const router = useRouter();
  const posterUrl = getPosterUrl(show.poster_path, 'medium');
  const { dayLabel, dateLabel } = formatAirDate(entry.airDate);
  const epCode = `S${String(entry.season).padStart(2, '0')}E${String(entry.episode).padStart(2, '0')}`;
  const watchable = entry.status !== 'upcoming';
  const badge = entry.status === 'upcoming'
    ? dayLabel
    : entry.status === 'today' ? 'TODAY' : entry.unwatchedCount > 1 ? `${entry.unwatchedCount} NEW` : 'NEW';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/title/${show.id}?type=tv`)}
      activeOpacity={0.8}
      accessibilityLabel={`${show.name}, ${epCode}, ${watchable ? 'out now' : `airs ${dateLabel}`}`}
    >
      {/* Poster — ringed when there's something to watch right now */}
      <View style={[styles.posterWrap, watchable && styles.posterWrapNew]}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.posterImg} contentFit="cover" transition={300} />
        ) : (
          <View style={styles.posterPlaceholder}>
            <Text style={styles.posterPlaceholderText}>{show.name?.charAt(0) ?? '?'}</Text>
          </View>
        )}

        {show.vote_average > 0 && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>★ {show.vote_average.toFixed(1)}</Text>
          </View>
        )}

        <View style={[styles.dayBadge, watchable && styles.dayBadgeNew]}>
          <Text style={[styles.dayBadgeText, watchable && styles.dayBadgeTextNew]}>{badge}</Text>
        </View>
      </View>

      <Text style={styles.epInfo} numberOfLines={1}>
        {epCode}
        <Text style={styles.epDate}>{watchable ? '  ·  Out now' : `  ·  ${dateLabel}`}</Text>
      </Text>
    </TouchableOpacity>
  );
}

interface Props {
  title: string;
  subtitle?: string;
  items: { show: any; entry: NewEpisodeEntry }[];
  isLoading?: boolean;
}

const NEW_EPS_ITEM_SIZE = CARD_WIDTH + 10;

export default function NewEpsRow({ title, subtitle, items, isLoading }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;
    if (isLoading || items.length > 0) {
      hasAnimated.current = true;
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading, items.length]);

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>

      {isLoading ? (
        <FlatList
          data={Array(6).fill(null)}
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
          keyExtractor={(x) => String(x.show.id)}
          contentContainerStyle={styles.list}
          getItemLayout={(_, index) => ({ length: NEW_EPS_ITEM_SIZE, offset: Spacing.lg + NEW_EPS_ITEM_SIZE * index, index })}
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={3}
          renderItem={({ item }) => <NewEpsCard show={item.show} entry={item.entry} />}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.xl },
  header: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerTitle: { ...Typography.heading, color: Colors.text },
  headerSubtitle: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: Spacing.lg },

  card: { width: CARD_WIDTH, marginRight: 10 },

  posterWrap: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    ...Shadow.md,
  },
  posterImg: { width: '100%', height: '100%' },
  posterPlaceholder: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  posterPlaceholderText: { ...Typography.title, color: Colors.textMuted },

  ratingBadge: {
    position: 'absolute', top: 5, right: 5,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.primary + '80',
  },
  ratingText: { fontSize: 9, fontWeight: '700', color: Colors.primary },

  dayBadge: {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  dayBadgeNew: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  posterWrapNew: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  dayBadgeText: {
    fontSize: 8, fontWeight: '800', color: '#ccc', letterSpacing: 0.5,
  },
  dayBadgeTextNew: { color: Colors.background },

  title: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 6,
    lineHeight: 14,
  },
  epInfo: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 2,
    lineHeight: 13,
  },
  epDate: {
    fontWeight: '400',
    color: Colors.textMuted,
  },
});
