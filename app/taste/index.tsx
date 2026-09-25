import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { buildTasteProfile, compactHistory, loadTasteProfile } from '../../lib/taste';
import { useTraktHistory } from '../../hooks/useTraktHistory';
import { useAuthStore } from '../../store/authStore';

export default function TasteProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rebuild } = useLocalSearchParams<{ rebuild?: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { movies, shows, isReady, hasHistory } = useTraktHistory();
  const [notes, setNotes] = useState('');
  const notesLoaded = useRef(false);
  const autoBuilt = useRef(false);

  const stored = useQuery({
    queryKey: ['taste-profile', userId],
    queryFn: () => loadTasteProfile(userId!),
    enabled: !!userId,
  });

  useEffect(() => {
    if (stored.data && !notesLoaded.current) {
      setNotes(stored.data.userNotes);
      notesLoaded.current = true;
    }
  }, [stored.data]);

  const build = useMutation({
    mutationFn: () => buildTasteProfile(compactHistory(movies, shows), notes.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taste-profile'] });
      queryClient.invalidateQueries({ queryKey: ['for-you'] });
    },
  });

  // Arriving from the rater: build straight away.
  useEffect(() => {
    if (rebuild === '1' && isReady && userId && !autoBuilt.current) {
      autoBuilt.current = true;
      build.mutate();
    }
  }, [rebuild, isReady, userId]);

  const profile = stored.data?.profile;
  const notesChanged = notes.trim() !== (stored.data?.userNotes ?? '').trim();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your taste</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {!userId ? (
            <Text style={styles.muted}>Sign in to build your taste profile.</Text>
          ) : stored.isLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxxl }} />
          ) : build.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={[styles.muted, { marginTop: Spacing.md }]}>Reading your ratings and history…</Text>
            </View>
          ) : !profile ? (
            <View style={styles.center}>
              <Ionicons name="sparkles" size={40} color={Colors.primary} />
              <Text style={styles.emptyTitle}>Get a clear read on your taste</Text>
              <Text style={styles.muted}>
                Rate about 40 titles — loved, liked, meh or disliked. NextUp turns that into a plain-English profile of what you
                actually enjoy, then picks recommendations from it.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/taste/rate')}>
                <Text style={styles.primaryBtnText}>Start rating (≈3 min)</Text>
              </TouchableOpacity>
              {hasHistory && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => build.mutate()}>
                  <Text style={styles.linkText}>Or build a first draft from my watch history</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.summary}>{profile.summary}</Text>
              <Section title="You love" icon="heart" color="#f43f5e" items={profile.loves} />
              <Section title="You tend to avoid" icon="close-circle" color={Colors.error} items={profile.avoids} />
              {!!profile.acclaim && (
                <View style={styles.section}>
                  <SectionTitle title="Awards & critics" icon="trophy" color={Colors.accent} />
                  <Text style={styles.body}>{profile.acclaim}</Text>
                </View>
              )}
              {profile.moods.length > 0 && (
                <View style={styles.section}>
                  <SectionTitle title="Your moods" icon="color-palette" color={Colors.primary} />
                  {profile.moods.map((m) => (
                    <View key={m.label} style={styles.mood}>
                      <Text style={styles.moodLabel}>{m.label}</Text>
                      <Text style={styles.body}>{m.description}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Section title="Worth exploring" icon="compass" color={Colors.success} items={profile.blindSpots} />
              <Text style={styles.meta}>
                Based on {stored.data?.ratingsCount ?? 0} ratings{hasHistory ? ' and your Trakt history' : ''}
                {stored.data?.builtAt ? ` · updated ${formatDistanceToNow(new Date(stored.data.builtAt), { addSuffix: true })}` : ''}
              </Text>
            </>
          )}

          {!!build.error && <Text style={styles.error}>{(build.error as Error).message}</Text>}

          {!!userId && !build.isPending && (profile || stored.data?.userNotes) && (
            <View style={styles.section}>
              <SectionTitle title="Anything wrong or missing?" icon="create" color={Colors.textSecondary} />
              <Text style={styles.hint}>Say it in your own words — this overrides anything the profile guessed.</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={'e.g. "I love musicals" or "Friends is not for me"'}
                placeholderTextColor={Colors.textMuted}
                multiline
                style={styles.input}
              />
            </View>
          )}

          {!!profile && !build.isPending && (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => build.mutate()}>
                <Text style={styles.primaryBtnText}>{notesChanged ? 'Save notes & rebuild' : 'Rebuild profile'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/taste/rate')}>
                <Text style={styles.secondaryBtnText}>Rate more titles</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title, icon, color }: { title: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function Section({ title, icon, color, items }: { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.section}>
      <SectionTitle title={title} icon={icon} color={color} />
      {items.map((t) => (
        <View key={t} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={[styles.body, { flex: 1 }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { ...Typography.heading, color: Colors.text },
  scroll: { paddingBottom: Spacing.xxxl },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  center: { alignItems: 'center', paddingVertical: Spacing.xxl },
  emptyTitle: { ...Typography.title, color: Colors.text, marginVertical: Spacing.md, textAlign: 'center' },
  summary: { ...Typography.subheading, color: Colors.text, lineHeight: 24, marginTop: Spacing.sm },
  section: { marginTop: Spacing.xl },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.label, color: Colors.textSecondary, textTransform: 'uppercase' },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  bullet: { ...Typography.body, color: Colors.textMuted },
  body: { ...Typography.body, color: Colors.text, lineHeight: 21 },
  mood: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  moodLabel: { ...Typography.subheading, color: Colors.primary, marginBottom: 2 },
  meta: { ...Typography.caption, color: Colors.textMuted, marginTop: Spacing.xl },
  muted: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  hint: { ...Typography.caption, color: Colors.textMuted, marginBottom: Spacing.sm },
  input: {
    minHeight: 80, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border,
    color: Colors.text, padding: Spacing.md, textAlignVertical: 'top', ...Typography.body,
  },
  actions: { marginTop: Spacing.xl, gap: Spacing.md },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center', marginTop: Spacing.lg, alignSelf: 'stretch' },
  primaryBtnText: { ...Typography.subheading, color: '#000' },
  secondaryBtn: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, alignItems: 'center' },
  secondaryBtnText: { ...Typography.subheading, color: Colors.text },
  linkBtn: { marginTop: Spacing.lg },
  linkText: { ...Typography.body, color: Colors.primary },
  error: { ...Typography.body, color: Colors.error, marginTop: Spacing.lg, textAlign: 'center' },
});
