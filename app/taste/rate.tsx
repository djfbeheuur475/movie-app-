import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getPosterUrl } from '../../lib/tmdb';
import { compactHistory, fetchTasteSeed, rateTitle, type SeedItem, type TasteRating } from '../../lib/taste';
import { useTraktHistory } from '../../hooks/useTraktHistory';
import { useAuthStore } from '../../store/authStore';

const TARGET = 40;
const MIN_FOR_PROFILE = 15;

const CHOICES: { rating: TasteRating; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { rating: 2, label: 'Loved', icon: 'heart', color: '#f43f5e' },
  { rating: 1, label: 'Liked', icon: 'thumbs-up', color: Colors.success },
  { rating: 0, label: 'Meh', icon: 'remove-circle-outline', color: Colors.textSecondary },
  { rating: -1, label: 'Disliked', icon: 'thumbs-down', color: Colors.error },
];

export default function RateScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { movies, shows, isReady } = useTraktHistory();
  const { width, height } = useWindowDimensions();
  // Leave room for the header, title and rating buttons so nothing needs scrolling on a phone.
  const posterWidth = Math.max(140, Math.min(width - Spacing.xl * 2, 260, (height - 560) / 1.5));

  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<{ item: SeedItem; rating: TasteRating }[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const seed = useQuery({
    queryKey: ['taste-seed', userId, round],
    queryFn: () => fetchTasteSeed(compactHistory(movies, shows)),
    enabled: !!userId && isReady,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
    retry: 1,
  });

  const items = seed.data?.items ?? [];
  const current = items[index];
  const priorRated = seed.data?.ratedCount ?? 0;
  const ratedCount = priorRated + answered.filter((a) => a.rating !== null).length;
  const progress = Math.min(1, ratedCount / TARGET);

  const answer = async (rating: TasteRating) => {
    if (!current || !userId) return;
    setSaveError(null);
    setAnswered((a) => [...a, { item: current, rating }]);
    setIndex((i) => i + 1);
    try {
      await rateTitle(userId, current, rating, 'rater');
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  const undo = async () => {
    const last = answered[answered.length - 1];
    if (!last) return;
    setAnswered((a) => a.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
  };

  const finish = () => {
    queryClient.invalidateQueries({ queryKey: ['taste-profile'] });
    router.replace('/taste?rebuild=1');
  };

  const done = !seed.isLoading && !current;

  const body = useMemo(() => {
    if (!userId) {
      return <Text style={styles.muted}>Sign in to build your taste profile.</Text>;
    }
    if (seed.isLoading || !isReady) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={[styles.muted, { marginTop: Spacing.md }]}>Choosing titles that tell your taste apart…</Text>
        </View>
      );
    }
    if (seed.error) {
      return (
        <View style={styles.center}>
          <Text style={styles.muted}>{(seed.error as Error).message}</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => seed.refetch()}>
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (done) {
      return (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
          <Text style={styles.doneTitle}>{ratedCount} titles rated</Text>
          <Text style={styles.muted}>
            {ratedCount >= MIN_FOR_PROFILE ? 'Enough to write your taste profile.' : `Rate ${MIN_FOR_PROFILE - ratedCount} more for a useful profile.`}
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setIndex(0); setAnswered([]); setRound((r) => r + 1); }}>
            <Text style={styles.secondaryBtnText}>Rate more titles</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.card}>
        <Image
          source={{ uri: getPosterUrl(current.posterPath, 'large') ?? undefined }}
          style={{ width: posterWidth, height: posterWidth * 1.5, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface }}
          contentFit="cover"
          transition={150}
        />
        <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
        <Text style={styles.meta}>
          {current.year || ''}{current.year ? ' · ' : ''}{current.mediaType === 'tv' ? 'TV series' : 'Film'}
        </Text>
        {!!current.prompt && current.fromHistory && <Text style={styles.prompt}>{current.prompt}</Text>}
      </View>
    );
  }, [userId, seed.isLoading, seed.error, isReady, done, current, posterWidth, ratedCount]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: Spacing.md }}>
          <Text style={styles.headerTitle}>Rate what you know</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{ratedCount} of {TARGET} rated</Text>
        </View>
        <TouchableOpacity onPress={undo} disabled={!answered.length} hitSlop={12} accessibilityLabel="Undo">
          <Ionicons name="arrow-undo" size={22} color={answered.length ? Colors.text : Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.inner}>{body}</View>
      </ScrollView>

      <View style={styles.footer}>
        {!!saveError && <Text style={styles.error}>Couldn't save that rating: {saveError}</Text>}
        {current && !done && (
          <>
            <View style={styles.choiceRow}>
              {CHOICES.map((c) => (
                <TouchableOpacity key={c.label} style={styles.choice} onPress={() => answer(c.rating)} activeOpacity={0.7}>
                  <Ionicons name={c.icon} size={26} color={c.color} />
                  <Text style={styles.choiceLabel}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.skip} onPress={() => answer(null)}>
              <Text style={styles.skipText}>Haven't seen it</Text>
            </TouchableOpacity>
          </>
        )}
        {ratedCount >= MIN_FOR_PROFILE && (
          <TouchableOpacity style={styles.primaryBtn} onPress={finish} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Build my taste profile</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { ...Typography.subheading, color: Colors.text },
  progressTrack: { height: 4, backgroundColor: Colors.surfaceElevated, borderRadius: 2, marginTop: Spacing.sm, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: Colors.primary },
  progressText: { ...Typography.caption, color: Colors.textMuted, marginTop: Spacing.xs },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.xl, justifyContent: 'center' },
  center: { alignItems: 'center', paddingVertical: Spacing.xxxl },
  card: { alignItems: 'center', paddingVertical: Spacing.lg },
  title: { ...Typography.title, color: Colors.text, textAlign: 'center', marginTop: Spacing.lg },
  meta: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs },
  prompt: { ...Typography.caption, color: Colors.primary, marginTop: Spacing.sm, fontStyle: 'italic' },
  muted: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  doneTitle: { ...Typography.title, color: Colors.text, marginVertical: Spacing.sm },
  footer: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  choiceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  choice: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  choiceLabel: { ...Typography.caption, color: Colors.text, marginTop: Spacing.xs },
  skip: { alignItems: 'center', paddingVertical: Spacing.md },
  skipText: { ...Typography.body, color: Colors.textSecondary },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, alignItems: 'center' },
  primaryBtnText: { ...Typography.subheading, color: '#000' },
  secondaryBtn: { marginTop: Spacing.lg, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  secondaryBtnText: { ...Typography.subheading, color: Colors.text },
  error: { ...Typography.caption, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
});
