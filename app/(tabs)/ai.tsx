import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import ChatBubble from '../../components/ai/ChatBubble';
import { backendApi } from '../../lib/api';
import { tmdbApi, normalizeMovie } from '../../lib/tmdb';
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

let messageIdCounter = 0;
const newId = () => String(++messageIdCounter);

export default function AITabScreen() {
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
  const isInitialState = messages.length === 1;

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

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
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const { reply, recommendations: tmdbIds } = await backendApi.askGemini(history);

      let recItems: ContentItem[] = [];
      if (tmdbIds && tmdbIds.length > 0) {
        const fetched = await Promise.allSettled(
          tmdbIds.slice(0, 5).map((id) => tmdbApi.getMovieDetail(id))
        );
        recItems = fetched
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
          .map((r) => normalizeMovie(r.value));
      }

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
        recommendations: recItems,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      const errMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting. Make sure the backend is running with your Gemini API key configured.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>✦</Text>
          <Text style={styles.headerTitle}>AI Guide</Text>
        </View>
        {!isInitialState && (
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={() => {
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

      {isInitialState ? (
        /* ── Hero / suggestions state ── */
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.heroContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.heroSection}>
              <Text style={styles.heroIcon}>✦</Text>
              <Text style={styles.heroTitle}>What should{'\n'}you watch?</Text>
              <Text style={styles.heroSub}>
                Get personalized movie & TV recommendations powered by AI
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
              placeholder="Message CineAI..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={500}
              selectionColor={Colors.primary}
              onSubmitEditing={() => sendMessage(input)}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.text} />
              ) : (
                <Text style={styles.sendIcon}>↑</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        /* ── Chat state ── */
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
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
              <Text style={styles.typingText}>Thinking...</Text>
            </View>
          )}

          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message CineAI..."
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
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 20,
    color: Colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  resetBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resetBtnText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  /* Hero state */
  heroContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  heroIcon: {
    fontSize: 48,
    color: Colors.primary,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: -1,
    lineHeight: 40,
  },
  heroSub: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  suggestions: {
    gap: Spacing.sm,
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  suggestionIcon: {
    fontSize: 20,
  },
  suggestionText: {
    flex: 1,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '500',
  },
  suggestionArrow: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  /* Chat state */
  messageList: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  typingText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  /* Shared input */
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
    backgroundColor: Colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    ...Typography.body,
    color: Colors.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.border,
  },
  sendIcon: {
    fontSize: 20,
    color: Colors.background,
    fontWeight: '700',
  },
});
