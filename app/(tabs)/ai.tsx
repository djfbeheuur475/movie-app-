import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView, ScrollView, Alert,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import ChatBubble from '../../components/ai/ChatBubble';
import { askGemini } from '../../lib/gemini';
import { traktApi } from '../../lib/trakt';
import type { TraktWatchedMovie, TraktWatchedShow } from '../../lib/trakt';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useApiKeysStore } from '../../store/apiKeysStore';
import type { ChatMessage, ContentItem } from '../../types';

const MOOD_CHIPS = [
  { icon: '😴', label: 'Easy watch' },
  { icon: '⚡', label: 'Action' },
  { icon: '😂', label: 'Laugh' },
  { icon: '💕', label: 'Romance' },
  { icon: '😱', label: 'Horror' },
];

const CONTEXT_CHIPS = [
  { icon: '🏆', label: 'Award-winners' },
  { icon: '🔍', label: 'Hidden gems' },
  { icon: '🎬', label: 'Classic cinema' },
  { icon: '⭐', label: 'Trending now' },
];

let msgId = 0;
const newId = () => String(++msgId);

export default function AITabScreen() {
  const { geminiKey, traktClientId, traktUsername, traktAccessToken } = useApiKeysStore();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: 'assistant',
      content: "Hi! I'm your AI movie guide. Tell me what you're in the mood for and I'll find the perfect watch for you. ✦",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<FlatList>(null);
  const isSendingRef = useRef(false);
  const isInitialState = messages.length === 1;

  const traktCache = useRef<{ movies: TraktWatchedMovie[]; shows: TraktWatchedShow[] } | null>(null);

  const fetchTraktHistory = useCallback(async () => {
    if (traktCache.current) return traktCache.current;
    if (!traktClientId) return { movies: [], shows: [] };

    try {
      let movies: TraktWatchedMovie[] = [];
      let shows: TraktWatchedShow[] = [];

      if (traktAccessToken) {
        [movies, shows] = await Promise.all([
          traktApi.getWatchedMovies(traktClientId, traktAccessToken),
          traktApi.getWatchedShows(traktClientId, traktAccessToken),
        ]);
      } else if (traktUsername) {
        [movies, shows] = await Promise.all([
          traktApi.getUserWatchedMovies(traktUsername, traktClientId),
          traktApi.getUserWatchedShows(traktUsername, traktClientId),
        ]);
      }

      traktCache.current = { movies, shows };
      return traktCache.current;
    } catch {
      return { movies: [], shows: [] };
    }
  }, [traktClientId, traktUsername, traktAccessToken]);

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

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const history = [...messages, userMsg];
      const { movies, shows } = await fetchTraktHistory();

      // Collect every title already shown as a card this session so Gemini doesn't repeat them
      const alreadyRecommended = [
        ...new Set(
          messages
            .filter((m) => m.role === 'assistant' && m.recommendations?.length)
            .flatMap((m) => m.recommendations!.map((r) => r.title))
            .filter(Boolean)
        ),
      ];

      const { reply, movies: movieTitles, shows: showTitles } = await askGemini(
        cleanKey,
        history.map((m) => ({ role: m.role, content: m.content })),
        movies,
        shows,
        alreadyRecommended
      );

      const PREFERRED_LANGS = new Set(['en', 'es', 'fr', 'ko', 'ja']);
      const fulfilled = <T,>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled';

      // Search TMDB by title — far more reliable than asking Gemini for IDs
      const [movieSearchRes, showSearchRes] = await Promise.all([
        Promise.allSettled(
          movieTitles.slice(0, 10).map((title) =>
            tmdbApi.searchMovies(title).then((results) => results[0] ? normalizeMovie(results[0]) : null)
          )
        ),
        Promise.allSettled(
          showTitles.slice(0, 10).map((title) =>
            tmdbApi.searchTVShows(title).then((results) => results[0] ? normalizeTVShow(results[0]) : null)
          )
        ),
      ]);

      const allMovies = movieSearchRes.filter(fulfilled).map((r) => r.value).filter((v): v is ContentItem => !!v);
      const allShows = showSearchRes.filter(fulfilled).map((r) => r.value).filter((v): v is ContentItem => !!v);

      // First 5 quality-passing results become poster cards; all resolved items enable inline linking
      const posterItems = [...allMovies, ...allShows]
        .filter((item) => !!item.posterPath && PREFERRED_LANGS.has(item.originalLanguage ?? 'en'))
        .slice(0, 6);

      // Append any items that didn't make the poster cut — still needed for inline title links
      const posterIds = new Set(posterItems.map((i) => i.id));
      const linkOnlyItems = [...allMovies, ...allShows].filter((i) => !posterIds.has(i.id));

      const recItems: ContentItem[] = [...posterItems, ...linkOnlyItems];

      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: reply,
          timestamp: new Date(),
          recommendations: recItems,
        },
      ]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
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
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: userFacing,
          timestamp: new Date(),
        },
      ]);
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  }, [messages, geminiKey, fetchTraktHistory]);

  const hasTrakt = !!(traktClientId && (traktUsername || traktAccessToken));

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
                traktCache.current = null;
                setMessages([{
                  id: newId(),
                  role: 'assistant',
                  content: "Hi! I'm your AI movie guide. Tell me what you're in the mood for and I'll find the perfect watch for you. ✦",
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
            {/* Hero section */}
            <View style={styles.heroSection}>
              <View style={styles.heroIconWrapper}>
                <Text style={styles.heroIcon}>✦</Text>
              </View>
              <Text style={styles.heroTitle}>What should{'\n'}you watch?</Text>
              <Text style={styles.heroSub}>
                {hasTrakt
                  ? 'Personalised recommendations based on your Trakt watch history'
                  : 'Your intelligent entertainment concierge'}
              </Text>
            </View>

            {/* Tonight's Picks chip section */}
            <View style={styles.chipsSection}>
              <Text style={styles.chipsLabel}>Tonight's Picks</Text>

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
