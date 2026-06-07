import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { useWatchlistStore } from '../../store/watchlistStore';
import PosterCard from '../../components/common/PosterCard';
import type { ContentItem } from '../../types';

function SettingRow({ icon, label, value, onPress }: {
  icon: string; label: string; value?: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.settingIcon}>{icon}</Text>
      <View style={styles.settingContent}>
        <Text style={styles.settingLabel}>{label}</Text>
        {value && <Text style={styles.settingValue}>{value}</Text>}
      </View>
      {onPress && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isAuthenticated, signOut } = useAuthStore();
  const { items: watchlistItems } = useWatchlistStore();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const watchlistContentItems: ContentItem[] = watchlistItems.slice(0, 10).map((w) => ({
    id: w.tmdb_id,
    mediaType: w.media_type,
    title: w.title,
    posterPath: w.poster_path,
    backdropPath: null,
    releaseDate: '',
    rating: 0,
    overview: '',
  }));

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <Text style={styles.avatarInitial}>
                {(user?.displayName ?? user?.email ?? '?')[0].toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={styles.displayName}>
            {user?.displayName ?? user?.email ?? 'Guest'}
          </Text>
          {!isAuthenticated && (
            <TouchableOpacity
              style={styles.signInPrompt}
              onPress={() => router.push('/(auth)/login')}
            >
              <Text style={styles.signInText}>Sign in to sync your watchlist →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Stats */}
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{watchlistItems.length}</Text>
            <Text style={styles.statLabel}>Watchlist</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>0</Text>
            <Text style={styles.statLabel}>Watched</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>0</Text>
            <Text style={styles.statLabel}>Reviews</Text>
          </View>
        </View>

        {/* Watchlist preview */}
        {watchlistContentItems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Watchlist</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.watchlistRow}>
              {watchlistContentItems.map((item) => (
                <PosterCard key={`${item.mediaType}-${item.id}`} item={item} width={110} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* API Keys */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Keys</Text>
          <View style={styles.settingsCard}>
            <SettingRow
              icon="🔑"
              label="Manage API Keys"
              value="TMDB · Trakt · Gemini"
              onPress={() => router.push('/settings')}
            />
          </View>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.settingsCard}>
            <SettingRow
              icon="⚡"
              label="Connect Trakt"
              value="Configure in Settings"
              onPress={() => router.push('/settings')}
            />
            <SettingRow icon="🔔" label="Notifications" onPress={() => {}} />
            <SettingRow icon="🌍" label="Region" value="US" onPress={() => {}} />
            <SettingRow icon="🎬" label="Preferred Genres" onPress={() => {}} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.settingsCard}>
            <SettingRow icon="📋" label="Terms of Service" onPress={() => {}} />
            <SettingRow icon="🔒" label="Privacy Policy" onPress={() => {}} />
            <SettingRow icon="ℹ️" label="Version" value="1.0.0" />
          </View>
        </View>

        {isAuthenticated && (
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.primary,
    marginBottom: Spacing.md,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 44,
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '700',
    color: Colors.text,
  },
  displayName: {
    ...Typography.heading,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  signInPrompt: {
    marginTop: Spacing.sm,
  },
  signInText: {
    ...Typography.body,
    color: Colors.primary,
  },
  stats: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    ...Typography.heading,
    color: Colors.text,
  },
  statLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
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
  watchlistRow: {
    gap: 10,
  },
  settingsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  settingIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    ...Typography.body,
    color: Colors.text,
  },
  settingValue: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  signOutBtn: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.error + '22',
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: BorderRadius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  signOutText: {
    ...Typography.subheading,
    color: Colors.error,
  },
});
