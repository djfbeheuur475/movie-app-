import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getProfileUrl } from '../../lib/tmdb';
import type { CastMember } from '../../types';

interface Props {
  cast: CastMember[];
}

export default function CastList({ cast }: Props) {
  const router = useRouter();
  const visible = cast.slice(0, 15);

  if (!visible.length) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cast</Text>
      <FlatList
        data={visible}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/person/${item.id}`)}
            activeOpacity={0.75}
          >
            <Image
              source={{ uri: getProfileUrl(item.profile_path) ?? '' }}
              style={styles.photo}
              contentFit="cover"
            />
            <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.character} numberOfLines={1}>{item.character}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  title: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  list: {
    gap: Spacing.md,
  },
  card: {
    width: 80,
    alignItems: 'center',
  },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceElevated,
  },
  name: {
    ...Typography.caption,
    color: Colors.text,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
  },
  character: {
    ...Typography.label,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
