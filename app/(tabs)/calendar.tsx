import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ActivityIndicator, SectionList, TextInput, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  format, addDays, startOfWeek, endOfWeek, startOfToday,
  isSameDay, parseISO, isAfter, isBefore, addWeeks,
} from 'date-fns';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, getPosterUrl } from '../../lib/tmdb';
import { traktApi } from '../../lib/trakt';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useApiKeysStore } from '../../store/apiKeysStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  airDate: Date;
  note: string;
  isFromWatchlist: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByDate(entries: CalendarEntry[]): { title: string; data: CalendarEntry[] }[] {
  const map = new Map<string, CalendarEntry[]>();
  const today = startOfToday();

  entries
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

const PERIOD_OPTIONS = [
  { offset: 0, label: 'This Week' },
  { offset: 1, label: 'Next Week' },
  { offset: 2, label: 'Upcoming' },
] as const;

type PeriodOffset = 0 | 1 | 2;

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
            <View style={styles.savedPip}>
              <Text style={styles.savedPipText}>✓</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardNote}>{entry.note}</Text>
        <Text style={styles.cardDate}>{format(entry.airDate, 'EEE, MMM d')}</Text>
      </View>
      <Ionicons
        name={entry.mediaType === 'movie' ? 'film-outline' : 'tv-outline'}
        size={18}
        color={Colors.textMuted}
        style={styles.cardTypeIcon}
      />
    </TouchableOpacity>
  );
}

function ShowSearchResult({ show, onPress }: { show: any; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.searchResult} onPress={onPress} activeOpacity={0.75}>
      <Image
        source={{ uri: getPosterUrl(show.poster_path, 'thumb') ?? '' }}
        style={styles.searchResultPoster}
        contentFit="cover"
      />
      <View style={styles.searchResultInfo}>
        <Text style={styles.searchResultTitle} numberOfLines={1}>{show.name}</Text>
        <Text style={styles.searchResultYear}>{show.first_air_date?.slice(0, 4) ?? ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = startOfToday();
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState<PeriodOffset>(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [pinnedShow, setPinnedShow] = useState<{ id: number; name: string } | null>(null);

  const { items: watchlist } = useWatchlistStore();
  const { traktClientId, traktUsername, traktAccessToken } = useApiKeysStore();
  const hasTrakt = !!(traktClientId && (traktUsername || traktAccessToken));

  const weekStart = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
  const currentPeriodLabel = PERIOD_OPTIONS.find((o) => o.offset === weekOffset)?.label ?? 'This Week';

  // ── TMDB upcoming movies ──────────────────────────────────────────────────

  const { data: upcomingMovies, isLoading: moviesLoading } = useQuery({
    queryKey: ['upcoming-movies-cal'],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: 1000 * 60 * 60,
  });

  // ── Watchlist TV shows → next_episode_to_air ──────────────────────────────

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

  // ── Trakt history → top shows not already in watchlist ───────────────────

  const { data: traktWatchedShows } = useQuery({
    queryKey: ['trakt-cal-shows', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedShows(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const traktShowTmdbIds = useMemo(() => {
    if (!traktWatchedShows?.length) return [];
    return traktWatchedShows
      .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
      .map((s) => s.show.ids.tmdb)
      .filter((id) => id && !watchlistShowIds.includes(id))
      .slice(0, 12);
  }, [traktWatchedShows, watchlistShowIds]);

  const { data: traktShowDetails, isLoading: traktShowsLoading } = useQuery({
    queryKey: ['trakt-show-details-cal', traktShowTmdbIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        traktShowTmdbIds.map((id) => tmdbApi.getTVDetail(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: traktShowTmdbIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // ── TV show search ────────────────────────────────────────────────────────

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['tv-search', searchQuery],
    queryFn: () => tmdbApi.searchTVShows(searchQuery),
    enabled: searchQuery.length > 1,
    staleTime: 1000 * 60 * 5,
  });

  // ── Pinned show next episode ──────────────────────────────────────────────

  const { data: pinnedShowDetail, isLoading: pinnedLoading } = useQuery({
    queryKey: ['pinned-show', pinnedShow?.id],
    queryFn: () => tmdbApi.getTVDetail(pinnedShow!.id),
    enabled: !!pinnedShow,
    staleTime: 1000 * 60 * 30,
  });

  // ── Build entries ─────────────────────────────────────────────────────────

  const watchlistMovieIds = useMemo(
    () => new Set(watchlist.filter((w) => w.media_type === 'movie').map((w) => w.tmdb_id)),
    [watchlist]
  );

  const allEntries: CalendarEntry[] = useMemo(() => {
    const entries: CalendarEntry[] = [];

    // Watchlist shows — use next_episode_to_air
    (watchlistShowDetails ?? []).forEach((show: any) => {
      const next = show.next_episode_to_air;
      if (!next?.air_date) return;
      entries.push({
        id: `show-next-${show.id}`,
        tmdbId: show.id,
        mediaType: 'tv',
        title: show.name,
        posterPath: show.poster_path,
        airDate: parseISO(next.air_date),
        note: `S${String(next.season_number).padStart(2, '0')}E${String(next.episode_number).padStart(2, '0')} — ${next.name ?? 'New episode'}`,
        isFromWatchlist: true,
      });
    });

    // Trakt history shows — use next_episode_to_air
    (traktShowDetails ?? []).forEach((show: any) => {
      const next = show.next_episode_to_air;
      if (!next?.air_date) return;
      entries.push({
        id: `trakt-show-${show.id}`,
        tmdbId: show.id,
        mediaType: 'tv',
        title: show.name,
        posterPath: show.poster_path,
        airDate: parseISO(next.air_date),
        note: `S${String(next.season_number).padStart(2, '0')}E${String(next.episode_number).padStart(2, '0')} — ${next.name ?? 'New episode'}`,
        isFromWatchlist: false,
      });
    });

    // Upcoming movies
    (upcomingMovies ?? []).forEach((m) => {
      if (!m.release_date) return;
      try {
        entries.push({
          id: `movie-${m.id}`,
          tmdbId: m.id,
          mediaType: 'movie',
          title: m.title,
          posterPath: m.poster_path,
          airDate: parseISO(m.release_date),
          note: 'In cinemas',
          isFromWatchlist: watchlistMovieIds.has(m.id),
        });
      } catch {}
    });

    return entries;
  }, [watchlistShowDetails, traktShowDetails, upcomingMovies, watchlistMovieIds]);

  // ── Filter by selected period ─────────────────────────────────────────────

  const weekEntries = useMemo(() => {
    if (weekOffset === 2) {
      // "Upcoming" — everything from today onwards, no end cap
      return allEntries.filter(
        (e) => isAfter(e.airDate, addDays(today, -1)) || isSameDay(e.airDate, today)
      );
    }
    return allEntries.filter(
      (e) =>
        (isAfter(e.airDate, addDays(weekStart, -1)) || isSameDay(e.airDate, weekStart)) &&
        (isBefore(e.airDate, addDays(weekEnd, 1)) || isSameDay(e.airDate, weekEnd))
    );
  }, [allEntries, weekOffset, weekStart, weekEnd, today]);

  const sections = useMemo(() => groupByDate(weekEntries), [weekEntries]);

  const handleShowSelect = useCallback((show: any) => {
    setPinnedShow({ id: show.id, name: show.name });
    setSearchQuery('');
    setSearchActive(false);
  }, []);

  const isLoading = moviesLoading || traktShowsLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Calendar</Text>
          <Text style={styles.subtitle}>
            {weekOffset === 2
              ? 'All upcoming releases'
              : format(weekStart, 'MMMM yyyy')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="settings-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Period dropdown */}
      <View style={styles.weekDropdownWrap}>
        <TouchableOpacity
          style={styles.weekDropdownTrigger}
          onPress={() => setDropdownOpen((v) => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.weekDropdownLabel}>{currentPeriodLabel}</Text>
          <Ionicons
            name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={Colors.textMuted}
          />
        </TouchableOpacity>

        {dropdownOpen && (
          <View style={styles.weekDropdownList}>
            {PERIOD_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.offset}
                style={[
                  styles.weekDropdownItem,
                  i === PERIOD_OPTIONS.length - 1 && styles.weekDropdownItemLast,
                  weekOffset === opt.offset && styles.weekDropdownItemActive,
                ]}
                onPress={() => { setWeekOffset(opt.offset); setDropdownOpen(false); }}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.weekDropdownItemText,
                  weekOffset === opt.offset && styles.weekDropdownItemTextActive,
                ]}>
                  {opt.label}
                </Text>
                {weekOffset === opt.offset && (
                  <Ionicons name="checkmark" size={16} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Show search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={(t) => { setSearchQuery(t); setSearchActive(true); }}
            onFocus={() => setSearchActive(true)}
            placeholder="Search a TV show for episode dates..."
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.primary}
            returnKeyType="search"
          />
          {(searchQuery.length > 0 || pinnedShow) && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setPinnedShow(null); setSearchActive(false); }}>
              <Ionicons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {searchActive && searchQuery.length > 1 && (
          <View style={styles.searchDropdown}>
            {searchLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ padding: 12 }} />
            ) : (
              <FlatList
                data={(searchResults ?? []).slice(0, 6)}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <ShowSearchResult show={item} onPress={() => handleShowSelect(item)} />
                )}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
        )}
      </View>

      {/* Pinned show next episode */}
      {pinnedShow && (
        <View style={styles.pinnedCard}>
          {pinnedLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : pinnedShowDetail?.next_episode_to_air ? (
            <>
              <Text style={styles.pinnedTitle}>{pinnedShow.name}</Text>
              <Text style={styles.pinnedEp}>
                S{String(pinnedShowDetail.next_episode_to_air.season_number).padStart(2, '0')}
                E{String(pinnedShowDetail.next_episode_to_air.episode_number).padStart(2, '0')}
                {' — '}{pinnedShowDetail.next_episode_to_air.name ?? 'New episode'}
              </Text>
              <Text style={styles.pinnedDate}>
                {format(parseISO(pinnedShowDetail.next_episode_to_air.air_date), 'EEEE, MMMM d, yyyy')}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.pinnedTitle}>{pinnedShow.name}</Text>
              <Text style={styles.pinnedEp}>No upcoming episodes scheduled</Text>
            </>
          )}
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : sections.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {hasTrakt ? 'Nothing scheduled' : 'Connect Trakt to see your shows'}
          </Text>
          <Text style={styles.emptyText}>
            {hasTrakt
              ? 'Try "Upcoming" or search for a show above.'
              : 'Go to Settings → Trakt to connect your account.'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
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
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  subtitle: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  weekDropdownWrap: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, zIndex: 20 },
  weekDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  weekDropdownLabel: { ...Typography.subheading, color: Colors.text, fontWeight: '600' },
  weekDropdownList: {
    marginTop: 4, backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.sm,
  },
  weekDropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  weekDropdownItemLast: { borderBottomWidth: 0 },
  weekDropdownItemActive: { backgroundColor: Colors.primary + '18' },
  weekDropdownItemText: { ...Typography.body, color: Colors.text, fontWeight: '500' },
  weekDropdownItemTextActive: { color: Colors.primary, fontWeight: '700' },
  searchWrap: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm, zIndex: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10, gap: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.body, color: Colors.text },
  searchDropdown: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4, maxHeight: 280, overflow: 'hidden',
  },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.sm,
    gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchResultPoster: { width: 40, height: 56, borderRadius: 4, backgroundColor: Colors.surfaceElevated },
  searchResultInfo: { flex: 1 },
  searchResultTitle: { ...Typography.body, color: Colors.text, fontWeight: '600' },
  searchResultYear: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
  pinnedCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    backgroundColor: Colors.primary + '15', borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.primary + '40', padding: Spacing.md, gap: 4,
  },
  pinnedTitle: { ...Typography.subheading, color: Colors.primary, fontWeight: '700' },
  pinnedEp: { ...Typography.body, color: Colors.text },
  pinnedDate: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: 32 },
  sectionHeader: { paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  sectionHeaderText: { ...Typography.heading, color: Colors.text },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  cardHighlighted: { borderColor: Colors.primary + '50', backgroundColor: Colors.primary + '08' },
  cardPoster: { width: 60, height: 84, backgroundColor: Colors.surfaceElevated },
  cardInfo: { flex: 1, padding: Spacing.md, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.subheading, color: Colors.text, flex: 1 },
  savedPip: {
    backgroundColor: Colors.primary + '22', borderRadius: BorderRadius.sm,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  savedPipText: { ...Typography.label, color: Colors.primary },
  cardNote: { ...Typography.caption, color: Colors.primary, fontWeight: '600' },
  cardDate: { ...Typography.caption, color: Colors.textMuted },
  cardTypeIcon: { marginRight: Spacing.md },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: Spacing.md,
  },
  emptyTitle: { ...Typography.heading, color: Colors.textSecondary },
  emptyText: { ...Typography.body, color: Colors.textMuted, textAlign: 'center', lineHeight: 22 },
});
