import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  Dimensions,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useAuthStore } from '../../store/authStore';
import { getPosterUrl } from '../../lib/tmdb';
import type { WatchlistItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = Spacing.sm;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - CARD_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

type FilterTab = 'all' | 'watchlist' | 'watching' | 'watched';
type MediaFilter = 'all' | 'movie' | 'tv';

function WatchlistCard({ item, onRemove }: { item: WatchlistItem; onRemove: () => void }) {
  const router = useRouter();
  const posterUrl = getPosterUrl(item.poster_path, 'medium');

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/title/${item.tmdb_id}?type=${item.media_type}`)}
      onLongPress={onRemove}
      activeOpacity={0.75}
    >
      <View style={styles.cardPoster}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={styles.cardImage} contentFit="cover" transition={300} />
        ) : (
          <View style={styles.cardPlaceholder}>
            <Text style={styles.cardPlaceholderText}>{item.title?.charAt(0) ?? '?'}</Text>
          </View>
        )}
        <View style={[styles.mediaTypeBadge, item.media_type === 'tv' && styles.mediaTypeBadgeTv]}>
          <Text style={styles.mediaTypeBadgeText}>{item.media_type === 'tv' ? 'TV' : 'Film'}</Text>
        </View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
    </TouchableOpacity>
  );
}

export default function WatchlistScreen() {
  const router = useRouter();
  const { items, removeFromWatchlist } = useWatchlistStore();
  const { isAuthenticated, user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const movieCount = items.filter((i) => i.media_type === 'movie').length;
  const tvCount = items.filter((i) => i.media_type === 'tv').length;

  const filtered = items.filter((i) => {
    if (mediaFilter === 'movie' && i.media_type !== 'movie') return false;
    if (mediaFilter === 'tv' && i.media_type !== 'tv') return false;
    return true;
  });

  const handleRemove = (item: WatchlistItem) => {
    Alert.alert('Remove from watchlist?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeFromWatchlist(item.tmdb_id, item.media_type),
      },
    ]);
  };

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'watchlist', label: 'To Watch' },
    { key: 'watching', label: 'Watching' },
    { key: 'watched', label: 'Watched' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Watchlist</Text>
          <Text style={styles.headerSub}>
            {items.length} titles · {movieCount} movies · {tvCount} shows
          </Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Account card (if not signed in) */}
      {!isAuthenticated && (
        <TouchableOpacity
          style={styles.accountCard}
          onPress={() => router.push('/(auth)/login')}
          activeOpacity={0.8}
        >
          <View style={styles.accountCardInner}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>?</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>Guest User</Text>
              <Text style={styles.accountEmail}>Sign in to sync across devices →</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {isAuthenticated && (
        <View style={styles.accountCard}>
          <View style={styles.accountCardInner}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>
                {(user?.displayName ?? user?.email ?? '?')[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>{user?.displayName ?? 'User'}</Text>
              <Text style={styles.accountEmail}>{user?.email ?? ''}</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={styles.manageKeysBtn}
            >
              <Text style={styles.manageKeysBtnText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Status filter tabs */}
      <View style={styles.filterTabsWrap}>
        <View style={styles.filterTabs}>
          {FILTER_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterTab, activeTab === tab.key && styles.filterTabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.filterTabText, activeTab === tab.key && styles.filterTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Media type toggle */}
      <View style={styles.mediaToggleRow}>
        {(['all', 'movie', 'tv'] as MediaFilter[]).map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.mediaToggleBtn, mediaFilter === type && styles.mediaToggleBtnActive]}
            onPress={() => setMediaFilter(type)}
          >
            <Text style={[styles.mediaToggleText, mediaFilter === type && styles.mediaToggleTextActive]}>
              {type === 'all' ? 'All' : type === 'movie' ? 'Movies' : 'Shows'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
          <Text style={styles.emptyDesc}>
            Browse movies and shows, then tap the watchlist button to save them here.
          </Text>
          <TouchableOpacity
            style={styles.discoverBtn}
            onPress={() => router.push('/(tabs)/discover')}
          >
            <Text style={styles.discoverBtnText}>Discover Content</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={activeTab === 'all' ? filtered : []}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <WatchlistCard item={item} onRemove={() => handleRemove(item)} />
          )}
          ListEmptyComponent={
            activeTab !== 'all' ? (
              <View style={styles.tabEmptyState}>
                <Text style={styles.tabEmptyText}>
                  No items in {FILTER_TABS.find((t) => t.key === activeTab)?.label ?? ''} yet.
                </Text>
                <Text style={styles.tabEmptyHint}>This feature is coming soon!</Text>
              </View>
            ) : null
          }
        />
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSub: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  settingsBtn: {
    marginTop: 4,
  },
  settingsIcon: {
    fontSize: 22,
    color: Colors.textMuted,
  },
  accountCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  accountCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + '33',
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  accountName: {
    ...Typography.subheading,
    color: Colors.text,
  },
  accountEmail: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 1,
  },
  manageKeysBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manageKeysBtnText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  filterTabsWrap: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
  },
  filterTabActive: {
    backgroundColor: Colors.primary,
  },
  filterTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  filterTabTextActive: {
    color: Colors.background,
    fontWeight: '700',
  },
  mediaToggleRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  mediaToggleBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mediaToggleBtnActive: {
    backgroundColor: Colors.primary + '22',
    borderColor: Colors.primary,
  },
  mediaToggleText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  mediaToggleTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 20,
  },
  gridRow: {
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  card: {
    width: CARD_WIDTH,
  },
  cardPoster: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    ...Shadow.sm,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPlaceholderText: {
    ...Typography.title,
    color: Colors.textMuted,
  },
  mediaTypeBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: Colors.primary,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  mediaTypeBadgeTv: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mediaTypeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.background,
    letterSpacing: 0.5,
  },
  cardTitle: {
    ...Typography.caption,
    color: Colors.text,
    marginTop: 6,
    fontWeight: '600',
    lineHeight: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyIcon: {
    fontSize: 52,
  },
  emptyTitle: {
    ...Typography.heading,
    color: Colors.text,
    textAlign: 'center',
  },
  emptyDesc: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  discoverBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    marginTop: Spacing.sm,
  },
  discoverBtnText: {
    ...Typography.subheading,
    color: Colors.background,
    fontWeight: '700',
  },
  tabEmptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: Spacing.sm,
  },
  tabEmptyText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  tabEmptyHint: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
});
