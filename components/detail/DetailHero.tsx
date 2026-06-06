import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getBackdropUrl, getPosterUrl } from '../../lib/tmdb';
import type { TMDBMovieDetail, TMDBTVDetail, Provider } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BACKDROP_HEIGHT = 280;

type DetailType = TMDBMovieDetail | TMDBTVDetail;

function isMovie(d: DetailType): d is TMDBMovieDetail {
  return 'title' in d;
}

interface Props {
  detail: DetailType;
  mediaType: 'movie' | 'tv';
  aiExplanation?: string;
  onWatchlistToggle?: () => void;
  isInWatchlist?: boolean;
}

export default function DetailHero({
  detail,
  mediaType,
  aiExplanation,
  onWatchlistToggle,
  isInWatchlist,
}: Props) {
  const title = isMovie(detail) ? detail.title : (detail as TMDBTVDetail).name;
  const releaseDate = isMovie(detail) ? detail.release_date : (detail as TMDBTVDetail).first_air_date;
  const runtime = isMovie(detail)
    ? detail.runtime
      ? `${Math.floor(detail.runtime / 60)}h ${detail.runtime % 60}m`
      : null
    : null;

  const backdropUrl = getBackdropUrl(detail.backdrop_path, 'large');
  const posterUrl = getPosterUrl(detail.poster_path, 'large');

  const providers = detail['watch/providers']?.results?.US;
  const streamingProviders = providers?.flatrate ?? [];

  const openStremio = () => {
    const imdbId = isMovie(detail) ? detail.imdb_id : null;
    const url = imdbId
      ? `stremio:///detail/movie/${imdbId}`
      : `stremio:///`;
    Linking.openURL(url).catch(() => {
      Linking.openURL('https://www.stremio.com');
    });
  };

  const trailer = detail.videos?.results?.find(
    (v) => v.type === 'Trailer' && v.site === 'YouTube'
  );

  const openTrailer = () => {
    if (trailer) {
      Linking.openURL(`https://www.youtube.com/watch?v=${trailer.key}`);
    }
  };

  return (
    <View>
      {/* Backdrop */}
      <View style={styles.backdropContainer}>
        <Image
          source={{ uri: backdropUrl ?? posterUrl ?? '' }}
          style={styles.backdrop}
          contentFit="cover"
          transition={400}
        />
        <LinearGradient
          colors={['transparent', Colors.background]}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Poster + Meta */}
      <View style={styles.metaRow}>
        <Image
          source={{ uri: posterUrl ?? '' }}
          style={styles.poster}
          contentFit="cover"
        />
        <View style={styles.metaInfo}>
          <Text style={styles.title}>{title}</Text>
          {detail.tagline ? <Text style={styles.tagline}>"{detail.tagline}"</Text> : null}
          <View style={styles.badges}>
            <Text style={styles.badge}>{releaseDate?.slice(0, 4)}</Text>
            {runtime && <Text style={styles.badge}>{runtime}</Text>}
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>★ {detail.vote_average?.toFixed(1)}</Text>
            </View>
          </View>
          <View style={styles.genres}>
            {detail.genres?.slice(0, 3).map((g) => (
              <View key={g.id} style={styles.genrePill}>
                <Text style={styles.genreText}>{g.name}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {trailer && (
          <TouchableOpacity style={styles.trailerBtn} onPress={openTrailer} activeOpacity={0.8}>
            <Text style={styles.trailerBtnText}>▶ Trailer</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.watchlistBtn, isInWatchlist && styles.watchlistBtnActive]}
          onPress={onWatchlistToggle}
          activeOpacity={0.8}
        >
          <Text style={styles.watchlistBtnText}>
            {isInWatchlist ? '✓ Saved' : '+ Watchlist'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.stremioBtn} onPress={openStremio} activeOpacity={0.8}>
          <Text style={styles.stremioBtnText}>⚡ Watch in Stremio</Text>
        </TouchableOpacity>
      </View>

      {/* Overview */}
      {detail.overview && (
        <View style={styles.section}>
          <Text style={styles.overview}>{detail.overview}</Text>
        </View>
      )}

      {/* AI Explanation */}
      {aiExplanation && (
        <View style={styles.aiCard}>
          <Text style={styles.aiLabel}>✦ Why you'll love this</Text>
          <Text style={styles.aiText}>{aiExplanation}</Text>
        </View>
      )}

      {/* Streaming Providers */}
      {streamingProviders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Where to Watch</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerRow}>
            {streamingProviders.map((p: Provider) => (
              <View key={p.provider_id} style={styles.providerItem}>
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w92${p.logo_path}` }}
                  style={styles.providerLogo}
                  contentFit="contain"
                />
                <Text style={styles.providerName} numberOfLines={1}>{p.provider_name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdropContainer: {
    height: BACKDROP_HEIGHT,
    width: SCREEN_WIDTH,
  },
  backdrop: {
    width: '100%',
    height: '100%',
  },
  metaRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    marginTop: -60,
    gap: Spacing.md,
  },
  poster: {
    width: 100,
    height: 150,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  metaInfo: {
    flex: 1,
    paddingTop: 70,
    justifyContent: 'flex-end',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  tagline: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  badge: {
    ...Typography.caption,
    color: Colors.textSecondary,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  ratingBadge: {
    backgroundColor: Colors.accent + '22',
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  ratingText: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: '700',
  },
  genres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  genrePill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  genreText: {
    ...Typography.label,
    color: Colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  trailerBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    flex: 1,
    alignItems: 'center',
  },
  trailerBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
  watchlistBtn: {
    backgroundColor: Colors.surfaceElevated,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  watchlistBtnActive: {
    borderColor: Colors.success,
    backgroundColor: Colors.success + '22',
  },
  watchlistBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
  stremioBtn: {
    backgroundColor: '#7b2d8b',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    width: '100%',
  },
  stremioBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
  section: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  overview: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  aiCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  aiLabel: {
    ...Typography.label,
    color: Colors.primary,
    marginBottom: 4,
  },
  aiText: {
    ...Typography.body,
    color: Colors.text,
    lineHeight: 20,
  },
  providerRow: {
    marginTop: Spacing.sm,
  },
  providerItem: {
    alignItems: 'center',
    marginRight: Spacing.md,
    width: 64,
  },
  providerLogo: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  providerName: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
});
