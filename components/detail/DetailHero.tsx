import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Linking,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getBackdropUrl, getPosterUrl } from '../../lib/tmdb';
import type { TMDBMovieDetail, TMDBTVDetail } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BACKDROP_HEIGHT = 280;
// Width of one column in the 3-column button grid (matches row-1 button width exactly)
const ACTION_COL_WIDTH = (SCREEN_WIDTH - 2 * Spacing.lg - 2 * Spacing.sm) / 3;

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
  isFollowed?: boolean;
  onFollowToggle?: () => void;
  showFollow?: boolean;
}

export default function DetailHero({
  detail,
  mediaType,
  aiExplanation,
  onWatchlistToggle,
  isInWatchlist,
  isFollowed,
  onFollowToggle,
  showFollow = true,
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

  const openStremio = () => {
    let imdbId: string | null = null;
    let stremioType: 'movie' | 'series' = 'movie';

    if (isMovie(detail)) {
      imdbId = detail.imdb_id ?? null;
      stremioType = 'movie';
    } else {
      const tv = detail as TMDBTVDetail;
      imdbId = tv.external_ids?.imdb_id ?? null;
      stremioType = 'series';
    }

    // Deep-link directly into the title inside the Stremio app.
    // Falls back to the Stremio website if the app isn't installed.
    const url = imdbId
      ? `stremio:///detail/${stremioType}/${imdbId}`
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

  const handleShare = async () => {
    try {
      await Share.share({
        message: `You should watch ${title} 🎬 I found it on NextUp — the smartest way to decide what to watch next!`,
        title,
      });
    } catch {
      // user cancelled — no-op
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
        </View>
      </View>

      {/* Genres — full-width row below the poster+meta to avoid overlap */}
      {detail.genres && detail.genres.length > 0 && (
        <View style={styles.genresRow}>
          {detail.genres.slice(0, 4).map((g) => (
            <View key={g.id} style={styles.genrePill}>
              <Text style={styles.genreText}>{g.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {/* Row 1: Save | Follow | Share */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.iconBtn, isInWatchlist && styles.iconBtnActive]}
            onPress={onWatchlistToggle}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isInWatchlist ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={isInWatchlist ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.iconBtnLabel, isInWatchlist && styles.iconBtnLabelActive]}>
              {isInWatchlist ? 'Saved' : 'Save'}
            </Text>
          </TouchableOpacity>
          {showFollow && (
            <TouchableOpacity
              style={[styles.iconBtn, isFollowed && styles.iconBtnActive]}
              onPress={onFollowToggle}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isFollowed ? 'notifications' : 'notifications-outline'}
                size={20}
                color={isFollowed ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.iconBtnLabel, isFollowed && styles.iconBtnLabelActive]}>
                {isFollowed ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={handleShare} activeOpacity={0.8}>
            <Ionicons name="share-social-outline" size={20} color={Colors.textMuted} />
            <Text style={styles.iconBtnLabel}>Share</Text>
          </TouchableOpacity>
        </View>
        {/* Row 2: Trailer | Watch */}
        <View style={styles.buttonRow}>
          {trailer ? (
            <TouchableOpacity
              style={[
                styles.iconBtn,
                showFollow
                  ? { flex: 0, width: ACTION_COL_WIDTH }
                  : { flex: 1 },
              ]}
              onPress={openTrailer}
              activeOpacity={0.8}
            >
              <Ionicons name="play-circle-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.iconBtnLabel}>Trailer</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.stremioBtn, styles.stremioBtnFull]}
            onPress={openStremio}
            activeOpacity={0.8}
          >
            <View style={styles.stremioBtnInner}>
              <Image
                source={require('../../assets/stremio-logo.png')}
                style={styles.stremioLogo}
                contentFit="contain"
              />
              <Text style={styles.stremioBtnText}>Watch</Text>
            </View>
          </TouchableOpacity>
        </View>
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
    marginBottom: Spacing.xs,
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
    flexWrap: 'nowrap',
    overflow: 'hidden',
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
  genresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
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
    flexDirection: 'column',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  iconBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  iconBtnActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary + '55',
  },
  iconBtnLabel: {
    ...Typography.label,
    color: Colors.textMuted,
  },
  iconBtnLabelActive: {
    color: Colors.primary,
  },
  stremioBtn: {
    flex: 2,
    backgroundColor: '#7b2d8b',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  stremioBtnFull: {
    flex: 1,
  },
  stremioBtnInner: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  stremioLogo: {
    width: 20,
    height: 20,
  },
  stremioBtnText: {
    ...Typography.label,
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
});

