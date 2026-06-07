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
}: {
  id: number;
  profilePath: string | null;
  name: string;
  sub: string;
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/person/${id}`)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: getProfileUrl(profilePath) ?? '' }}
        style={styles.photo}
        contentFit="cover"
      />
      <Text style={styles.name} numberOfLines={2}>{name}</Text>
      <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
    </TouchableOpacity>
  );
}

export default function CastList({ cast, crew = [] }: Props) {
  const directors = crew.filter((c) => c.job === 'Director');
  const writers = crew.filter((c) => c.job === 'Screenplay' || c.job === 'Writer').slice(0, 2);
  const visibleCast = cast.slice(0, 15);

  if (!visibleCast.length && !directors.length) return null;

  return (
    <View style={styles.container}>
      {/* Cast — horizontal scroll, shown first */}
      {visibleCast.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cast</Text>
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
              />
            )}
          />
        </View>
      )}

      {/* Direction — shown after cast */}
      {(directors.length > 0 || writers.length > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Direction</Text>
          <View style={styles.crewRow}>
            {directors.map((d) => (
              <PersonCard
                key={`dir-${d.id}`}
                id={d.id}
                profilePath={d.profile_path}
                name={d.name}
                sub="Director"
              />
            ))}
            {writers.map((w) => (
              <PersonCard
                key={`writer-${w.id}`}
                id={w.id}
                profilePath={w.profile_path}
                name={w.name}
                sub={w.job}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.subheading,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  list: {
    gap: Spacing.md,
    paddingRight: Spacing.lg,
  },
  crewRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  card: {
    width: 76,
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
  sub: {
    ...Typography.label,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});
