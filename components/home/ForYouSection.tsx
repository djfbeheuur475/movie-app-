import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import PosterCard from '../common/PosterCard';
import ContentRow from './ContentRow';
import { compactHistory, fetchForYou, loadTasteProfile, rateTitle, toContentItem, type ForYouItem, type ForYouRow } from '../../lib/taste';
import { getTemporalContext } from '../../lib/tasteDna';
import type { TraktWatchedMovie, TraktWatchedShow } from '../../lib/trakt';

const CARD_WIDTH = 132;

interface Props {
  userId: string;
  movies?: TraktWatchedMovie[];
  shows?: TraktWatchedShow[];
  historyReady: boolean;
}

/**
 * "For You" — rows built from the viewer's taste profile (see lib/taste.ts).
 * Without a profile it's a single prompt to build one.
 */
export default function ForYouSection({ userId, movies, shows, historyReady }: Props) {
  const router = useRouter();
  const dateKey = getTemporalContext().dateKey.slice(0, 10);

  const profile = useQuery({
    queryKey: ['taste-profile', userId],
    queryFn: () => loadTasteProfile(userId),
    staleTime: 1000 * 60 * 10,
  });
  const hasProfile = !!profile.data?.profile;

  const rows = useQuery({
    queryKey: ['for-you', userId, dateKey, profile.data?.builtAt ?? null],
    queryFn: () => fetchForYou(compactHistory(movies, shows), dateKey),
    enabled: hasProfile && historyReady,
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  if (profile.isLoading) return null;

  if (!hasProfile) {
    return (
      <TouchableOpacity style={styles.cta} onPress={() => router.push('/taste')} activeOpacity={0.85}>
        <Ionicons name="sparkles" size={22} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaTitle}>Recommendations that actually fit</Text>
          <Text style={styles.ctaBody}>Rate ~40 titles and NextUp writes your taste profile, then picks from it.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <View>
      <TouchableOpacity style={styles.profileLink} onPress={() => router.push('/taste')} activeOpacity={0.8}>
        <Text style={styles.profileLinkText} numberOfLines={2}>✦ {profile.data!.profile!.summary}</Text>
        <Text style={styles.profileLinkMore}>Your taste ›</Text>
      </TouchableOpacity>
      {rows.isLoading
        ? [0, 1, 2].map((i) => (
            <ContentRow key={`fy-skel-${i}`} title="✦ Picking for your taste…" items={[]} isLoading accent />
          ))
        : rows.error
          ? (
            <TouchableOpacity style={styles.retry} onPress={() => rows.refetch()}>
              <Text style={styles.retryText}>Couldn't load your picks — tap to retry</Text>
            </TouchableOpacity>
          )
          : (rows.data?.rows ?? []).map((row) => <ForYouRowView key={row.id} row={row} userId={userId} />)}
    </View>
  );
}

function ForYouRowView({ row, userId }: { row: ForYouRow; userId: string }) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const items = row.items.filter((i) => !hidden.has(i.tmdbId));
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{row.heading}</Text>
      {!!row.subheading && <Text style={styles.rowSubtitle} numberOfLines={1}>{row.subheading}</Text>}
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => `${i.mediaType}-${i.tmdbId}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: Spacing.md }}
        renderItem={({ item }) => (
          <ForYouCard item={item} userId={userId} onDislike={() => setHidden((h) => new Set(h).add(item.tmdbId))} />
        )}
      />
    </View>
  );
}

function ForYouCard({ item, userId, onDislike }: { item: ForYouItem; userId: string; onDislike: () => void }) {
  const [liked, setLiked] = useState(false);
  const rate = (rating: 1 | -1) => {
    if (rating === 1) setLiked(true); else onDislike();
    rateTitle(userId, item, rating, 'recommendation').catch(() => { if (rating === 1) setLiked(false); });
  };
  return (
    <View style={{ width: CARD_WIDTH }}>
      <PosterCard item={toContentItem(item, item.reason)} width={CARD_WIDTH} showRating />
      <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
      {!!item.reason && <Text style={styles.reason} numberOfLines={3}>{item.reason}</Text>}
      <View style={styles.thumbs}>
        <TouchableOpacity onPress={() => rate(1)} hitSlop={8} accessibilityLabel={`More like ${item.title}`}>
          <Ionicons name={liked ? 'thumbs-up' : 'thumbs-up-outline'} size={18} color={liked ? Colors.success : Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => rate(-1)} hitSlop={8} accessibilityLabel={`Not for me: ${item.title}`}>
          <Ionicons name="thumbs-down-outline" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.lg, marginBottom: Spacing.xl,
    padding: Spacing.lg, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primaryDark,
  },
  ctaTitle: { ...Typography.subheading, color: Colors.text },
  ctaBody: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  profileLink: { marginHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  profileLinkText: { ...Typography.body, color: Colors.textSecondary, fontStyle: 'italic' },
  profileLinkMore: { ...Typography.caption, color: Colors.primary, marginTop: Spacing.xs },
  row: { marginBottom: Spacing.xl },
  rowTitle: { ...Typography.heading, color: Colors.text, paddingHorizontal: Spacing.lg },
  rowSubtitle: { ...Typography.caption, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, marginTop: 2, marginBottom: Spacing.md },
  cardTitle: { ...Typography.caption, color: Colors.text, fontWeight: '600', marginTop: Spacing.sm },
  reason: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  thumbs: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  retry: { marginHorizontal: Spacing.lg, marginBottom: Spacing.xl, padding: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.surface },
  retryText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
});
