import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow, getPosterUrl } from '../../lib/tmdb';
import type { ContentItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = Spacing.sm;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - CARD_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

type MediaType = 'movie' | 'tv';

const SORT_OPTIONS: { label: string; value: string; tvValue?: string }[] = [
  { label: 'Popular', value: 'popularity.desc' },
  { label: 'Top Rated', value: 'vote_average.desc' },
  { label: 'Newest', value: 'primary_release_date.desc', tvValue: 'first_air_date.desc' },
  { label: 'Box Office', value: 'revenue.desc', tvValue: 'popularity.desc' },
];

const MOVIE_GENRES = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 27, name: 'Horror' },
  { id: 878, name: 'Sci-Fi' },
  { id: 10749, name: 'Romance' },
  { id: 53, name: 'Thriller' },
  { id: 16, name: 'Animation' },
  { id: 99, name: 'Documentary' },
  { id: 14, name: 'Fantasy' },
];

const TV_GENRES = [
  { id: 10759, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 9648, name: 'Mystery' },
  { id: 10765, name: 'Sci-Fi' },
  { id: 10768, name: 'War' },
  { id: 16, name: 'Animation' },
  { id: 99, name: 'Documentary' },
  { id: 10764, name: 'Reality' },
  { id: 10762, name: 'Kids' },
];

function GridCard({ item }: { item: ContentItem }) {
  const router = useRouter();
  const posterUrl = getPosterUrl(item.posterPath, 'medium');

  return (
    <TouchableOpacity
      style={styles.gridCard}
      onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
      activeOpacity={0.75}
    >
      <View style={styles.gridPoster}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.gridPosterImage} contentFit="cover" transition={300} />
        ) : (
          <View style={styles.gridPlaceholder}>
            <Text style={styles.gridPlaceholderText}>{item.title?.charAt(0) ?? '?'}</Text>
          </View>
        )}
        {item.rating > 0 && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingStar}>★</Text>
            <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.gridTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.gridYear}>{item.releaseDate?.slice(0, 4) ?? '—'}</Text>
    </TouchableOpacity>
  );
}

export default function DiscoverScreen() {
  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [sortIndex, setSortIndex] = useState(0);
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const sortOption = SORT_OPTIONS[sortIndex];
  const sortBy = mediaType === 'tv' && sortOption.tvValue ? sortOption.tvValue : sortOption.value;
  const genres = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;

  const discoverParams = {
    sort_by: sortBy,
    ...(selectedGenre ? { with_genres: selectedGenre } : {}),
    ...(mediaType === 'tv' ? {} : { 'vote_count.gte': sortIndex === 1 ? 200 : 0 }),
    include_adult: false,
  };

  const { data: discoverData, isLoading: discoverLoading } = useQuery({
    queryKey: ['discover', mediaType, sortBy, selectedGenre],
    queryFn: () =>
      mediaType === 'movie'
        ? tmdbApi.discoverMovies(discoverParams)
        : tmdbApi.discoverTV(discoverParams),
    enabled: !searchQuery,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['discover-search', mediaType, searchQuery],
    queryFn: () =>
      mediaType === 'movie'
        ? tmdbApi.searchMovies(searchQuery)
        : tmdbApi.searchTVShows(searchQuery),
    enabled: !!searchQuery && searchQuery.length > 2,
  });

  const items: ContentItem[] = useMemo(() => {
    if (searchQuery && searchData) {
      return mediaType === 'movie'
        ? (searchData as any[]).map(normalizeMovie)
        : (searchData as any[]).map(normalizeTVShow);
    }
    if (!discoverData) return [];
    return mediaType === 'movie'
      ? (discoverData as any[]).map(normalizeMovie)
      : (discoverData as any[]).map(normalizeTVShow);
  }, [discoverData, searchData, searchQuery, mediaType]);

  const isLoading = searchQuery ? searchLoading : discoverLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBar, searchFocused && styles.searchBarFocused]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search movies & shows..."
            placeholderTextColor={Colors.textMuted}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={Colors.primary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Media type toggle */}
      <View style={styles.toggleRow}>
        <View style={styles.toggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, mediaType === 'movie' && styles.toggleBtnActive]}
            onPress={() => { setMediaType('movie'); setSelectedGenre(null); }}
          >
            <Text style={[styles.toggleText, mediaType === 'movie' && styles.toggleTextActive]}>Movies</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mediaType === 'tv' && styles.toggleBtnActive]}
            onPress={() => { setMediaType('tv'); setSelectedGenre(null); }}
          >
            <Text style={[styles.toggleText, mediaType === 'tv' && styles.toggleTextActive]}>TV Shows</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sort + Genre filters (hidden when searching) */}
      {!searchQuery && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortRow}
          >
            {SORT_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.pill, i === sortIndex && styles.pillActive]}
                onPress={() => setSortIndex(i)}
              >
                <Text style={[styles.pillText, i === sortIndex && styles.pillTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.genreRow}
          >
            <TouchableOpacity
              style={[styles.genrePill, selectedGenre === null && styles.genrePillActive]}
              onPress={() => setSelectedGenre(null)}
            >
              <Text style={[styles.genreText, selectedGenre === null && styles.genreTextActive]}>All</Text>
            </TouchableOpacity>
            {genres.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={[styles.genrePill, selectedGenre === g.id && styles.genrePillActive]}
                onPress={() => setSelectedGenre(selectedGenre === g.id ? null : g.id)}
              >
                <Text style={[styles.genreText, selectedGenre === g.id && styles.genreTextActive]}>
                  {g.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {/* Results grid */}
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.mediaType}-${item.id}`}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <GridCard item={item} />}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {searchQuery.length > 0 && searchQuery.length <= 2
                ? 'Type at least 3 characters...'
                : 'No results found.'}
            </Text>
          }
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
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  searchRow: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  searchBarFocused: {
    borderColor: Colors.primary,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.text,
  },
  clearBtn: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  toggleRow: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  toggleText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: Colors.background,
    fontWeight: '700',
  },
  sortRow: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary + '22',
    borderColor: Colors.primary,
  },
  pillText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  pillTextActive: {
    color: Colors.primary,
  },
  genreRow: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  genrePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  genrePillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  genreText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  genreTextActive: {
    color: Colors.background,
    fontWeight: '700',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 20,
  },
  gridRow: {
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  gridCard: {
    width: CARD_WIDTH,
  },
  gridPoster: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    ...Shadow.sm,
  },
  gridPosterImage: {
    width: '100%',
    height: '100%',
  },
  gridPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridPlaceholderText: {
    ...Typography.title,
    color: Colors.textMuted,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '80',
  },
  ratingStar: {
    fontSize: 9,
    color: Colors.primary,
  },
  ratingText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  gridTitle: {
    ...Typography.caption,
    color: Colors.text,
    marginTop: 6,
    fontWeight: '600',
  },
  gridYear: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 60,
  },
});
