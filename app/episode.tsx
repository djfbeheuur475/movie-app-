import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../constants/theme';
import { tmdbApi, getStillUrl, getPosterUrl } from '../lib/tmdb';
import { useTraktWatched } from '../hooks/useTraktWatched';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STILL_HEIGHT = SCREEN_WIDTH * (9 / 16);

const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${MONTH[m - 1]} ${d}, ${y}`;
}

export default function EpisodeScreen() {
  const router = useRouter();
  const { showId, season, episode, imdbId, showName } = useLocalSearchParams<{
    showId: string;
    season: string;
    episode: string;
    imdbId: string;
    showName: string;
  }>();

  const numShowId = Number(showId);
  const numSeason = Number(season);
  const numEpisode = Number(episode);
  const decodedShowName = showName ? decodeURIComponent(showName) : '';

  const { data: ep, isLoading, error } = useQuery({
    queryKey: ['tv-episode', numShowId, numSeason, numEpisode],
    queryFn: () => tmdbApi.getTVEpisode(numShowId, numSeason, numEpisode),
    enabled: !!numShowId && !!numSeason && !!numEpisode,
    staleTime: 1000 * 60 * 60,
  });

  const epCode = `S${String(numSeason).padStart(2, '0')}E${String(numEpisode).padStart(2, '0')}`;
  const stillUrl = ep ? getStillUrl(ep.still_path) : null;
  const { isEpisodeWatched } = useTraktWatched();
  const watched = isEpisodeWatched(numShowId, numSeason, numEpisode);

  const openStremio = async () => {
    if (!imdbId) {
      Alert.alert('Not available', 'No IMDB ID found for this show.');
      return;
    }
    // Stremio deep link: stremio://detail/series/{imdbId}/{imdbId}:{season}:{episode}
    const videoId = `${imdbId}:${numSeason}:${numEpisode}`;
    const deepLink = `stremio://detail/series/${imdbId}/${videoId}`;

    const canOpen = await Linking.canOpenURL(deepLink);
    if (canOpen) {
      await Linking.openURL(deepLink);
    } else {
      // Fall back to Stremio web
      const webUrl = `https://web.strem.io/#/detail/series/${imdbId}/${videoId}`;
      const canOpenWeb = await Linking.canOpenURL(webUrl);
      if (canOpenWeb) {
        await Linking.openURL(webUrl);
      } else {
        Alert.alert(
          'Stremio not found',
          'Install Stremio to watch this episode, or visit web.strem.io.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView bounces showsVerticalScrollIndicator={false}>
        {/* Still image hero */}
        <View style={styles.heroContainer}>
          {stillUrl ? (
            <Image
              source={{ uri: stillUrl }}
              style={styles.still}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={[styles.still, styles.stillPlaceholder]}>
              {isLoading && <ActivityIndicator color={Colors.primary} />}
            </View>
          )}
          <LinearGradient
            colors={['transparent', Colors.background]}
            style={styles.heroGradient}
          />
        </View>

        {/* Back button — overlaid */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.content}>
          {isLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
          ) : error || !ep ? (
            <Text style={styles.errorText}>Failed to load episode.</Text>
          ) : (
            <>
              {/* Show name breadcrumb */}
              {decodedShowName ? (
                <Text style={styles.showName}>{decodedShowName}</Text>
              ) : null}

              {/* Episode code + rating */}
              <View style={styles.metaRow}>
                <Text style={styles.epCode}>{epCode}</Text>
                {ep.vote_average > 0 && (
                  <View style={styles.ratingPill}>
                    <Text style={styles.ratingStar}>★</Text>
                    <Text style={styles.ratingVal}>{ep.vote_average.toFixed(1)}</Text>
                  </View>
                )}
                {watched && (
                  <View style={styles.watchedPill}>
                    <Ionicons name="checkmark" size={11} color="#fff" />
                    <Text style={styles.watchedText}>Watched</Text>
                  </View>
                )}
              </View>

              {/* Episode name */}
              <Text style={styles.epName}>{ep.name ?? `Episode ${numEpisode}`}</Text>

              {/* Air date + runtime */}
              <View style={styles.subMeta}>
                {ep.air_date ? (
                  <Text style={styles.subMetaText}>{formatDate(ep.air_date)}</Text>
                ) : null}
                {ep.air_date && ep.runtime ? (
                  <Text style={styles.dot}>·</Text>
                ) : null}
                {ep.runtime ? (
                  <Text style={styles.subMetaText}>{ep.runtime} min</Text>
                ) : null}
              </View>

              {/* Overview */}
              {ep.overview ? (
                <Text style={styles.overview}>{ep.overview}</Text>
              ) : null}

              {/* Guest stars */}
              {ep.guest_stars?.length > 0 && (
                <View style={styles.guestSection}>
                  <Text style={styles.sectionLabel}>GUEST STARS</Text>
                  <Text style={styles.guestNames}>
                    {ep.guest_stars.slice(0, 6).map((g) => g.name).join(', ')}
                  </Text>
                </View>
              )}

              {/* Watch on Stremio */}
              <TouchableOpacity
                style={styles.stremioBtn}
                onPress={openStremio}
                activeOpacity={0.85}
              >
                <View style={styles.stremioBtnInner}>
                  <Text style={styles.stremioPlay}>▶</Text>
                  <View>
                    <Text style={styles.stremioBtnLabel}>Watch on Stremio</Text>
                    <Text style={styles.stremioBtnSub}>{epCode} — {ep.name ?? `Episode ${numEpisode}`}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Hero
  heroContainer: {
    width: SCREEN_WIDTH,
    height: STILL_HEIGHT,
    backgroundColor: Colors.surfaceElevated,
  },
  still: {
    width: '100%',
    height: '100%',
  },
  stillPlaceholder: {
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: STILL_HEIGHT * 0.5,
  },

  // Back button
  backBtn: {
    position: 'absolute',
    top: 48,
    left: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.65)',
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

  // Content
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  showName: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  epCode: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
  },
  ratingStar: {
    fontSize: 10,
    color: Colors.primary,
  },
  ratingVal: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  watchedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#7B5CE4',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  watchedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  epName: {
    ...Typography.title,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  subMetaText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '400',
  },
  dot: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  overview: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },

  // Guest stars
  guestSection: {
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  guestNames: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Stremio button
  stremioBtn: {
    borderRadius: BorderRadius.lg,
    backgroundColor: '#7B5CE4',
    marginBottom: Spacing.md,
    ...Shadow.md,
  },
  stremioBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 16,
    paddingHorizontal: Spacing.lg,
  },
  stremioPlay: {
    fontSize: 22,
    color: '#fff',
  },
  stremioBtnLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  stremioBtnSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  errorText: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: Spacing.xl,
    textAlign: 'center',
  },
});
