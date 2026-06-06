import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import { getProfileUrl } from '../../lib/tmdb';
import type { CastMember, CrewMember } from '../../types';

interface Props {
  cast: CastMember[];
  crew?: CrewMember[];
}

function PersonCard({
  id,
  profilePath,
  name,
  sub,
  role,
}: {
  id: number;
  profilePath: string | null;
  name: string;
  sub: string;
  role?: 'director' | 'cast';
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/person/${id}`)}
      activeOpacity={0.75}
    >
      <View style={styles.photoWrap}>
        <Image
          source={{ uri: getProfileUrl(profilePath) ?? '' }}
          style={styles.photo}
          contentFit="cover"
        />
        {role === 'director' && (
          <View style={styles.directorBadge}>
            <Text style={styles.directorBadgeText}>DIR</Text>
          </View>
        )}
      </View>
      <Text style={styles.name} numberOfLines={2}>{name}</Text>
      <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
    </TouchableOpacity>
  );
}

export default function CastList({ cast, crew = [] }: Props) {
  const directors = crew.filter((c) => c.job === 'Director');
  const writers = crew.filter((c) => c.job === 'Screenplay' || c.job === 'Writer').slice(0, 2);
  const visibleCast = cast.slice(0, 15);

  // Directors + writers pinned at front
  const pinnedCrew: { id: number; profilePath: string | null; name: string; sub: string; role: 'director' | 'cast' }[] = [
    ...directors.map((d) => ({ id: d.id, profilePath: d.profile_path, name: d.name, sub: 'Director', role: 'director' as const })),
    ...writers.map((w) => ({ id: w.id, profilePath: w.profile_path, name: w.name, sub: w.job, role: 'cast' as const })),
  ];

  if (!visibleCast.length && !pinnedCrew.length) return null;

  return (
    <View style={styles.container}>
      {/* Directors / key crew pinned row */}
      {pinnedCrew.length > 0 && (
        <View style={styles.crewRow}>
          {pinnedCrew.map((p) => (
            <PersonCard key={`crew-${p.id}-${p.sub}`} {...p} />
          ))}
        </View>
      )}

      {/* Cast horizontal scroll */}
      {visibleCast.length > 0 && (
        <>
          <Text style={styles.title}>Cast</Text>
          <FlatList
            data={visibleCast}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <PersonCard
                id={item.id}
                profilePath={item.profile_path}
                name={item.name}
                sub={item.character}
                role="cast"
              />
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  crewRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    width: 76,
    alignItems: 'center',
  },
  photoWrap: {
    position: 'relative',
  },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceElevated,
  },
  directorBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  directorBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 0.5,
  },
  name: {
    ...Typography.caption,
    color: Colors.text,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
  },
  sub: {
    ...Typography.label,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
