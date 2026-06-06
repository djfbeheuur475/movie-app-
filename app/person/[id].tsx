import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, getProfileUrl, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import ContentRow from '../../components/home/ContentRow';
import type { ContentItem } from '../../types';

type Tab = 'movies' | 'tv' | 'bio';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('movies');

  const { data: person, isLoading } = useQuery({
    queryKey: ['person', id],
    queryFn: () => tmdbApi.getPersonDetail(Number(id)),
    enabled: !!id,
  });

  const movieCredits: ContentItem[] = (person?.movie_credits?.cast ?? [])
    .filter((m) => m.release_date)
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    .slice(0, 30)
    .map(normalizeMovie);

  const tvCredits: ContentItem[] = (person?.tv_credits?.cast ?? [])
    .filter((s) => s.first_air_date)
    .sort((a, b) => (b.first_air_date ?? '').localeCompare(a.first_air_date ?? ''))
    .slice(0, 30)
    .map(normalizeTVShow);

  const knownFor: ContentItem[] = [...movieCredits, ...tvCredits]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!person) return null;

  const age = person.birthday
    ? Math.floor(
        (new Date(person.deathday ?? Date.now()).getTime() - new Date(person.birthday).getTime()) /
          (1000 * 60 * 60 * 24 * 365.25)
      )
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Hero */}
        <View style={styles.hero}>
          <Image
            source={{ uri: getProfileUrl(person.profile_path, 'large') ?? '' }}
            style={styles.photo}
            contentFit="cover"
          />
          <View style={styles.heroInfo}>
            <Text style={styles.name}>{person.name}</Text>
            <View style={styles.deptBadge}>
              <Text style={styles.deptText}>{person.known_for_department}</Text>
            </View>
            <View style={styles.metaRows}>
              {person.birthday && (
                <Text style={styles.meta}>
                  🎂 {person.birthday}
                  {age !== null && !person.deathday ? ` (${age})` : ''}
                </Text>
              )}
              {person.deathday && (
                <Text style={styles.meta}>✝ {person.deathday}{age !== null ? ` (aged ${age})` : ''}</Text>
              )}
            </View>
            {/* Quick stats */}
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{movieCredits.length}</Text>
                <Text style={styles.statLabel}>Movies</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{tvCredits.length}</Text>
                <Text style={styles.statLabel}>TV Shows</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{person.popularity.toFixed(0)}</Text>
                <Text style={styles.statLabel}>Popularity</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Known For quick row */}
        {knownFor.length > 0 && (
          <View style={{ marginTop: Spacing.xl }}>
            <ContentRow title="Known For" items={knownFor} showRating cardWidth={110} />
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          {(['movies', 'tv', 'bio'] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'movies' ? `Movies (${movieCredits.length})` : tab === 'tv' ? `TV (${tvCredits.length})` : 'Bio'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'movies' && (
          movieCredits.length > 0
            ? <View style={{ marginTop: Spacing.sm }}>
                <ContentRow title="" items={movieCredits} showRating cardWidth={120} />
              </View>
            : <Text style={styles.emptyTab}>No movie credits found.</Text>
        )}

        {activeTab === 'tv' && (
          tvCredits.length > 0
            ? <View style={{ marginTop: Spacing.sm }}>
                <ContentRow title="" items={tvCredits} showRating cardWidth={120} />
              </View>
            : <Text style={styles.emptyTab}>No TV credits found.</Text>
        )}

        {activeTab === 'bio' && (
          <View style={styles.bioSection}>
            {person.biography ? (
              <Text style={styles.bioText}>{person.biography}</Text>
            ) : (
              <Text style={styles.emptyTab}>No biography available.</Text>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backText: {
    ...Typography.body,
    color: Colors.primary,
  },
  hero: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  photo: {
    width: 110,
    height: 155,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surfaceElevated,
    ...Shadow.md,
  },
  heroInfo: {
    flex: 1,
    paddingTop: Spacing.xs,
    gap: Spacing.sm,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  deptBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '22',
    borderWidth: 1,
    borderColor: Colors.primary + '60',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  deptText: {
    ...Typography.label,
    color: Colors.primary,
  },
  metaRows: {
    gap: 3,
  },
  meta: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: {
    ...Typography.subheading,
    color: Colors.text,
  },
  statLabel: {
    ...Typography.label,
    color: Colors.textMuted,
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  tabTextActive: {
    color: Colors.text,
  },
  emptyTab: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  bioSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  bioText: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
});
