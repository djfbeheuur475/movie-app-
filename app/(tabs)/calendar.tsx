import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, startOfToday, isSameDay, parseISO } from 'date-fns';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, getPosterUrl } from '../../lib/tmdb';

// Use TMDB on-the-air shows as a calendar proxy when Trakt isn't connected
export default function CalendarScreen() {
  const today = startOfToday();
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: airingShows, isLoading } = useQuery({
    queryKey: ['on-the-air'],
    queryFn: () => tmdbApi.getOnTheAir(),
    staleTime: 1000 * 60 * 30,
  });

  const { data: airingToday } = useQuery({
    queryKey: ['airing-today'],
    queryFn: () => tmdbApi.getAiringToday(),
  });

  // Build 7-day strip
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(today, i)),
    []
  );

  // For demo: airing today entries show on selected date
  const selectedItems = useMemo(() => {
    const isToday = isSameDay(selectedDate, today);
    return isToday ? (airingToday ?? []) : (airingShows ?? []).slice(0, 8);
  }, [selectedDate, airingToday, airingShows]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Release Calendar</Text>
        <Text style={styles.subtitle}>{format(selectedDate, 'MMMM yyyy')}</Text>
      </View>

      {/* Date strip */}
      <FlatList
        data={days}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(d) => d.toISOString()}
        contentContainerStyle={styles.dateStrip}
        renderItem={({ item: day }) => {
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, today);
          return (
            <TouchableOpacity
              style={[styles.dayButton, isSelected && styles.dayButtonActive]}
              onPress={() => setSelectedDate(day)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dayName, isSelected && styles.dayNameActive]}>
                {format(day, 'EEE')}
              </Text>
              <Text style={[styles.dayNumber, isSelected && styles.dayNumberActive]}>
                {format(day, 'd')}
              </Text>
              {isToday && <View style={styles.todayDot} />}
            </TouchableOpacity>
          );
        }}
      />

      {/* Episodes list */}
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={selectedItems}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.episodeList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyText}>Nothing scheduled</Text>
              <Text style={styles.emptySubtext}>Connect Trakt to see your personal calendar</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.episodeCard}>
              <Image
                source={{ uri: getPosterUrl(item.poster_path, 'thumb') ?? '' }}
                style={styles.showPoster}
                contentFit="cover"
              />
              <View style={styles.episodeInfo}>
                <Text style={styles.showName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.episodeMeta}>
                  {item.first_air_date ? format(parseISO(item.first_air_date), 'MMM d') : ''}
                  {'  ·  '}
                  {item.origin_country?.[0] ?? ''}
                </Text>
                <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    ...Typography.hero,
    color: Colors.text,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textMuted,
    marginTop: 2,
  },
  dateStrip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dayButton: {
    alignItems: 'center',
    width: 52,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayName: {
    ...Typography.label,
    color: Colors.textMuted,
  },
  dayNameActive: {
    color: Colors.text,
  },
  dayNumber: {
    ...Typography.subheading,
    color: Colors.text,
  },
  dayNumberActive: {
    color: Colors.text,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    marginTop: 2,
  },
  episodeList: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  showPoster: {
    width: 80,
    height: 110,
  },
  episodeInfo: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: 'center',
  },
  showName: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: 4,
  },
  episodeMeta: {
    ...Typography.caption,
    color: Colors.primary,
    marginBottom: 6,
  },
  overview: {
    ...Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: Spacing.sm,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    ...Typography.heading,
    color: Colors.textSecondary,
  },
  emptySubtext: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
});
