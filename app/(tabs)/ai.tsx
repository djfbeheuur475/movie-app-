import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView, ScrollView, Alert,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import ChatBubble from '../../components/ai/ChatBubble';
import { askGemini, summariseConversation } from '../../lib/gemini';
import { traktApi } from '../../lib/trakt';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useQuery } from '@tanstack/react-query';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useAuthStore } from '../../store/authStore';
import {
  getTemporalContext, loadAiSeenTitles, saveAiSeenTitles,
  loadLatestAiSummary, saveAiConversationToCloud,
} from '../../lib/tasteDna';
import type { ChatMessage, ContentItem } from '../../types';

const MOOD_CHIPS = [
  { icon: '🌧', label: 'Rainy night mood' },
  { icon: '🔪', label: 'Tense thriller' },
  { icon: '🎭', label: 'Prestige drama' },
  { icon: '🌌', label: 'Mind-bending sci-fi' },
  { icon: '😂', label: 'Feel-good comedy' },
];

const CONTEXT_CHIPS = [
  { icon: '🏆', label: 'Film festival picks' },
  { icon: '🔍', label: 'Overlooked gems' },
  { icon: '🎬', label: '70s-80s classics' },
  { icon: '🔥', label: 'Best of the decade' },
];

let msgId = 0;
const newId = () => String(++msgId);

// Maximum turns sent raw to Gemini before we start summarising older context
const MAX_RAW_TURNS = 8;

export default function AITabScreen() {
  const { geminiKey, traktClientId, traktUsername, traktAccessToken } = useApiKeysStore();
  const { user } = useAuthStore();
  const userId = user?.id ?? null;

  const temporal = getTemporalContext();
  const hasTrakt = !!(traktClientId && (traktUsername || traktAccessToken));

  // ─── Trakt via React Query (shared cache with home tab) ───────────────────
  const { data: traktMovies } = useQuery({
    queryKey: ['trakt-watched-movies', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const { data: traktShows } = useQuery({
    queryKey: ['trakt-watched-shows', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedShows(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: 'assistant',
      content: "What are you in the mood for? Tell me the vibe, a genre, a director, a feeling — and I'll find exactly the right watch for you. ✦",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<FlatList>(null);
  const isSendingRef = useRef(false);
  const isInitialState = messages.length === 1;

  // Conversation summary — condenses turns older than MAX_RAW_TURNS
  const conversationSummaryRef = useRef<string>('');

  // Cross-session seen titles + prior session AI summary
  const crossSessionSeenRef = useRef<string[]>([]);
  useEffect(() => {
    loadAiSeenTitles().then(titles => { crossSessionSeenRef.current = titles; });
    if (userId) {
      loadLatestAiSummary(userId).then(result => {
        if (result?.summary) {
          conversationSummaryRef.current = result.summary;
          // Merge prior session titles into seen list
          const merged = [...new Set([...result.titles, ...crossSessionSeenRef.current])].slice(0, 60);
          crossSessionSeenRef.current = merged;
        }
      });
    }
  }, [userId]);

  // Trigger conversation summarisation when history grows beyond MAX_RAW_TURNS
  useEffect(() => {
    const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
    if (!cleanKey || messages.length <= MAX_RAW_TURNS + 2) return;

    const toSummarise = messages.slice(0, -MAX_RAW_TURNS);
    if (toSummarise.length < 2) return;

    summariseConversation(
      cleanKey,
      toSummarise.map(m => ({ role: m.role, content: m.content })),
    ).then(summary => {
      if (summary) conversationSummaryRef.current = summary;
    }).catch(() => {});
  }, [messages.length]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSendingRef.current) return;

    const cleanKey = geminiKey.trim().replace(/[\n\r\t]/g, '');
    if (!cleanKey) {
      Alert.alert(
        'Gemini API key needed',
        'Add your free Gemini API key in Settings to enable AI recommendations.',
        [{ text: 'OK' }]
      );
      return;
    }

    isSendingRef.current = true;

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const allMessages = [...messages, userMsg];

      // Only send the last MAX_RAW_TURNS messages raw; older context is in the summary
      const recentTurns = allMessages.slice(-MAX_RAW_TURNS);
      const historyForGemini: { role: 'user' | 'assistant'; content: string }[] =
        conversationSummaryRef.current
          ? [
              { role: 'user', content: `[Context from earlier in our conversation: ${conversationSummaryRef.current}]` },
              ...recentTurns.map(m => ({ role: m.role, content: m.content })),
            ]
          : recentTurns.map(m => ({ role: m.role, content: m.content }));

      const movies = traktMovies ?? [];
      const shows = traktShows ?? [];

      // Merge in-session + cross-session seen titles
      const inSessionTitles = messages
        .filter(m => m.role === 'assistant' && m.recommendations?.length)
        .flatMap(m => m.recommendations!.map(r => r.title))
        .filter(Boolean);
      const alreadyRecommended = [...new Set([...crossSessionSeenRef.current, ...inSessionTitles])];

      const { reply, movies: movieTitles, movieYears, shows: showTitles, showYears } = await askGemini(
        cleanKey,
        historyForGemini,
        movies,
        shows,
        alreadyRecommended,
      );

      const PREFERRED_LANGS = new Set(['en', 'es', 'fr', 'ko', 'ja']);
      const fulfilled = <T,>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled';

      // Year-aware TMDB search — dramatically reduces title disambiguation errors
      const [movieSearchRes, showSearchRes] = await Promise.all([
        Promise.allSettled(
          movieTitles.slice(0, 10).map((title, i) =>
            tmdbApi.searchMovies(title, 1, movieYears[i] ?? undefined)
              .then(results => results[0] ? normalizeMovie(results[0]) : null)
          )
        ),
        Promise.allSettled(
          showTitles.slice(0, 10).map((title, i) =>
            tmdbApi.searchTVShows(title, 1, showYears[i] ?? undefined)
              .then(results => results[0] ? normalizeTVShow(results[0]) : null)
          )
        ),
      ]);

      const allMovies = movieSearchRes.filter(fulfilled).map(r => r.value).filter((v): v is ContentItem => !!v);
      const allShows = showSearchRes.filter(fulfilled).map(r => r.value).filter((v): v is ContentItem => !!v);

      const posterItems = [...allMovies, ...allShows]
        .filter(item => !!item.posterPath && PREFERRED_LANGS.has(item.originalLanguage ?? 'en'))
        .slice(0, 6);

      const posterIds = new Set(posterItems.map(i => i.id));
      const linkOnlyItems = [...allMovies, ...allShows].filter(i => !posterIds.has(i.id));
      const recItems: ContentItem[] = [...posterItems, ...linkOnlyItems];

      // Persist newly seen titles across sessions
      const newTitles = [...movieTitles, ...showTitles];
      if (newTitles.length > 0) {
        const updated = [...new Set([...newTitles, ...crossSessionSeenRef.current])].slice(0, 60);
        crossSessionSeenRef.current = updated;
        saveAiSeenTitles(newTitles, crossSessionSeenRef.current);
      }

      const updatedMessages: ChatMessage[] = [
        ...allMessages,
        {
          id: newId(),
          role: 'assistant',
          content: reply,
          timestamp: new Date(),
          recommendations: recItems,
        },
      ];
      setMessages(updatedMessages);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

      // Persist AI conversation summary to cloud after each exchange
      if (userId && newTitles.length > 0) {
        const sessionSummary = `User asked: "${trimmed}". AI recommended: ${newTitles.join(', ')}.`;
        saveAiConversationToCloud(userId, sessionSummary, newTitles);
      }
    } catch (e: any) {
      const msg = e?.message ?? '';
      const userFacing = msg.includes('No Gemini API key') || msg.includes('Invalid API key format')
        ? msg
        : msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')
        ? "Your Gemini API key is invalid. Go to Settings and paste a fresh key from aistudio.google.com."
        : msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('credits are depleted')
        ? "Gemini quota exceeded. Check your usage at aistudio.google.com or try again shortly."
        : msg.includes('PERMISSION_DENIED') || msg.includes('403')
        ? "Permission denied — check your Gemini API key has the Generative Language API enabled."
        : "Something went wrong reaching the AI. Check your Gemini API key in Settings.";
      setMessages(prev => [
        ...prev,
        { id: newId(), role: 'assistant', content: userFacing, timestamp: new Date() },
      ]);
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  }, [messages, geminiKey, traktMovies, traktShows, userId]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>✦</Text>
          <Text style={styles.headerTitle}>AI Guide</Text>
        </View>
        {!isInitialState && (
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => {
                conversationSummaryRef.current = '';
                setMessages([{
                  id: newId(),
                  role: 'assistant',
                  content: "What are you in the mood for? Tell me the vibe, a genre, a director, a feeling — and I'll find exactly the right watch for you. ✦",
                  timestamp: new Date(),
                }]);
                setInput('');
              }}
            >
              <Text style={styles.resetBtnText}>New chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {!geminiKey && (
        <View style={styles.keyNotice}>
          <Text style={styles.keyNoticeText}>
            ✦ Add your free Gemini API key in Settings to enable AI recommendations
          </Text>
        </View>
      )}

      {isInitialState ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.heroContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Hero section — time-aware copy */}
            <View style={styles.heroSection}>
              <View style={styles.heroIconWrapper}>
                <Text style={styles.heroIcon}>✦</Text>
              </View>
              <Text style={styles.heroTitle}>
                {temporal.timeOfDay === 'morning' ? 'Start the day\nright.' :
                 temporal.timeOfDay === 'afternoon' ? 'An afternoon\nwell spent.' :
                 temporal.timeOfDay === 'late-night' ? 'Late night\ncinema.' :
                 temporal.dayType === 'weekend' ? 'Your weekend\nwatch.' :
                 'Tonight\'s\nperfect watch.'}
              </Text>
              <Text style={styles.heroSub}>
                {temporal.specialPeriod
                  ? `${temporal.specialPeriod.split(' ')[0]} picks, curated for your taste.`
                  : hasTrakt
                  ? 'Curated for your taste. Powered by your Trakt history.'
                  : 'Tell me the vibe and I\'ll find exactly the right watch.'}
              </Text>
            </View>

            {/* Mood chips */}
            <View style={styles.chipsSection}>
              <Text style={styles.chipsLabel}>
                {temporal.specialPeriod?.includes('Halloween') ? 'Horror season picks' :
                 temporal.specialPeriod?.includes('awards') ? 'Awards season' :
                 temporal.specialPeriod?.includes('festive') ? 'Festive picks' :
                 temporal.timeOfDay === 'late-night' ? 'Late night vibes' :
                 temporal.dayType === 'weekend' ? 'Weekend mood' :
                 'What\'s the mood?'}
              </Text>

              {/* Row 1 — mood chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {MOOD_CHIPS.map((chip) => (
                  <TouchableOpacity
                    key={chip.label}
                    style={styles.chip}
                    onPress={() => sendMessage(`${chip.icon} ${chip.label}`)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.chipIcon}>{chip.icon}</Text>
                    <Text style={styles.chipText}>{chip.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Row 2 — context chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {CONTEXT_CHIPS.map((chip) => (
                  <TouchableOpacity
                    key={chip.label}
                    style={[styles.chip, styles.chipContext]}
                    onPress={() => sendMessage(`${chip.icon} ${chip.label}`)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.chipIcon}>{chip.icon}</Text>
                    <Text style={styles.chipText}>{chip.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </ScrollView>

          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message NextUp AI..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={500}
              selectionColor={Colors.primary}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              activeOpacity={0.8}
            >
              {isLoading
                ? <ActivityIndicator size="small" color={Colors.text} />
                : <Text style={styles.sendIcon}>↑</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
          {isLoading && (
            <View style={styles.typingIndicator}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.typingText}>Thinking…</Text>
            </View>
          )}
          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message NextUp AI..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={500}
              selectionColor={Colors.primary}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 20, color: Colors.primary },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resetBtn: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  resetBtnText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },

  // ── Key notice ───────────────────────────────────────────────────────────────
  keyNotice: {
    backgroundColor: Colors.primary + '15', borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  keyNoticeText: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },

  // ── Hero section ─────────────────────────────────────────────────────────────
  heroContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
  heroSection: {
    alignItems: 'center',
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  heroIconWrapper: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '35',
  },
  heroIcon: { fontSize: 32, color: Colors.primary },
  heroTitle: {
    fontSize: 36, fontWeight: '900', color: Colors.text,
    textAlign: 'center', letterSpacing: -1.2, lineHeight: 42,
  },
  heroSub: {
    ...Typography.body, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 22, maxWidth: 260,
  },

  // ── Chips section ────────────────────────────────────────────────────────────
  chipsSection: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  chipsLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.textSecondary,
    letterSpacing: 0.4, textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  chipRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  chipContext: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.primary + '30',
  },
  chipIcon: { fontSize: 16 },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.text },

  // ── Chat / messages ──────────────────────────────────────────────────────────
  messageList: { paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  typingIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm,
  },
  typingText: { ...Typography.caption, color: Colors.textMuted },

  // ── Input area ───────────────────────────────────────────────────────────────
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
    gap: Spacing.sm, backgroundColor: Colors.background,
  },
  input: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    ...Typography.body, color: Colors.text, maxHeight: 100,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#2a2a2a' },
  sendIcon: { fontSize: 20, color: Colors.background, fontWeight: '700' },
});
