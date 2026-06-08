import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView, ScrollView, Linking, Alert,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import ChatBubble from '../../components/ai/ChatBubble';
import { askGemini } from '../../lib/gemini';
import { traktApi } from '../../lib/trakt';
import type { TraktWatchedMovie, TraktWatchedShow } from '../../lib/trakt';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { useApiKeysStore } from '../../store/apiKeysStore';
import type { ChatMessage, ContentItem } from '../../types';

const SUGGESTIONS = [
  { icon: '🚀', label: 'Mind-bending sci-fi films' },
  { icon: '😂', label: 'Feel-good comedies for tonight' },
  { icon: '😱', label: 'Best horror movies of the decade' },
  { icon: '🏆', label: 'Award-winning dramas to watch' },
  { icon: '🛋️', label: 'Cozy movies for a lazy day' },
  { icon: '⚡', label: 'Action-packed thrillers under 2h' },
  { icon: '💕', label: 'Romantic movies for date night' },
  { icon: '🔍', label: 'Underrated hidden gems' },
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

      const { reply, tmdbIds } = await askGemini(
        cleanKey,
        history.map((m) => ({ role: m.role, content: m.content })),
        movies,
        shows
      );

      let recItems: ContentItem[] = [];
      if (tmdbIds.length > 0) {
        const fetched = await Promise.allSettled(
          tmdbIds.slice(0, 5).map(async (id) => {
            try {
              return normalizeMovie(await tmdbApi.getMovieDetail(id));
            } catch {
              return normalizeTVShow(await tmdbApi.getTVDetail(id));
            }
          })
        );
        recItems = fetched
          .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
          .map((r) => r.value);
      }

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
          {hasTrakt && (
            <View style={styles.traktBadge}>
              <Text style={styles.traktBadgeText}>📡 Trakt</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.stremioBtn}
            onPress={() => Linking.openURL('https://stremio.itcon.au/aisearch/configure')}
            activeOpacity={0.8}
          >
            <Text style={styles.stremioBtnText}>⚡ Stremio AI</Text>
          </TouchableOpacity>
          {!isInitialState && (
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
          )}
        </View>
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
            <View style={styles.heroSection}>
              <Text style={styles.heroIcon}>✦</Text>
              <Text style={styles.heroTitle}>What should{'\n'}you watch?</Text>
              <Text style={styles.heroSub}>
                {hasTrakt
                  ? 'Personalised recommendations based on your Trakt watch history'
                  : 'Get AI-powered movie & TV recommendations'}
              </Text>
            </View>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity
                  key={s.label}
                  style={styles.suggestionPill}
                  onPress={() => sendMessage(s.label)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.suggestionIcon}>{s.icon}</Text>
                  <Text style={styles.suggestionText}>{s.label}</Text>
                  <Text style={styles.suggestionArrow}>›</Text>
                </TouchableOpacity>
              ))}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 20, color: Colors.primary },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  traktBadge: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.full,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.border,
  },
  traktBadgeText: { ...Typography.label, color: Colors.textMuted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stremioBtn: {
    backgroundColor: '#7b2d8b', borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  stremioBtnText: { ...Typography.label, color: Colors.text, fontWeight: '700' },
  resetBtn: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  resetBtnText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  keyNotice: {
    backgroundColor: Colors.primary + '15', borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  keyNoticeText: { ...Typography.caption, color: Colors.textSecondary, lineHeight: 18 },
  heroContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  heroSection: {
    alignItems: 'center', paddingTop: Spacing.xxl, paddingBottom: Spacing.xl, gap: Spacing.md,
  },
  heroIcon: { fontSize: 48, color: Colors.primary },
  heroTitle: {
    fontSize: 34, fontWeight: '900', color: Colors.text,
    textAlign: 'center', letterSpacing: -1, lineHeight: 40,
  },
  heroSub: {
    ...Typography.body, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  suggestions: { gap: Spacing.sm },
  suggestionPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  suggestionIcon: { fontSize: 20 },
  suggestionText: { flex: 1, ...Typography.body, color: Colors.text, fontWeight: '500' },
  suggestionArrow: { fontSize: 20, color: Colors.textMuted },
  messageList: { paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  typingIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm,
  },
  typingText: { ...Typography.caption, color: Colors.textMuted },
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    gap: Spacing.sm, backgroundColor: Colors.background,
  },
  input: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    ...Typography.body, color: Colors.text, maxHeight: 100,
    borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.border },
  sendIcon: { fontSize: 20, color: Colors.background, fontWeight: '700' },
});
