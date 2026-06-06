import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, BorderRadius, Typography } from '../../constants/theme';
import PosterCard from '../common/PosterCard';
import type { ChatMessage } from '../../types';

interface Props {
  message: ChatMessage;
}

export default function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.row, isUser && styles.rowRight]}>
      {!isUser && <Text style={styles.avatar}>✦</Text>}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        <Text style={[styles.text, isUser && styles.userText]}>{message.content}</Text>
        {message.recommendations && message.recommendations.length > 0 && (
          <View style={styles.recs}>
            {message.recommendations.slice(0, 5).map((item) => (
              <PosterCard key={`${item.mediaType}-${item.id}`} item={item} width={90} showTitle />
            ))}
          </View>
        )}
        <Text style={styles.time}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  rowRight: {
    justifyContent: 'flex-end',
  },
  avatar: {
    color: Colors.primary,
    fontSize: 18,
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  aiBubble: {
    backgroundColor: Colors.surfaceElevated,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  text: {
    ...Typography.body,
    color: Colors.text,
    lineHeight: 20,
  },
  userText: {
    color: Colors.text,
  },
  recs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.md,
    gap: 6,
  },
  time: {
    ...Typography.label,
    color: Colors.textMuted,
    marginTop: 6,
    textAlign: 'right',
  },
});
