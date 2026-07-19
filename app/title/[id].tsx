import React from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography } from '../../constants/theme';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import DetailHero from '../../components/detail/DetailHero';
import CastList from '../../components/detail/CastList';
import EpisodeList from '../../components/detail/EpisodeList';
import ContentRow from '../../components/home/ContentRow';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useManualWatchedStore } from '../../store/manualWatchedStore';
import { useAuthStore } from '../../store/authStore';
import { useFollowStore } from '../../store/followStore';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import {
  requestNotificationPermission,
  setupNotificationChannel,
  scheduleFollowNotification,
  cancelFollowNotification,
} from '../../lib/notifications';
import type { ContentItem, TMDBMovieDetail, TMDBTVDetail } from '../../types';

type DetailData = TMDBMovieDetail | TMDBTVDetail;

export default function TitleDetailScreen() {
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>();
  const router = useRouter();
  const numId = Number(id);
  const mediaType = type === 'tv' ? 'tv' : 'movie';

  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlistStore();
  const userId = useAuthStore((s) => s.user?.id);
  const inWatchlist = isInWatchlist(numId, mediaType);

  const { follow, unfollow, isFollowed, isUnfollowed } = useFollowStore();
  const traktWatched = useTraktWatched();
  const traktHasWatched = traktWatched.isWatched(numId, mediaType);
  // Auto-tick if in Trakt history (unless explicitly unfollowed); or explicitly followed
  const followActive = (traktHasWatched && !isUnfollowed(numId)) || isFollowed(numId);

  const { markWatched, unmarkWatched, isManuallyWatched } = useManualWatchedStore();
  const manuallyWatched = isManuallyWatched(numId, mediaType);
  // Trakt history is authoritative when present; the manual mark only matters
  // for titles Trakt has no record of.
  const isWatched = traktHasWatched || manuallyWatched;

  const { data: detail, isLoading, error } = useQuery<DetailData>({
    queryKey: ['title-detail', numId, mediaType],
    queryFn: (): Promise<DetailData> =>
      mediaType === 'movie'
        ? tmdbApi.getMovieDetail(numId)
        : tmdbApi.getTVDetail(numId),
    enabled: !!numId,
  });

  const handleWatchlistToggle = async () => {
    if (!detail) return;
    const title = 'title' in detail ? (detail as TMDBMovieDetail).title : (detail as TMDBTVDetail).name;
    if (inWatchlist) {
      removeFromWatchlist(numId, mediaType, userId);
    } else {
      addToWatchlist({
        tmdb_id: numId,
        media_type: mediaType,
        title,
        poster_path: detail.poster_path,
      }, userId);
    }
  };

  const handleWatchedToggle = async () => {
    if (!detail) return;
    // Trakt already has this one — the manual mark has nothing to toggle off.
    if (traktHasWatched) return;
    const title = 'title' in detail ? (detail as TMDBMovieDetail).title : (detail as TMDBTVDetail).name;
    if (manuallyWatched) {
      unmarkWatched(numId, mediaType, userId);
    } else {
      markWatched({
        tmdb_id: numId,
        media_type: mediaType,
        title,
        poster_path: detail.poster_path,
      }, userId);
    }
  };

  function getNextAirDate(d: DetailData): string | null {
    if ('title' in d) {
      const movie = d as TMDBMovieDetail;
      const rd = movie.release_date;
      return rd && new Date(rd) > new Date() ? rd : null;
    }
    const tv = d as TMDBTVDetail;
    return tv.next_episode_to_air?.air_date ?? null;
  }

  const handleFollowToggle = async () => {
    if (!detail) return;
    if (followActive) {
      unfollow(numId);
      await cancelFollowNotification(numId);
    } else {
      follow(numId);
      // Only schedule TMDB-based notification for shows not already in Trakt calendar
      if (!traktHasWatched) {
        const airDate = getNextAirDate(detail);
        if (airDate) {
          const title = 'title' in detail
            ? (detail as TMDBMovieDetail).title
            : (detail as TMDBTVDetail).name;
          const granted = await requestNotificationPermission();
          if (granted) {
            await setupNotificationChannel();
            await scheduleFollowNotification(numId, title, mediaType, airDate);
          }
        }
      }
    }
  };

  const detailAny = detail as any;

  const similar: ContentItem[] = (detailAny?.similar?.results ?? [])
    .slice(0, 12)
    .map((item: any) =>
      mediaType === 'movie' ? normalizeMovie(item) : normalizeTVShow(item)
    );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !detail) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>Failed to load title.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} bounces>
        {/* Back button */}
        <TouchableOpacity style={styles.backOverlay} onPress={() => router.back()}>
          <Text style={styles.backOverlayText}>←</Text>
        </TouchableOpacity>

        <DetailHero
          detail={detail}
          mediaType={mediaType}
          onWatchlistToggle={handleWatchlistToggle}
          isInWatchlist={inWatchlist}
          isFollowed={followActive}
          onFollowToggle={handleFollowToggle}
          showFollow={mediaType === 'tv' || !!getNextAirDate(detail)}
          isWatched={isWatched}
          onWatchedToggle={handleWatchedToggle}
        />

        <CastList
          cast={detailAny.credits?.cast ?? []}
          crew={detailAny.credits?.crew ?? []}
        />

        {mediaType === 'tv' && (detailAny as TMDBTVDetail).seasons?.length > 0 && (
          <EpisodeList
            showId={numId}
            seasons={(detailAny as TMDBTVDetail).seasons}
            posterPath={detail.poster_path}
            imdbId={(detailAny as TMDBTVDetail).external_ids?.imdb_id}
            showName={(detailAny as TMDBTVDetail).name}
          />
        )}

        {similar.length > 0 && (
          <View style={{ marginTop: Spacing.sm }}>
            <ContentRow title="More Like This" items={similar} showRating />
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
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  errorText: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  backBtn: {
    marginTop: Spacing.md,
  },
  backText: {
    ...Typography.body,
    color: Colors.primary,
  },
  backOverlay: {
    position: 'absolute',
    top: 12,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backOverlayText: {
    color: Colors.text,
    fontSize: 20,
  },
});
