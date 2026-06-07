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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import ChatBubble from '../components/ai/ChatBubble';
import { backendApi } from '../lib/api';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../lib/tmdb';
import type { ChatMessage, ContentItem } from '../types';

const SUGGESTION_CHIPS = [
  'Mind-bending sci-fi 🚀',
  'Comforting movies 🛋️',
  'Best thrillers under 2h ⏱️',
  'Underrated horror 👻',
  'Feel-good comedies 😄',
  'Award-winning dramas 🏆',
];

let messageIdCounter = 0;
const newId = () => String(++messageIdCounter);

export default function AIAssistantScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: 'assistant',
      content: "Hi! I'm your AI movie guide. Tell me what you're in the mood for — a genre, feeling, or theme — and I'll find the perfect watch for you. ✦",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

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

    // Scroll to bottom
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const history = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      throw new Error('Use the AI tab instead of this legacy modal.');

      // eslint-disable-next-line no-unreachable
      const reply = '';
      const recItems: ContentItem[] = [];

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
        recommendations: recItems,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      const errMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Make sure the backend is running with your Gemini API key configured.",
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.aiIcon}>✦</Text>
          <Text style={styles.headerText}>AI Assistant</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatBubble message={item} />}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Typing indicator */}
      {isLoading && (
        <View style={styles.typingIndicator}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.typingText}>Thinking...</Text>
        </View>
      )}

      {/* Suggestion chips (only on first message) */}
      {messages.length === 1 && (
        <View style={styles.chips}>
          {SUGGESTION_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip}
              style={styles.chip}
              onPress={() => sendMessage(chip)}
              activeOpacity={0.75}
            >
              <Text style={styles.chipText}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputArea}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="What are you in the mood for?"
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
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiIcon: {
    color: Colors.primary,
    fontSize: 18,
  },
  headerText: {
    ...Typography.subheading,
    color: Colors.text,
  },
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  chip: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: {
    ...Typography.caption,
    color: Colors.text,
  },
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
    backgroundColor: Colors.surfaceElevated,
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
    color: Colors.text,
    fontWeight: '700',
  },
});
