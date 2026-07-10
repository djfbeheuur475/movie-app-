import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { hasGoodMetadata } from '../../lib/quality';
import ContentRow from '../../components/home/ContentRow';
import IndiePicksRow from '../../components/discover/IndiePicksRow';
import type { ContentItem } from '../../types';

type MediaTab = 'movies' | 'shows';

type PageResult = { items: ContentItem[]; nextPage: number | null };

// ─── Infinite row component ────────────────────────────────────────────────────

function InfiniteRow({
  title,
  subtitle,
  queryKey,
  fetchPage,
}: {
  title: string;
  subtitle?: string;
  queryKey: (string | number)[];
  fetchPage: (page: number) => Promise<PageResult>;
}) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam }) => fetchPage(pageParam as number),
      initialPageParam: 1,
      getNextPageParam: (last) => last.nextPage ?? undefined,
      staleTime: 1000 * 60 * 30,
    });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ContentRow
      title={title}
      subtitle={subtitle}
      items={items}
      isLoading={isLoading}
      isLoadingMore={isFetchingNextPage}
      onEndReached={hasNextPage ? () => fetchNextPage() : undefined}
      showRating
    />
  );
}

// ─── Fetch helpers (defined outside component to keep references stable) ──────

async function fetchMovieTrending(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getTrendingPage('movie', 'week', page);
  const items = (results as any[]).map(normalizeMovie).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}

async function fetchTVTrending(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getTrendingPage('tv', 'week', page);
  const items = (results as any[]).map(normalizeTVShow).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}


async function fetchMovieNewReleases(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getNowPlayingPage(page);
  const items = results.map(normalizeMovie).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}

async function fetchTVNewEpisodes(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getAiringTodayPage(page);
  const items = results.map(normalizeTVShow).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}

async function fetchMovieHiddenGems(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getHiddenGems('movie', page);
  const items = (results as any[]).map(normalizeMovie).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}

async function fetchTVHiddenGems(page: number): Promise<PageResult> {
  const { results, total_pages } = await tmdbApi.getHiddenGems('tv', page);
  const items = (results as any[]).map(normalizeTVShow).filter(hasGoodMetadata);
  return { items, nextPage: page < total_pages ? page + 1 : null };
}

function makeGenreFetcher(type: 'movie' | 'tv', genreId: number) {
  return async (page: number): Promise<PageResult> => {
    const { results, total_pages } = await tmdbApi.getByGenre(type, genreId, page);
    const items = (results as any[])
      .map(type === 'movie' ? normalizeMovie : normalizeTVShow)
      .filter(hasGoodMetadata);
    return { items, nextPage: page < total_pages ? page + 1 : null };
  };
}

// ─── Genre row configs ─────────────────────────────────────────────────────────

const MOVIE_GENRES = [
  { id: 28, name: 'Action & Adrenaline', subtitle: 'High-octane thrills' },
  { id: 878, name: 'Mind-Bending Sci-Fi', subtitle: 'Ideas that challenge reality' },
  { id: 53, name: 'Gripping Thrillers', subtitle: 'Edge-of-your-seat tension' },
  { id: 35, name: 'Feel-Good Comedies', subtitle: 'Easy laughs and warm stories' },
  { id: 18, name: 'Acclaimed Drama', subtitle: 'Character-driven masterpieces' },
  { id: 27, name: 'Best Horror', subtitle: 'Scary done right' },
];

const TV_GENRES = [
  { id: 18, name: 'Prestige Drama', subtitle: 'Critically acclaimed storytelling' },
  { id: 80, name: 'Crime & Thriller', subtitle: 'Dark, gripping investigations' },
  { id: 10765, name: 'Sci-Fi & Fantasy', subtitle: 'Worlds beyond imagination' },
  { id: 35, name: 'Comedy Series', subtitle: 'Consistently funny and warm' },
  { id: 9648, name: 'Mystery', subtitle: 'Puzzles worth solving' },
  { id: 99, name: 'Documentary', subtitle: 'Real stories worth telling' },
  { id: 10759, name: 'Action & Adventure', subtitle: 'High-stakes, high-energy series' },
  { id: 16, name: 'Animation', subtitle: 'From prestige anime to adult cartoons' },
  { id: 10768, name: 'War & Politics', subtitle: 'Power, conflict, and consequence' },
];

// ─── Genre row components (one per genre to satisfy hooks rules) ───────────────

function MovieGenreRow({ id, name, subtitle }: { id: number; name: string; subtitle: string }) {
  return (
    <InfiniteRow
      title={name}
      subtitle={subtitle}
      queryKey={['discover-movie-genre', id]}
      fetchPage={makeGenreFetcher('movie', id)}
    />
  );
}

function TVGenreRow({ id, name, subtitle }: { id: number; name: string; subtitle: string }) {
  return (
    <InfiniteRow
      title={name}
      subtitle={subtitle}
      queryKey={['discover-tv-genre', id]}
      fetchPage={makeGenreFetcher('tv', id)}
    />
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const [media, setMedia] = useState<MediaTab>('movies');
  const handleMediaChange = useCallback((m: MediaTab) => setMedia(m), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      <View style={styles.mediaToggle}>
        <TouchableOpacity
          style={[styles.mediaBtn, media === 'movies' && styles.mediaBtnActive]}
          onPress={() => handleMediaChange('movies')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="film-outline"
            size={16}
            color={media === 'movies' ? Colors.background : Colors.textSecondary}
          />
          <Text style={[styles.mediaBtnText, media === 'movies' && styles.mediaBtnTextActive]}>
            Movies
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.mediaBtn, media === 'shows' && styles.mediaBtnActive]}
          onPress={() => handleMediaChange('shows')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="tv-outline"
            size={16}
            color={media === 'shows' ? Colors.background : Colors.textSecondary}
          />
          <Text style={[styles.mediaBtnText, media === 'shows' && styles.mediaBtnTextActive]}>
            TV Shows
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {media === 'movies' ? (
          <>
            <InfiniteRow
              title="Trending This Week"
              subtitle="What everyone is watching right now"
              queryKey={['discover-trending-movies']}
              fetchPage={fetchMovieTrending}
            />
            <IndiePicksRow variant="recent" />
            <IndiePicksRow variant="classic" />
            <InfiniteRow
              title="New in Cinemas"
              subtitle="Fresh releases worth seeing now"
              queryKey={['discover-now-playing']}
              fetchPage={fetchMovieNewReleases}
            />
            <InfiniteRow
              title="Hidden Gems"
              subtitle="Beloved by those who found them"
              queryKey={['discover-hidden-gems-movies']}
              fetchPage={fetchMovieHiddenGems}
            />
            {MOVIE_GENRES.map((g) => (
              <MovieGenreRow key={g.id} {...g} />
            ))}
          </>
        ) : (
          <>
            <InfiniteRow
              title="Trending This Week"
              subtitle="What everyone is watching right now"
              queryKey={['discover-trending-tv']}
              fetchPage={fetchTVTrending}
            />
            <IndiePicksRow mediaType="tv" variant="recent" />
            <IndiePicksRow mediaType="tv" variant="classic" />
            <InfiniteRow
              title="New Episodes Airing"
              subtitle="Fresh episodes dropping this week"
              queryKey={['discover-airing-today']}
              fetchPage={fetchTVNewEpisodes}
            />
            <InfiniteRow
              title="Hidden Gems"
              subtitle="Underrated series that deserve your attention"
              queryKey={['discover-hidden-gems-tv']}
              fetchPage={fetchTVHiddenGems}
            />
            {TV_GENRES.map((g) => (
              <TVGenreRow key={g.id} {...g} />
            ))}
          </>
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
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
    marginBottom: Spacing.md,
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
  mediaBtnText: { ...Typography.subheading, color: Colors.textMuted },
  mediaBtnTextActive: { color: Colors.background },
  scroll: { paddingTop: Spacing.sm },
  bottomPad: { height: 32 },
});
