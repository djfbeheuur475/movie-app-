import React from 'react';
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
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, getProfileUrl, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import ContentRow from '../../components/home/ContentRow';
import type { ContentItem } from '../../types';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: person, isLoading } = useQuery({
    queryKey: ['person', id],
    queryFn: () => tmdbApi.getPersonDetail(Number(id)),
    enabled: !!id,
  });

  const movieCredits: ContentItem[] = (person?.movie_credits?.cast ?? [])
    .slice(0, 20)
    .map(normalizeMovie);

  const tvCredits: ContentItem[] = (person?.tv_credits?.cast ?? [])
    .slice(0, 20)
    .map(normalizeTVShow);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!person) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.hero}>
          <Image
            source={{ uri: getProfileUrl(person.profile_path, 'large') ?? '' }}
            style={styles.photo}
            contentFit="cover"
          />
          <View style={styles.heroInfo}>
            <Text style={styles.name}>{person.name}</Text>
            <Text style={styles.dept}>{person.known_for_department}</Text>
            {person.birthday && (
              <Text style={styles.meta}>Born {person.birthday}</Text>
            )}
            {person.deathday && (
              <Text style={styles.meta}>Died {person.deathday}</Text>
            )}
          </View>
        </View>

        {person.biography ? (
          <View style={styles.bio}>
            <Text style={styles.bioTitle}>Biography</Text>
            <Text style={styles.bioText}>{person.biography}</Text>
          </View>
        ) : null}

        {movieCredits.length > 0 && (
          <View style={{ marginTop: Spacing.xl }}>
            <ContentRow title="Movies" items={movieCredits} showRating />
          </View>
        )}

        {tvCredits.length > 0 && (
          <View style={{ marginTop: Spacing.sm }}>
            <ContentRow title="TV Shows" items={tvCredits} showRating />
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
    width: 120,
    height: 160,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  heroInfo: {
    flex: 1,
    paddingTop: Spacing.sm,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  dept: {
    ...Typography.body,
    color: Colors.primary,
    marginBottom: 8,
  },
  meta: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  bio: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
  bioTitle: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  bioText: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
});
