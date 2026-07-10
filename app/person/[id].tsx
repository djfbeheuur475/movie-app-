import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, getProfileUrl, getPosterUrl, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import WatchedBadge from '../../components/common/WatchedBadge';
import type { ContentItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = Math.round(SCREEN_WIDTH * 1.15);
const GRID_PADDING = Spacing.lg;
const GRID_GAP = 8;
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3);
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.5);

// ─── Small grid card ──────────────────────────────────────────────────────────

function FilmCard({ item }: { item: ContentItem }) {
  const router = useRouter();
  const { isWatched } = useTraktWatched();
  const posterUrl = getPosterUrl(item.posterPath, 'medium');
  const year = item.releaseDate?.slice(0, 4) ?? null;
  const watched = isWatched(item.id, item.mediaType);

  return (
    <TouchableOpacity
      style={styles.filmCard}
      onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
      activeOpacity={0.75}
    >
      <View style={styles.filmPoster}>
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={styles.filmPosterImg}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.filmPosterImg, styles.filmPosterFallback]}>
            <Text style={styles.fallbackChar}>{item.title?.charAt(0) ?? '?'}</Text>
          </View>
        )}
        {item.rating > 0 && (
          <View style={styles.filmRating}>
            <Text style={styles.filmRatingText}>★ {item.rating.toFixed(1)}</Text>
          </View>
        )}
        {watched && <WatchedBadge />}
      </View>
      <Text style={styles.filmTitle} numberOfLines={1}>{item.title}</Text>
      {year && <Text style={styles.filmYear}>{year}</Text>}
    </TouchableOpacity>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.countPill}>
        <Text style={styles.countText}>{count}</Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [bioExpanded, setBioExpanded] = useState(false);
  const insets = useSafeAreaInsets();

  const { data: person, isLoading } = useQuery({
    queryKey: ['person', id],
    queryFn: () => tmdbApi.getPersonDetail(Number(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (!person) return null;

  const movieCredits: ContentItem[] = (person.movie_credits?.cast ?? [])
    .filter((m) => m.release_date && m.poster_path)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, 30)
    .map(normalizeMovie);

  const tvCredits: ContentItem[] = (person.tv_credits?.cast ?? [])
    .filter((s) => s.first_air_date && s.poster_path)
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, 20)
    .map(normalizeTVShow);

  const knownFor: ContentItem[] = [...movieCredits, ...tvCredits]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 12);

  const age = person.birthday
    ? Math.floor(
        (new Date(person.deathday ?? Date.now()).getTime() -
          new Date(person.birthday).getTime()) /
          (1000 * 60 * 60 * 24 * 365.25)
      )
    : null;

  const heroUrl = getProfileUrl(person.profile_path, 'large');

  const bioLines = person.biography?.trim().split('\n').filter(Boolean) ?? [];
  const hasBio = bioLines.length > 0;

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} bounces>

        {/* ── Hero ── */}
        <View style={styles.heroContainer}>
          {heroUrl ? (
            <Image
              source={{ uri: heroUrl }}
              style={styles.heroImage}
              contentFit="cover"
              transition={400}
            />
          ) : (
            <View style={[styles.heroImage, styles.heroFallback]} />
          )}

          {/* Full gradient from transparent at top to background at bottom */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)', Colors.background]}
            locations={[0.35, 0.7, 1]}
            style={styles.heroGradient}
          />

          {/* Back button */}
          <TouchableOpacity style={[styles.backBtn, { top: insets.top + 8 }]} onPress={() => router.back()}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          {/* Name + dept overlaid at bottom of hero */}
          <View style={styles.heroOverlay}>
            <Text style={styles.heroName}>{person.name}</Text>
            <View style={styles.heroBadgeRow}>
              <View style={styles.deptBadge}>
                <Text style={styles.deptText}>{person.known_for_department}</Text>
              </View>
              {age !== null && (
                <Text style={styles.heroAge}>
                  {person.deathday
                    ? `${person.birthday?.slice(0, 4)} – ${person.deathday.slice(0, 4)} (aged ${age})`
                    : `Born ${person.birthday ?? '—'}  ·  Age ${age}`}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* ── Stats pills ── */}
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{movieCredits.length}</Text>
            <Text style={styles.statLabel}>Movies</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{tvCredits.length}</Text>
            <Text style={styles.statLabel}>TV Shows</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statPill}>
            <Text style={styles.statNum}>{person.popularity.toFixed(0)}</Text>
            <Text style={styles.statLabel}>Popularity</Text>
          </View>
        </View>

        {/* ── Bio ── */}
        {hasBio && (
          <View style={styles.bioSection}>
            <Text
              style={styles.bioText}
              numberOfLines={bioExpanded ? undefined : 4}
            >
              {bioLines.join('\n\n')}
            </Text>
            <TouchableOpacity
              onPress={() => setBioExpanded((v) => !v)}
              activeOpacity={0.7}
              style={styles.bioToggle}
            >
              <Text style={styles.bioToggleText}>
                {bioExpanded ? 'Show less' : 'Read more'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Known For ── */}
        {knownFor.length > 0 && (
          <View style={styles.knownForSection}>
            <Text style={styles.sectionTitle2}>Known For</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.knownForList}
            >
              {knownFor.map((item) => (
                <TouchableOpacity
                  key={`kf-${item.id}`}
                  style={styles.knownForCard}
                  onPress={() => router.push(`/title/${item.id}?type=${item.mediaType}`)}
                  activeOpacity={0.75}
                >
                  <View style={styles.knownForPoster}>
                    {getPosterUrl(item.posterPath, 'medium') ? (
                      <Image
                        source={{ uri: getPosterUrl(item.posterPath, 'medium')! }}
                        style={styles.knownForImg}
                        contentFit="cover"
                        transition={200}
                      />
                    ) : (
                      <View style={[styles.knownForImg, styles.filmPosterFallback]} />
                    )}
                  </View>
                  <Text style={styles.knownForTitle} numberOfLines={2}>{item.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Movies grid ── */}
        {movieCredits.length > 0 && (
          <View style={styles.gridSection}>
            <SectionHeader title="Movies" count={movieCredits.length} />
            <View style={styles.grid}>
              {movieCredits.map((item) => (
                <FilmCard key={`m-${item.id}`} item={item} />
              ))}
            </View>
          </View>
        )}

        {/* ── TV Shows grid ── */}
        {tvCredits.length > 0 && (
          <View style={styles.gridSection}>
            <SectionHeader title="TV Shows" count={tvCredits.length} />
            <View style={styles.grid}>
              {tvCredits.map((item) => (
                <FilmCard key={`tv-${item.id}`} item={item} />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: Math.max(insets.bottom, 48) }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero
  heroContainer: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    backgroundColor: Colors.surfaceElevated,
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.65,
  },
  backBtn: {
    position: 'absolute',
    left: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.55)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backText: {
    color: Colors.text,
    fontSize: 20,
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: 8,
  },
  heroName: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  deptBadge: {
    backgroundColor: Colors.primary + '33',
    borderWidth: 1,
    borderColor: Colors.primary + '70',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deptText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  heroAge: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '400',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNum: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },

  // Bio
  bioSection: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
  },
  bioText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  bioToggle: {
    marginTop: Spacing.sm,
  },
  bioToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },

  // Known For
  knownForSection: {
    marginTop: Spacing.xl,
  },
  sectionTitle2: {
    ...Typography.heading,
    color: Colors.text,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  knownForList: {
    paddingHorizontal: Spacing.lg,
    gap: 10,
  },
  knownForCard: {
    width: 100,
  },
  knownForPoster: {
    width: 100,
    height: 150,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    marginBottom: 6,
    ...Shadow.sm,
  },
  knownForImg: {
    width: '100%',
    height: '100%',
  },
  knownForTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 15,
  },

  // Grid section
  gridSection: {
    marginTop: Spacing.xl,
    paddingHorizontal: GRID_PADDING,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.heading,
    color: Colors.text,
  },
  countPill: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  // Film card (grid item)
  filmCard: {
    width: CARD_WIDTH,
  },
  filmPoster: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    marginBottom: 5,
    ...Shadow.sm,
  },
  filmPosterImg: {
    width: '100%',
    height: '100%',
  },
  filmPosterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  fallbackChar: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  filmRating: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '70',
  },
  filmRatingText: {
    fontSize: 8,
    fontWeight: '700',
    color: Colors.primary,
  },
  filmTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 13,
  },
  filmYear: {
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
