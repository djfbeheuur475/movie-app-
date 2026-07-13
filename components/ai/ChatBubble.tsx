import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, BorderRadius, Typography } from '../../constants/theme';
import PosterCard from '../common/PosterCard';
import { useTraktWatched } from '../../hooks/useTraktWatched';
import type { ChatMessage, ContentItem } from '../../types';

interface Props {
  message: ChatMessage;
}

function cleanContent(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

// Renders reply text with any mentioned recommendation titles as tappable links
function LinkedReplyText({
  text,
  recommendations,
  isUser,
}: {
  text: string;
  recommendations?: ContentItem[];
  isUser: boolean;
}) {
  const router = useRouter();
  const cleaned = cleanContent(text);

  if (!recommendations?.length) {
    return <Text style={[styles.text, isUser && styles.userText]}>{cleaned}</Text>;
  }

  // Sort longest-title-first so "Breaking Bad" matches before "Bad" if there were overlap
  const sorted = [...recommendations].sort((a, b) => b.title.length - a.title.length);
  const pattern = sorted
    .map((item) => item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = cleaned.split(regex);

  return (
    <Text style={[styles.text, isUser && styles.userText]}>
      {parts.map((part, i) => {
        const match = recommendations.find(
          (item) => item.title.toLowerCase() === part.toLowerCase()
        );
        if (match) {
          return (
            <Text
              key={i}
              style={styles.titleLink}
              onPress={() => router.push(`/title/${match.id}?type=${match.mediaType}`)}
            >
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

export default function ChatBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const { isWatched } = useTraktWatched();

  return (
    <View style={[styles.row, isUser && styles.rowRight]}>
      {!isUser && <Text style={styles.avatar}>✦</Text>}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        <LinkedReplyText
          text={message.content}
          recommendations={message.recommendations}
          isUser={isUser}
        />
        {message.recommendations && message.recommendations.length > 0 && (
          <View style={styles.recs}>
            {message.recommendations.slice(0, 5).map((item) => (
              <PosterCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                width={90}
                showTitle
                showType
                showRating
                watched={isWatched(item.id, item.mediaType)}
              />
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
  titleLink: {
    color: Colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
