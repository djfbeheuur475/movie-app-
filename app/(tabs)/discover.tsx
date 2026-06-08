import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow, getPosterUrl } from '../../lib/tmdb';
import type { ContentItem } from '../../types';

const { width: SW } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_WIDTH = (SW - Spacing.lg * 2 - CARD_GAP) / 2;

type MediaTab = 'movies' | 'shows';
type SortKey = 'popular' | 'top' | 'newest' | 'revenue';
type DateRange = '12m' | '24m' | '5y' | 'all';
type GenreId = number | null;
type ActiveFilter = 'sort' | 'date' | 'genre' | null;

const DATE_OPTIONS: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'Anytime' },
  { key: '12m', label: '12 Months' },
  { key: '24m', label: '24 Months' },
  { key: '5y', label: '5 Years' },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'top', label: 'Top Rated' },
  { key: 'newest', label: 'Newest' },
  { key: 'revenue', label: 'Box Office' },
];

const MOVIE_GENRES: { id: number; name: string }[] = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 18, name: 'Drama' },
  { id: 14, name: 'Fantasy' }, { id: 27, name: 'Horror' }, { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' }, { id: 53, name: 'Thriller' },
];

const TV_GENRES: { id: number; name: string }[] = [
  { id: 10759, name: 'Action' }, { id: 16, name: 'Animation' }, { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' }, { id: 18, name: 'Drama' },
  { id: 10765, name: 'Sci-Fi' }, { id: 9648, name: 'Mystery' }, { id: 10766, name: 'Soap' },
  { id: 10768, name: 'War & Politics' }, { id: 37, name: 'Western' },
];

function dateRangeToParam(range: DateRange, media: MediaTab): Record<string, string> {
  if (range === 'all') return {};
  const now = new Date();
  let gte: Date;
  if (range === '12m') gte = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  else if (range === '24m') gte = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  else gte = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const gteStr = gte.toISOString().slice(0, 10);
  return media === 'movies'
    ? { 'primary_release_date.gte': gteStr }
    : { 'first_air_date.gte': gteStr };
}

function sortToParams(sort: SortKey, media: MediaTab): Record<string, string> {
  if (sort === 'popular') return { sort_by: 'popularity.desc' };
  if (sort === 'top') return { sort_by: 'vote_average.desc', 'vote_count.gte': '200' };
  if (sort === 'newest') return {
    sort_by: media === 'movies' ? 'primary_release_date.desc' : 'first_air_date.desc',
    ...(media === 'movies' ? { 'release_date.lte': new Date().toISOString().slice(0, 10) } : {}),
  };
  if (sort === 'revenue') return media === 'movies'
    ? { sort_by: 'revenue.desc' }
    : { sort_by: 'popularity.desc' };
  return {};
}

function DropdownButton({
  label, value, isOpen, isActive, onPress,
}: {
  label: string;
  value: string;
  isOpen: boolean;
  isActive: boolean;
  onPress: () => void;
}) {
  const lit = isOpen || isActive;
  return (
    <TouchableOpacity
      style={[styles.dropBtn, lit && styles.dropBtnLit]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.dropBtnLabel, lit && styles.dropBtnLabelLit]}>{label}: </Text>
      <Text style={[styles.dropBtnValue, lit && styles.dropBtnValueLit]}>{value}</Text>
      <Ionicons
        name={isOpen ? 'chevron-up' : 'chevron-down'}
        size={11}
        color={lit ? Colors.primary : Colors.textMuted}
        style={{ marginLeft: 3 }}
      />
    </TouchableOpacity>
  );
}

function PosterCard({ item, onPress }: { item: ContentItem; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image
        source={{ uri: getPosterUrl(item.posterPath, 'medium') ?? '' }}
        style={styles.cardImage}
        contentFit="cover"
        transition={200}
      />
      {item.rating > 0 && (
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingText}>★ {item.rating.toFixed(1)}</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.cardYear}>{item.releaseDate?.slice(0, 4) ?? ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const [media, setMedia] = useState<MediaTab>('movies');
  const [sort, setSort] = useState<SortKey>('popular');
  const [genre, setGenre] = useState<GenreId>(null);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);

  const genres = media === 'movies' ? MOVIE_GENRES : TV_GENRES;

  const sortLabel = SORT_OPTIONS.find((s) => s.key === sort)?.label ?? 'Popular';
  const dateLabel = DATE_OPTIONS.find((d) => d.key === dateRange)?.label ?? 'Anytime';
  const genreLabel = genres.find((g) => g.id === genre)?.name ?? 'All';
  const hasActiveFilters = sort !== 'popular' || dateRange !== 'all' || genre !== null;

  const toggleFilter = (f: ActiveFilter) =>
    setActiveFilter((prev) => (prev === f ? null : f));

  const resetFilters = () => {
    setSort('popular');
    setDateRange('all');
    setGenre(null);
    setActiveFilter(null);
  };

  const queryParams = useMemo(() => ({
    ...sortToParams(sort, media),
    ...dateRangeToParam(dateRange, media),
    ...(genre ? { with_genres: String(genre) } : {}),
    page: 1,
  }), [sort, genre, media, dateRange]);

  const { data: items, isLoading } = useQuery<ContentItem[]>({
    queryKey: ['discover', media, sort, genre, dateRange],
    queryFn: async (): Promise<ContentItem[]> => {
      if (media === 'movies') {
        const results = await tmdbApi.discoverMovies(queryParams);
        return results.map(normalizeMovie);
      } else {
        const results = await tmdbApi.discoverTV(queryParams);
        return results.map(normalizeTVShow);
      }
    },
  });

  const handleMediaChange = useCallback((m: MediaTab) => {
    setMedia(m);
    setGenre(null);
    setDateRange('all');
    setActiveFilter(null);
  }, []);

  // Options to display in the expanded dropdown row
  const dropdownItems = useMemo(() => {
    if (activeFilter === 'sort')
      return SORT_OPTIONS.map((o) => ({
        key: o.key, label: o.label,
        selected: sort === o.key,
        onSelect: () => { setSort(o.key); setActiveFilter(null); },
      }));
    if (activeFilter === 'date')
      return DATE_OPTIONS.map((o) => ({
        key: o.key, label: o.label,
        selected: dateRange === o.key,
        onSelect: () => { setDateRange(o.key); setActiveFilter(null); },
      }));
    if (activeFilter === 'genre')
      return [
        { key: 'all', label: 'All', selected: genre === null, onSelect: () => { setGenre(null); setActiveFilter(null); } },
        ...genres.map((g) => ({
          key: String(g.id), label: g.name,
          selected: genre === g.id,
          onSelect: () => { setGenre(g.id); setActiveFilter(null); },
        })),
      ];
    return [];
  }, [activeFilter, sort, dateRange, genre, genres]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerSub}>Browse by genre, popularity, and more</Text>
      </View>

      {/* Movies / TV Shows toggle */}
      <View style={styles.mediaToggle}>
        <TouchableOpacity
          style={[styles.mediaBtn, media === 'movies' && styles.mediaBtnActive]}
          onPress={() => handleMediaChange('movies')}
          activeOpacity={0.8}
        >
          <Text style={styles.mediaBtnIcon}>🎬</Text>
          <Text style={[styles.mediaBtnText, media === 'movies' && styles.mediaBtnTextActive]}>Movies</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.mediaBtn, media === 'shows' && styles.mediaBtnActive]}
          onPress={() => handleMediaChange('shows')}
          activeOpacity={0.8}
        >
          <Text style={styles.mediaBtnIcon}>📺</Text>
          <Text style={[styles.mediaBtnText, media === 'shows' && styles.mediaBtnTextActive]}>TV Shows</Text>
        </TouchableOpacity>
      </View>

      {/* Single-row filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        style={styles.filterBarWrap}
      >
        {/* Filter icon — tapping resets all filters */}
        <TouchableOpacity
          style={[styles.filterIconBtn, hasActiveFilters && styles.filterIconBtnActive]}
          onPress={resetFilters}
          activeOpacity={0.75}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={hasActiveFilters ? Colors.primary : Colors.textMuted}
          />
        </TouchableOpacity>

        <DropdownButton
          label="Sort"
          value={sortLabel}
          isOpen={activeFilter === 'sort'}
          isActive={sort !== 'popular'}
          onPress={() => toggleFilter('sort')}
        />

        <DropdownButton
          label="Release"
          value={dateLabel}
          isOpen={activeFilter === 'date'}
          isActive={dateRange !== 'all'}
          onPress={() => toggleFilter('date')}
        />

        <DropdownButton
          label="Genre"
          value={genreLabel}
          isOpen={activeFilter === 'genre'}
          isActive={genre !== null}
          onPress={() => toggleFilter('genre')}
        />
      </ScrollView>

      {/* Expanded dropdown options row */}
      {activeFilter && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.optionsRow}
          style={styles.optionsWrap}
          keyboardShouldPersistTaps="handled"
        >
          {dropdownItems.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.optionChip, opt.selected && styles.optionChipSelected]}
              onPress={opt.onSelect}
              activeOpacity={0.75}
            >
              {opt.selected && (
                <Ionicons name="checkmark" size={11} color={Colors.background} style={{ marginRight: 3 }} />
              )}
              <Text style={[styles.optionChipText, opt.selected && styles.optionChipTextSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Grid */}
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(item) => `${item.id}-${item.mediaType}`}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <PosterCard
              item={item}
              onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSub: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  mediaToggle: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mediaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
  },
  mediaBtnActive: { backgroundColor: Colors.primary },
  mediaBtnIcon: { fontSize: 16 },
  mediaBtnText: { ...Typography.subheading, color: Colors.textMuted },
  mediaBtnTextActive: { color: Colors.background },

  // Filter bar
  filterBarWrap: {
    marginBottom: 6,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: 8,
  },
  filterIconBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIconBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '18',
  },
  dropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropBtnLit: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '18',
  },
  dropBtnLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  dropBtnLabelLit: { color: Colors.primary },
  dropBtnValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  dropBtnValueLit: { color: Colors.primary },

  // Options row (expanded)
  optionsWrap: {
    marginBottom: 8,
  },
  optionsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  optionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  optionChipTextSelected: {
    color: Colors.background,
    fontWeight: '700',
  },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: 24,
    gap: CARD_GAP,
  },
  row: { gap: CARD_GAP },
  card: {
    width: CARD_WIDTH,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  cardImage: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.5,
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  ratingText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  cardInfo: { padding: 8, gap: 2 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, lineHeight: 17 },
  cardYear: { ...Typography.label, color: Colors.textMuted },
});
