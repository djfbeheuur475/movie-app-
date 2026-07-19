import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useManualWatchedStore } from '../../store/manualWatchedStore';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useAuthStore } from '../../store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { getPosterUrl, tmdbApi } from '../../lib/tmdb';
import { traktApi, effectiveTraktClientId } from '../../lib/trakt';
import type { WatchlistItem } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = Spacing.sm;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - CARD_GAP * 2) / 3;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

type FilterTab = 'all' | 'watchlist' | 'watching' | 'watched';

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
          <Text style={[styles.mediaTypeBadgeText, item.media_type === 'tv' && styles.mediaTypeBadgeTextTv]}>
            {item.media_type === 'tv' ? 'TV' : 'Movie'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
    </TouchableOpacity>
  );
}

export default function WatchlistScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, removeFromWatchlist } = useWatchlistStore();
  const isManuallyWatched = useManualWatchedStore((s) => s.isManuallyWatched);
  const userId = useAuthStore((s) => s.user?.id);
  const { traktClientId, traktAccessToken } = useApiKeysStore();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showMovies, setShowMovies] = useState(true);
  const [showShows, setShowShows] = useState(true);
  const [genreFilter, setGenreFilter] = useState<string>('');
  const [genreOpen, setGenreOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const toggleMovies = () => {
    if (showMovies && !showShows) return; // keep at least one active
    setShowMovies((v) => !v);
  };
  const toggleShows = () => {
    if (showShows && !showMovies) return;
    setShowShows((v) => !v);
  };

  const hasTrakt = !!traktAccessToken;
  const traktClientIdEff = effectiveTraktClientId(traktClientId);

  const { data: traktMovies } = useQuery({
    queryKey: ['trakt-watched-movies-wl', traktClientIdEff, traktAccessToken],
    queryFn: () => traktApi.getWatchedMovies(traktClientIdEff, traktAccessToken),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  const { data: traktShows } = useQuery({
    queryKey: ['trakt-watched-shows-wl', traktClientIdEff, traktAccessToken],
    queryFn: () => traktApi.getWatchedShows(traktClientIdEff, traktAccessToken),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
  });

  // Build lookup sets from Trakt data, plus anything manually marked watched
  // in-app (Trakt has no record of, e.g. watched somewhere that doesn't
  // scrobble) — otherwise it's stuck showing under "To Watch" forever.
  const watchedMovieIds = useMemo(() => {
    const ids = new Set<number>();
    (traktMovies ?? []).forEach((m) => {
      if (m.movie.ids.tmdb) ids.add(m.movie.ids.tmdb);
    });
    items.forEach((i) => {
      if (i.media_type === 'movie' && isManuallyWatched(i.tmdb_id, 'movie')) ids.add(i.tmdb_id);
    });
    return ids;
  }, [traktMovies, items, isManuallyWatched]);

  const watchedShowIds = useMemo(() => {
    const ids = new Set<number>();
    (traktShows ?? []).forEach((s) => {
      if (s.show.ids.tmdb) ids.add(s.show.ids.tmdb);
    });
    items.forEach((i) => {
      if (i.media_type === 'tv' && isManuallyWatched(i.tmdb_id, 'tv')) ids.add(i.tmdb_id);
    });
    return ids;
  }, [traktShows, items, isManuallyWatched]);

  // Fetch genres for each watchlist item — reuses the same cache key as the detail screen
  const genreQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['title-detail', item.tmdb_id, item.media_type],
      queryFn: () =>
        item.media_type === 'movie'
          ? tmdbApi.getMovieDetail(item.tmdb_id)
          : tmdbApi.getTVDetail(item.tmdb_id),
      staleTime: 1000 * 60 * 60,
      gcTime: 1000 * 60 * 60 * 24,
    })),
  });

  // tmdbId → genre name list
  const genreMap = useMemo(() => {
    const map = new Map<number, string[]>();
    genreQueries.forEach((q, i) => {
      const item = items[i];
      if (q.data && item) {
        const genres = ((q.data as any).genres ?? []) as { id: number; name: string }[];
        map.set(item.tmdb_id, genres.map((g) => g.name));
      }
    });
    return map;
  }, [genreQueries, items]);

  // All genres present in the current watchlist, sorted alphabetically
  const availableGenres = useMemo(() => {
    const all = new Set<string>();
    genreMap.forEach((genres) => genres.forEach((g) => all.add(g)));
    return Array.from(all).sort();
  }, [genreMap]);

  const movieCount = items.filter((i) => i.media_type === 'movie').length;
  const tvCount = items.filter((i) => i.media_type === 'tv').length;

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (!showMovies && i.media_type === 'movie') return false;
      if (!showShows && i.media_type === 'tv') return false;

      if (activeTab !== 'all') {
        const isWatchedMovie = i.media_type === 'movie' && watchedMovieIds.has(i.tmdb_id);
        const isWatchingShow = i.media_type === 'tv' && watchedShowIds.has(i.tmdb_id);
        if (activeTab === 'watchlist' && (isWatchedMovie || isWatchingShow)) return false;
        if (activeTab === 'watching' && !isWatchingShow) return false;
        if (activeTab === 'watched' && !isWatchedMovie) return false;
      }

      if (genreFilter) {
        const genres = genreMap.get(i.tmdb_id) ?? [];
        if (!genres.includes(genreFilter)) return false;
      }

      return true;
    });
  }, [items, showMovies, showShows, activeTab, watchedMovieIds, watchedShowIds, genreFilter, genreMap]);

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
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Watchlist</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.push('/(tabs)/search')}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Movies / TV Shows pill toggle */}
      <View style={styles.typeToggleWrap}>
        <TouchableOpacity
          style={[styles.typeToggleBtn, showMovies && styles.typeToggleBtnActive]}
          onPress={toggleMovies}
          activeOpacity={0.8}
        >
          <Ionicons
            name="film-outline"
            size={16}
            color={showMovies ? Colors.background : Colors.textSecondary}
          />
          <Text style={[styles.typeToggleText, showMovies && styles.typeToggleTextActive]}>
            Movies
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeToggleBtn, showShows && styles.typeToggleBtnActive]}
          onPress={toggleShows}
          activeOpacity={0.8}
        >
          <Ionicons
            name="tv-outline"
            size={16}
            color={showShows ? Colors.background : Colors.textSecondary}
          />
          <Text style={[styles.typeToggleText, showShows && styles.typeToggleTextActive]}>
            TV Shows
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status · Genre dropdowns */}
      <View style={styles.mediaToggleRow}>
        <TouchableOpacity
          style={[styles.dropdownBtn, activeTab !== 'all' && styles.dropdownBtnActive]}
          onPress={() => setStatusOpen(true)}
        >
          <Text style={[styles.dropdownText, activeTab !== 'all' && styles.dropdownTextActive]} numberOfLines={1}>
            {FILTER_TABS.find((t) => t.key === activeTab)?.label ?? 'Status'} ▾
          </Text>
        </TouchableOpacity>

        {availableGenres.length > 0 && (
          <TouchableOpacity
            style={[styles.dropdownBtn, !!genreFilter && styles.dropdownBtnActive]}
            onPress={() => setGenreOpen(true)}
          >
            <Text style={[styles.dropdownText, !!genreFilter && styles.dropdownTextActive]} numberOfLines={1}>
              {genreFilter || 'Genre'} ▾
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status modal */}
      <Modal visible={statusOpen} transparent animationType="fade" onRequestClose={() => setStatusOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setStatusOpen(false)}>
          <View style={[styles.genreSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.genreSheetTitle}>Filter by Status</Text>
            {FILTER_TABS.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.genreOption, activeTab === tab.key && styles.genreOptionActive]}
                onPress={() => { setActiveTab(tab.key); setStatusOpen(false); }}
              >
                <Text style={[styles.genreOptionText, activeTab === tab.key && styles.genreOptionTextActive]}>
                  {tab.key === 'all' ? 'All' : tab.label}
                </Text>
                {activeTab === tab.key && <Text style={styles.genreOptionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Genre picker modal */}
      <Modal visible={genreOpen} transparent animationType="fade" onRequestClose={() => setGenreOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setGenreOpen(false)}>
          <View style={[styles.genreSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.genreSheetTitle}>Filter by Genre</Text>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.genreOption, genreFilter === '' && styles.genreOptionActive]}
                onPress={() => { setGenreFilter(''); setGenreOpen(false); }}
              >
                <Text style={[styles.genreOptionText, genreFilter === '' && styles.genreOptionTextActive]}>
                  All Genres
                </Text>
                {genreFilter === '' && <Text style={styles.genreOptionCheck}>✓</Text>}
              </TouchableOpacity>
              {availableGenres.map((genre) => (
                <TouchableOpacity
                  key={genre}
                  style={[styles.genreOption, genreFilter === genre && styles.genreOptionActive]}
                  onPress={() => { setGenreFilter(genre); setGenreOpen(false); }}
                >
                  <Text style={[styles.genreOptionText, genreFilter === genre && styles.genreOptionTextActive]}>
                    {genre}
                  </Text>
                  {genreFilter === genre && <Text style={styles.genreOptionCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

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
    alignItems: 'center',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeToggleWrap: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
  },
  typeToggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  typeToggleText: {
    ...Typography.subheading,
    color: Colors.textMuted,
  },
  typeToggleTextActive: {
    color: Colors.background,
  },
  mediaToggleRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dropdownBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 120,
  },
  dropdownBtnActive: {
    backgroundColor: Colors.accent + '22',
    borderColor: Colors.accent,
  },
  dropdownText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  dropdownTextActive: {
    color: Colors.accent,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  genreSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: Spacing.md,
    maxHeight: '60%',
  },
  genreSheetTitle: {
    ...Typography.subheading,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  genreOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  genreOptionActive: {
    backgroundColor: Colors.accent + '11',
  },
  genreOptionText: {
    ...Typography.body,
    color: Colors.text,
  },
  genreOptionTextActive: {
    color: Colors.accent,
    fontWeight: '700',
  },
  genreOptionCheck: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: 16,
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
  mediaTypeBadgeTextTv: {
    color: Colors.text,
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
