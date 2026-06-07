import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  SectionList,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format, addDays, startOfToday, isSameDay, parseISO, isAfter, isBefore, addMonths } from 'date-fns';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, getPosterUrl, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useWatchlistStore } from '../../store/watchlistStore';
import type { ContentItem } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  airDate: Date;
  note: string; // e.g. "Season 3 premiere" or "In cinemas"
  isFromWatchlist: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByDate(entries: CalendarEntry[]): { title: string; data: CalendarEntry[] }[] {
  const map = new Map<string, CalendarEntry[]>();
  const today = startOfToday();
  const cutoff = addMonths(today, 3);

  entries
    .filter((e) => isAfter(e.airDate, addDays(today, -1)) && isBefore(e.airDate, cutoff))
    .sort((a, b) => a.airDate.getTime() - b.airDate.getTime())
    .forEach((entry) => {
      const key = format(entry.airDate, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    });

  return Array.from(map.entries()).map(([dateKey, data]) => {
    const d = parseISO(dateKey);
    const isToday = isSameDay(d, today);
    const isTomorrow = isSameDay(d, addDays(today, 1));
    const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : format(d, 'EEEE, MMMM d');
    return { title: label, data };
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DateStrip({
  days,
  selected,
  onSelect,
  highlightedDates,
}: {
  days: Date[];
  selected: Date | null;
  onSelect: (d: Date | null) => void;
  highlightedDates: Set<string>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dateStrip}
    >
      <TouchableOpacity
        style={[styles.dayButton, !selected && styles.dayButtonActive]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.dayName, !selected && styles.dayTextActive]}>All</Text>
        <Text style={[styles.dayNumber, !selected && styles.dayTextActive]}>▼</Text>
      </TouchableOpacity>

      {days.map((day) => {
        const key = format(day, 'yyyy-MM-dd');
        const isSelected = selected ? isSameDay(day, selected) : false;
        const hasEvents = highlightedDates.has(key);
        const isToday = isSameDay(day, startOfToday());
        return (
          <TouchableOpacity
            key={key}
            style={[styles.dayButton, isSelected && styles.dayButtonActive]}
            onPress={() => onSelect(isSelected ? null : day)}
          >
            <Text style={[styles.dayName, isSelected && styles.dayTextActive]}>
              {format(day, 'EEE')}
            </Text>
            <Text style={[styles.dayNumber, isSelected && styles.dayTextActive]}>
              {format(day, 'd')}
            </Text>
            {hasEvents && <View style={[styles.dot, isSelected && styles.dotActive]} />}
            {isToday && !hasEvents && <View style={styles.todayDot} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function CalendarCard({ entry }: { entry: CalendarEntry }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={[styles.card, entry.isFromWatchlist && styles.cardHighlighted]}
      onPress={() => router.push(`/title/${entry.tmdbId}?type=${entry.mediaType}`)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: getPosterUrl(entry.posterPath, 'thumb') ?? '' }}
        style={styles.cardPoster}
        contentFit="cover"
      />
      <View style={styles.cardInfo}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{entry.title}</Text>
          {entry.isFromWatchlist && (
            <View style={styles.watchlistPip}>
              <Text style={styles.watchlistPipText}>✓ Saved</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardNote}>{entry.note}</Text>
        <Text style={styles.cardDate}>{format(entry.airDate, 'EEEE, MMM d · h:mm a')}</Text>
      </View>
      <Text style={styles.cardType}>{entry.mediaType === 'movie' ? '🎬' : '📺'}</Text>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = startOfToday();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const router = useRouter();
  const { items: watchlist } = useWatchlistStore();

  const days = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(today, i)), []);

  // Upcoming movies (global)
  const { data: upcomingMovies, isLoading: moviesLoading } = useQuery({
    queryKey: ['upcoming-movies-cal'],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: 1000 * 60 * 60,
  });

  // On-the-air shows (global)
  const { data: onAirShows, isLoading: showsLoading } = useQuery({
    queryKey: ['on-air-cal'],
    queryFn: () => tmdbApi.getOnTheAir(),
    staleTime: 1000 * 60 * 60,
  });

  // Fetch details for watchlist TV shows to get next_episode_to_air
  const watchlistShowIds = watchlist.filter((w) => w.media_type === 'tv').map((w) => w.tmdb_id);
  const { data: watchlistShowDetails } = useQuery({
    queryKey: ['watchlist-show-details', watchlistShowIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        watchlistShowIds.slice(0, 10).map((id) => tmdbApi.getTVDetail(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: watchlistShowIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // Fetch upcoming movies for watchlist movie entries
  const watchlistMovieIds = new Set(watchlist.filter((w) => w.media_type === 'movie').map((w) => w.tmdb_id));

  // Build unified CalendarEntry list
  const allEntries: CalendarEntry[] = useMemo(() => {
    const entries: CalendarEntry[] = [];

    // Watchlist shows with known next episode
    (watchlistShowDetails ?? []).forEach((show: any) => {
      const next = show.next_episode_to_air;
      if (!next?.air_date) return;
      const airDate = parseISO(next.air_date);
      entries.push({
        id: `show-next-${show.id}`,
        tmdbId: show.id,
        mediaType: 'tv',
        title: show.name,
        posterPath: show.poster_path,
        airDate,
        note: `S${String(next.season_number).padStart(2, '0')}E${String(next.episode_number).padStart(2, '0')} — ${next.name ?? 'New episode'}`,
        isFromWatchlist: true,
      });
    });

    // Global upcoming movies
    (upcomingMovies ?? []).forEach((m) => {
      if (!m.release_date) return;
      try {
        const airDate = parseISO(m.release_date);
        entries.push({
          id: `movie-${m.id}`,
          tmdbId: m.id,
          mediaType: 'movie',
          title: m.title,
          posterPath: m.poster_path,
          airDate,
          note: 'In cinemas',
          isFromWatchlist: watchlistMovieIds.has(m.id),
        });
      } catch {}
    });

    // Global on-air shows — first_air_date is when the show launched, not the next episode.
    // Pin them to today so they appear in the calendar as "Currently airing".
    (onAirShows ?? []).slice(0, 20).forEach((s) => {
      if (watchlistShowIds.includes(s.id)) return;
      entries.push({
        id: `show-${s.id}`,
        tmdbId: s.id,
        mediaType: 'tv',
        title: s.name,
        posterPath: s.poster_path,
        airDate: today,
        note: 'Currently airing 📺',
        isFromWatchlist: false,
      });
    });

    return entries;
  }, [watchlistShowDetails, upcomingMovies, onAirShows, watchlistMovieIds, watchlistShowIds]);

  const filteredEntries = useMemo(() => {
    if (!selectedDate) return allEntries;
    return allEntries.filter((e) => isSameDay(e.airDate, selectedDate));
  }, [allEntries, selectedDate]);

  const sections = useMemo(() => groupByDate(filteredEntries), [filteredEntries]);

  const highlightedDates = useMemo(() => {
    const s = new Set<string>();
    allEntries.forEach((e) => s.add(format(e.airDate, 'yyyy-MM-dd')));
    return s;
  }, [allEntries]);

  const watchlistEntries = allEntries.filter((e) => e.isFromWatchlist);
  const isLoading = moviesLoading || showsLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Calendar</Text>
          <Text style={styles.subtitle}>
            {selectedDate ? format(selectedDate, 'MMMM d, yyyy') : format(today, 'MMMM yyyy')}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {watchlistEntries.length > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{watchlistEntries.length} saved upcoming</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Date strip */}
      <DateStrip
        days={days}
        selected={selectedDate}
        onSelect={setSelectedDate}
        highlightedDates={highlightedDates}
      />

      {/* Watchlist upcoming banner */}
      {watchlistEntries.length > 0 && !selectedDate && (
        <View style={styles.watchlistBanner}>
          <Text style={styles.bannerIcon}>✓</Text>
          <Text style={styles.bannerText}>
            {watchlistEntries.length} upcoming release{watchlistEntries.length > 1 ? 's' : ''} from your watchlist
          </Text>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : sections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📅</Text>
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.emptyText}>
            {selectedDate
              ? 'No releases on this date.'
              : 'Add shows and movies to your watchlist to see upcoming episodes and releases here.'}
          </Text>
          {!watchlist.length && (
            <TouchableOpacity style={styles.discoverBtn} onPress={() => router.push('/(tabs)')}>
              <Text style={styles.discoverBtnText}>Browse &amp; Save Titles →</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => <CalendarCard entry={item} />}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerBadge: {
    backgroundColor: Colors.success + '22',
    borderWidth: 1,
    borderColor: Colors.success,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerBadgeText: {
    ...Typography.label,
    color: Colors.success,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 17,
    color: Colors.textMuted,
  },
  dateStrip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dayButton: {
    alignItems: 'center',
    width: 50,
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
  dayNumber: {
    ...Typography.subheading,
    color: Colors.text,
  },
  dayTextActive: {
    color: Colors.text,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    marginTop: 2,
  },
  dotActive: {
    backgroundColor: Colors.text,
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    marginTop: 2,
  },
  watchlistBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.success + '15',
    borderWidth: 1,
    borderColor: Colors.success + '40',
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  bannerIcon: {
    color: Colors.success,
    fontWeight: '700',
    fontSize: 14,
  },
  bannerText: {
    ...Typography.body,
    color: Colors.success,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 32,
  },
  sectionHeader: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sectionHeaderText: {
    ...Typography.heading,
    color: Colors.text,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  cardHighlighted: {
    borderColor: Colors.success + '60',
    backgroundColor: Colors.success + '08',
  },
  cardPoster: {
    width: 64,
    height: 88,
    backgroundColor: Colors.surfaceElevated,
  },
  cardInfo: {
    flex: 1,
    padding: Spacing.md,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  cardTitle: {
    ...Typography.subheading,
    color: Colors.text,
    flex: 1,
  },
  watchlistPip: {
    backgroundColor: Colors.success + '22',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  watchlistPipText: {
    ...Typography.label,
    color: Colors.success,
  },
  cardNote: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '600',
  },
  cardDate: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  cardType: {
    fontSize: 18,
    paddingRight: Spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    fontSize: 52,
  },
  emptyTitle: {
    ...Typography.heading,
    color: Colors.textSecondary,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  discoverBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  discoverBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
});
