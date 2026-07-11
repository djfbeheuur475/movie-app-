import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import SearchBar from '../../components/search/SearchBar';
import { tmdbApi } from '../../lib/tmdb';
import { usePreferencesStore } from '../../store/preferencesStore';
import { getPosterUrl } from '../../lib/tmdb';
import type { TMDBSearchResult } from '../../types';

function SearchResultItem({ item }: { item: TMDBSearchResult }) {
  const router = useRouter();
  const isMedia = item.media_type === 'movie' || item.media_type === 'tv';
  const isPerson = item.media_type === 'person';
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
      <View style={styles.posterWrap}>
        <Image
          source={{ uri: getPosterUrl(poster ?? null, 'thumb') ?? '' }}
          style={[styles.resultPoster, isPerson && styles.resultAvatar]}
          contentFit="cover"
        />
        {isMedia && (
          <View style={[
            styles.typeBadge,
            item.media_type === 'movie' ? styles.typeBadgeMovie : styles.typeBadgeTV,
          ]}>
            <Text style={[
              styles.typeBadgeText,
              item.media_type === 'movie' ? styles.typeBadgeTextMovie : styles.typeBadgeTextTV,
            ]}>
              {item.media_type === 'movie' ? 'Movie' : 'TV'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>{title}</Text>
        <View style={styles.resultMeta}>
          {year ? <Text style={styles.resultYear}>{year}</Text> : null}
          {rating != null && rating > 0 && (
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onSubmit={handleSubmit}
          onClear={() => { setQuery(''); setActiveQuery(''); }}
        />
      </View>

      {!activeQuery ? (
        recentSearches.length > 0 ? (
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
                <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.recentText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null
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
  sectionTitle: {
    ...Typography.subheading,
    color: Colors.text,
  },
  recentSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
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
    borderWidth: 1,
    borderColor: Colors.border,
  },
  posterWrap: {
    position: 'relative',
  },
  resultPoster: {
    width: 72,
    height: 108,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surfaceElevated,
  },
  resultAvatar: {
    height: 72,
    borderRadius: 36,
  },
  typeBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  typeBadgeMovie: {
    backgroundColor: Colors.primary,
  },
  typeBadgeTV: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  typeBadgeTextMovie: {
    color: Colors.background,
  },
  typeBadgeTextTV: {
    color: Colors.text,
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
  resultYear: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  resultRating: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: '700',
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
