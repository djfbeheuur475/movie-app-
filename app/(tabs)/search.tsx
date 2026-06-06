import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import SearchBar from '../../components/search/SearchBar';
import { tmdbApi } from '../../lib/tmdb';
import { usePreferencesStore } from '../../store/preferencesStore';
import { getPosterUrl } from '../../lib/tmdb';
import type { TMDBSearchResult } from '../../types';

const GENRE_PILLS = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 27, name: 'Horror' },
  { id: 18, name: 'Drama' },
  { id: 878, name: 'Sci-Fi' },
  { id: 10749, name: 'Romance' },
  { id: 53, name: 'Thriller' },
  { id: 16, name: 'Animation' },
];

function SearchResultItem({ item }: { item: TMDBSearchResult }) {
  const router = useRouter();
  const isMedia = item.media_type === 'movie' || item.media_type === 'tv';
  const title = item.title ?? item.name ?? 'Unknown';
  const poster = item.poster_path ?? item.profile_path;
  const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4);
  const rating = item.vote_average;

  const handlePress = () => {
    if (isMedia) {
      router.push(`/title/${item.id}?type=${item.media_type}`);
    } else {
      router.push(`/person/${item.id}`);
    }
  };

  return (
    <TouchableOpacity style={styles.resultItem} onPress={handlePress} activeOpacity={0.75}>
      <Image
        source={{ uri: getPosterUrl(poster ?? null, 'thumb') ?? '' }}
        style={[styles.resultPoster, item.media_type === 'person' && styles.resultAvatar]}
        contentFit="cover"
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>{title}</Text>
        <View style={styles.resultMeta}>
          <Text style={styles.resultType}>
            {item.media_type === 'movie' ? '🎬' : item.media_type === 'tv' ? '📺' : '👤'}
            {' '}{item.media_type === 'person' ? item.known_for_department : year}
          </Text>
          {rating && rating > 0 && (
            <Text style={styles.resultRating}>★ {rating.toFixed(1)}</Text>
          )}
        </View>
        {item.overview && (
          <Text style={styles.resultOverview} numberOfLines={2}>{item.overview}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const { recentSearches, addRecentSearch, clearRecentSearches } = usePreferencesStore();

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', activeQuery],
    queryFn: () => tmdbApi.searchMulti(activeQuery),
    enabled: activeQuery.length >= 2,
  });

  const handleSubmit = useCallback(() => {
    const q = query.trim();
    if (q.length < 2) return;
    setActiveQuery(q);
    addRecentSearch(q);
  }, [query]);

  const handleGenrePress = useCallback((genreName: string) => {
    setQuery(genreName);
    setActiveQuery(genreName);
    addRecentSearch(genreName);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <View style={styles.searchBarWrapper}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onSubmit={handleSubmit}
            onClear={() => setActiveQuery('')}
          />
        </View>
      </View>

      {!activeQuery ? (
        <View style={styles.discover}>
          {/* Genre pills */}
          <Text style={styles.sectionTitle}>Browse by Genre</Text>
          <View style={styles.genreGrid}>
            {GENRE_PILLS.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={styles.genrePill}
                onPress={() => handleGenrePress(g.name)}
                activeOpacity={0.75}
              >
                <Text style={styles.genrePillText}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Text style={styles.sectionTitle}>Recent</Text>
                <TouchableOpacity onPress={clearRecentSearches}>
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {recentSearches.slice(0, 8).map((q, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.recentItem}
                  onPress={() => { setQuery(q); setActiveQuery(q); }}
                >
                  <Text style={styles.recentIcon}>🕐</Text>
                  <Text style={styles.recentText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ) : isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={results ?? []}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          renderItem={({ item }) => <SearchResultItem item={item} />}
          contentContainerStyle={styles.resultsList}
          ListEmptyComponent={
            <Text style={styles.empty}>No results for "{activeQuery}"</Text>
          }
          showsVerticalScrollIndicator={false}
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
    paddingBottom: Spacing.md,
  },
  title: {
    ...Typography.hero,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  searchBarWrapper: {},
  discover: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  genrePill: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  genrePillText: {
    ...Typography.body,
    color: Colors.text,
  },
  recentSection: {
    marginTop: Spacing.sm,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  clearText: {
    ...Typography.caption,
    color: Colors.primary,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recentIcon: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  recentText: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  resultsList: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  resultItem: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  resultPoster: {
    width: 60,
    height: 90,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surfaceElevated,
  },
  resultAvatar: {
    height: 60,
    borderRadius: 30,
  },
  resultInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  resultTitle: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    marginBottom: 4,
  },
  resultType: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  resultRating: {
    ...Typography.caption,
    color: Colors.accent,
  },
  resultOverview: {
    ...Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  empty: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
});
