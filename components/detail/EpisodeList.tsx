import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { tmdbApi, getPosterUrl, getStillUrl } from '../../lib/tmdb';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import WatchedBadge from '../common/WatchedBadge';
import type { Season } from '../../types';

interface Props {
  showId: number;
  seasons: Season[];
  posterPath: string | null;
  imdbId?: string | null;
  showName?: string;
}

const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTH[m - 1]} ${d}`;
}

export default function EpisodeList({ showId, seasons, posterPath, imdbId, showName }: Props) {
  const router = useRouter();
  const { isEpisodeWatched, watchedInSeason } = useTraktWatched();
  const watchableSeasons = seasons.filter((s) => s.season_number > 0);
  const [selectedSeason, setSelectedSeason] = useState(
    watchableSeasons[0]?.season_number ?? 1
  );

  const { data, isLoading } = useQuery({
    queryKey: ['tv-season', showId, selectedSeason],
    queryFn: () => tmdbApi.getTVSeason(showId, selectedSeason),
    staleTime: 1000 * 60 * 60,
  });

  const episodes = data?.episodes ?? [];
  const fallbackPoster = getPosterUrl(posterPath, 'thumb');
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Episodes</Text>

      {/* Season selector */}
      {watchableSeasons.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.seasonRow}
        >
          {watchableSeasons.map((s) => {
            const active = s.season_number === selectedSeason;
            const watched = watchedInSeason(showId, s.season_number);
            const total = s.episode_count ?? 0;
            const pct = total > 0 ? Math.min(watched / total, 1) : 0;
            const hasProgress = pct > 0;

            return (
              <TouchableOpacity
                key={s.season_number}
                style={[styles.seasonChip, active && styles.seasonChipActive]}
                onPress={() => setSelectedSeason(s.season_number)}
                activeOpacity={0.75}
              >
                <Text style={[styles.seasonChipText, active && styles.seasonChipTextActive]}>
                  {s.name ?? `Season ${s.season_number}`}
                </Text>
                {hasProgress && (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${pct * 100}%` as any },
                        active && styles.progressFillActive,
                      ]}
                    />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Episode list */}
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        <View style={styles.episodeList}>
          {episodes.map((ep) => {
            const stillUrl = getStillUrl(ep.still_path) ?? fallbackPoster;
            const epCode = `S${String(ep.season_number).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`;
            const airDate = formatDate(ep.air_date);
            const runtime = ep.runtime ? `${ep.runtime}m` : null;
            const isUnaired = !!ep.air_date && ep.air_date > todayStr;

            return (
              <TouchableOpacity
                key={ep.id}
                style={[styles.episodeCard, isUnaired && styles.episodeCardUnaired]}
                activeOpacity={0.7}
                onPress={() =>
                  router.push(
                    `/episode?showId=${showId}&season=${ep.season_number}&episode=${ep.episode_number}&imdbId=${imdbId ?? ''}&showName=${encodeURIComponent(showName ?? '')}`
                  )
                }
              >
                {/* Thumbnail */}
                <View style={styles.still}>
                  {stillUrl ? (
                    <Image
                      source={{ uri: stillUrl }}
                      style={styles.stillImg}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <View style={styles.stillPlaceholder} />
                  )}
                  {ep.vote_average > 0 && (
                    <View style={styles.ratingBadge}>
                      <Text style={styles.ratingText}>★ {ep.vote_average.toFixed(1)}</Text>
                    </View>
                  )}
                  {isEpisodeWatched(showId, ep.season_number, ep.episode_number) && (
                    <WatchedBadge />
                  )}
                </View>

                {/* Info */}
                <View style={styles.info}>
                  <View style={styles.infoTop}>
                    <Text style={styles.epCode}>{epCode}</Text>
                    {runtime && <Text style={styles.runtime}>{runtime}</Text>}
                  </View>
                  <Text style={styles.epName} numberOfLines={2}>
                    {ep.name ?? `Episode ${ep.episode_number}`}
                  </Text>
                  {airDate ? <Text style={styles.airDate}>{airDate}</Text> : null}
                  {ep.overview ? (
                    <Text style={styles.overview} numberOfLines={3}>
                      {ep.overview}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.heading,
    color: Colors.text,
    marginBottom: Spacing.md,
  },

  // Season chips
  seasonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingRight: Spacing.lg,
  },
  seasonChip: {
    paddingHorizontal: 14,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    gap: 5,
  },
  seasonChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  seasonChipText: {
    ...Typography.label,
    color: Colors.textSecondary,
  },
  seasonChipTextActive: {
    color: Colors.background,
    fontWeight: '700',
  },

  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Colors.primary + '80',
  },
  progressFillActive: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },

  loader: {
    marginVertical: Spacing.xl,
  },

  // Episode cards
  episodeList: {
    gap: 1,
  },
  episodeCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  episodeCardUnaired: {
    opacity: 0.5,
  },

  // Still image
  still: {
    width: 120,
    height: 68,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    flexShrink: 0,
  },
  stillImg: {
    width: '100%',
    height: '100%',
  },
  stillPlaceholder: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
  },
  ratingBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: Colors.primary + '60',
  },
  ratingText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Text info
  info: {
    flex: 1,
    gap: 3,
  },
  infoTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  epCode: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  runtime: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  epName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 17,
  },
  airDate: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '400',
  },
  overview: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15,
    marginTop: 2,
  },
});
