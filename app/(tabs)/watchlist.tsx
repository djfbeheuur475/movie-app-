import React, { useMemo, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useAuthStore } from '../../store/authStore';
import { getPosterUrl } from '../../lib/tmdb';
import { traktApi } from '../../lib/trakt';
import type { WatchlistItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = Spacing.sm;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - CARD_GAP * 2) / 3;
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
  const userId = useAuthStore((s) => s.user?.id);
  const { traktClientId, traktUsername, traktAccessToken } = useApiKeysStore();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  const hasTrakt = !!(traktClientId && (traktUsername || traktAccessToken));

  const { data: traktMovies } = useQuery({
    queryKey: ['trakt-watched-movies-wl', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedMovies(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedMovies(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const { data: traktShows } = useQuery({
    queryKey: ['trakt-watched-shows-wl', traktClientId, traktUsername, traktAccessToken],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getWatchedShows(traktClientId, traktAccessToken)
        : traktApi.getUserWatchedShows(traktUsername, traktClientId),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  // Build lookup sets from Trakt data
  const watchedMovieIds = useMemo(() => {
    const ids = new Set<number>();
    (traktMovies ?? []).forEach((m) => {
      if (m.movie.ids.tmdb) ids.add(m.movie.ids.tmdb);
    });
    return ids;
  }, [traktMovies]);

  const watchedShowIds = useMemo(() => {
    const ids = new Set<number>();
    (traktShows ?? []).forEach((s) => {
      if (s.show.ids.tmdb) ids.add(s.show.ids.tmdb);
    });
    return ids;
  }, [traktShows]);

  const movieCount = items.filter((i) => i.media_type === 'movie').length;
  const tvCount = items.filter((i) => i.media_type === 'tv').length;

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (mediaFilter === 'movie' && i.media_type !== 'movie') return false;
      if (mediaFilter === 'tv' && i.media_type !== 'tv') return false;

      if (activeTab === 'all') return true;

      const isWatchedMovie = i.media_type === 'movie' && watchedMovieIds.has(i.tmdb_id);
      const isWatchingShow = i.media_type === 'tv' && watchedShowIds.has(i.tmdb_id);

      if (activeTab === 'watchlist') return !isWatchedMovie && !isWatchingShow;
      if (activeTab === 'watching') return isWatchingShow;
      if (activeTab === 'watched') return isWatchedMovie;
      return true;
    });
  }, [items, mediaFilter, activeTab, watchedMovieIds, watchedShowIds]);

  const handleRemove = (item: WatchlistItem) => {
    Alert.alert('Remove from watchlist?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeFromWatchlist(item.tmdb_id, item.media_type, userId),
      },
    ]);
  };

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'watchlist', label: 'To Watch' },
    { key: 'watching', label: 'Watching' },
    { key: 'watched', label: 'Watched' },
  ];

  const tabEmptyMessages: Record<FilterTab, string> = {
    all: '',
    watchlist: 'Nothing left to watch — add some titles first.',
    watching: hasTrakt
      ? 'No TV shows in progress. Start watching a show on Trakt to see it here.'
      : 'Connect Trakt in Settings to track your watching progress.',
    watched: hasTrakt
      ? 'No watched movies yet. Mark movies as watched on Trakt to see them here.'
      : 'Connect Trakt in Settings to track what you\'ve watched.',
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Watchlist</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/settings')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

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
          data={filtered}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <WatchlistCard item={item} onRemove={() => handleRemove(item)} />
          )}
          ListEmptyComponent={
            activeTab !== 'all' ? (
              <View style={styles.tabEmptyState}>
                <Text style={styles.tabEmptyText}>{tabEmptyMessages[activeTab]}</Text>
                {!hasTrakt && (activeTab === 'watching' || activeTab === 'watched') && (
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={() => router.push('/settings')}
                  >
                    <Text style={styles.connectBtnText}>Connect Trakt</Text>
                  </TouchableOpacity>
                )}
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
    paddingBottom: Spacing.xl,
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
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  tabEmptyText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  connectBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 10,
    marginTop: Spacing.sm,
  },
  connectBtnText: {
    ...Typography.subheading,
    color: Colors.background,
    fontWeight: '700',
  },
});
