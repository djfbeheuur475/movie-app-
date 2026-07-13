import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SectionList, TextInput, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  format, addDays, addMonths, startOfToday,
  isSameDay, parseISO, isAfter, isBefore, addYears,
} from 'date-fns';
import { Colors, Spacing, Typography, BorderRadius, Shadow } from '../../constants/theme';
import { tmdbApi, getPosterUrl } from '../../lib/tmdb';
import { traktApi, TraktUnauthorizedError, effectiveTraktClientId } from '../../lib/trakt';
import { useWatchlistStore } from '../../store/watchlistStore';
import { useApiKeysStore } from '../../store/apiKeysStore';
import { useFollowStore } from '../../store/followStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarEntry {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  airDate: Date;
  note: string;
  isFromWatchlist: boolean;
  notifyEnabled: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByDate(entries: CalendarEntry[]): { title: string; isTonight: boolean; data: CalendarEntry[] }[] {
  const map = new Map<string, CalendarEntry[]>();
  const today = startOfToday();

  entries
    .sort((a, b) => a.airDate.getTime() - b.airDate.getTime())
    .forEach((entry) => {
      const key = format(entry.airDate, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    });

  return Array.from(map.entries()).map(([dateKey, data]) => {
    const d = parseISO(dateKey);
    const isToday = isSameDay(d, today);
    const isTomorrow = isSameDay(d, addDays(today, 1));
    const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : format(d, 'EEEE, MMMM d');
    return { title: label, isTonight: isToday, data };
  });
}

function CalendarCard({ entry, isTonight }: { entry: CalendarEntry; isTonight: boolean }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={[styles.card, entry.isFromWatchlist && styles.cardHighlighted]}
      onPress={() => router.push(`/title/${entry.tmdbId}?type=${entry.mediaType}`)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: getPosterUrl(entry.posterPath, 'thumb') ?? '' }}
        style={styles.cardPoster}
        contentFit="cover"
      />
      <View style={styles.cardInfo}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{entry.title}</Text>
          {isTonight && (
            <View style={styles.tonightBadge}>
              <Text style={styles.tonightBadgeText}>• Tonight</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardNote}>{entry.note}</Text>
        <Text style={styles.cardDate}>{format(entry.airDate, 'EEE, MMM d')}</Text>
      </View>
      <View style={styles.cardRight}>
        {entry.notifyEnabled && (
          <Ionicons name="notifications" size={16} color={Colors.primary} />
        )}
        <Ionicons
          name={entry.mediaType === 'movie' ? 'film-outline' : 'tv-outline'}
          size={18}
          color={Colors.textMuted}
        />
      </View>
    </TouchableOpacity>
  );
}

function ShowSearchResult({ show, onPress }: { show: any; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.searchResult} onPress={onPress} activeOpacity={0.75}>
      <Image
        source={{ uri: getPosterUrl(show.poster_path, 'thumb') ?? '' }}
        style={styles.searchResultPoster}
        contentFit="cover"
      />
      <View style={styles.searchResultInfo}>
        <Text style={styles.searchResultTitle} numberOfLines={1}>{show.name}</Text>
        <Text style={styles.searchResultYear}>{show.first_air_date?.slice(0, 4) ?? ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = startOfToday();
  const router = useRouter();
  const [showWatching, setShowWatching] = useState(true);
  const [showNewMovies, setShowNewMovies] = useState(false);
  const [showAnticipated, setShowAnticipated] = useState(false);
  const [showForYou, setShowForYou] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [pinnedShow, setPinnedShow] = useState<{ id: number; name: string } | null>(null);

  const { items: watchlist } = useWatchlistStore();
  const { isFollowed, isUnfollowed } = useFollowStore();
  const { traktClientId, traktAccessToken, handleTraktUnauthorized } = useApiKeysStore();
  const hasTrakt = !!traktAccessToken;
  const traktClientIdEff = effectiveTraktClientId(traktClientId);
  const queryClient = useQueryClient();

  // ── Upcoming movies — full year (5 pages ≈ 100 films) ────────────────────

  const { data: upcomingMoviesYear, isLoading: moviesLoading } = useQuery({
    queryKey: ['upcoming-movies-year'],
    queryFn: async () => {
      const pages = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((p) => tmdbApi.getUpcomingYear(p))
      );
      return pages
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .flatMap((r) => r.value.results);
    },
    staleTime: 1000 * 60 * 60 * 6,
  });

  // ── Most anticipated — popular upcoming releases (next 5 months) ─────────

  const { data: anticipatedRaw } = useQuery({
    queryKey: ['anticipated-releases'],
    queryFn: async () => {
      const todayStr = format(startOfToday(), 'yyyy-MM-dd');
      const futureStr = format(addMonths(startOfToday(), 12), 'yyyy-MM-dd');
      const moviePages = [1, 2, 3].map((p) =>
        tmdbApi.discoverMovies({
          sort_by: 'popularity.desc',
          'primary_release_date.gte': todayStr,
          'primary_release_date.lte': futureStr,
          page: p,
        })
      );
      const tvPages = [1, 2, 3].map((p) =>
        tmdbApi.discoverTV({
          sort_by: 'popularity.desc',
          'first_air_date.gte': todayStr,
          'first_air_date.lte': futureStr,
          page: p,
        })
      );
      const settled = await Promise.allSettled([...moviePages, ...tvPages]);
      const movies = settled
        .slice(0, 3)
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value.map((m: any) => ({ ...m, _mediaType: 'movie' as const })));
      const shows = settled
        .slice(3)
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value.map((s: any) => ({ ...s, _mediaType: 'tv' as const })));
      return [...movies, ...shows];
    },
    staleTime: 1000 * 60 * 60 * 12,
  });

  // ── Watchlist TV shows → details ─────────────────────────────────────────

  const watchlistShowIds = useMemo(
    () => watchlist.filter((w) => w.media_type === 'tv').map((w) => w.tmdb_id),
    [watchlist]
  );

  const { data: watchlistShowDetails } = useQuery({
    queryKey: ['watchlist-show-details', watchlistShowIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        watchlistShowIds.map((id) => tmdbApi.getTVDetail(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: watchlistShowIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // ── Trakt history → top shows not already in watchlist ───────────────────

  const { data: traktWatchedShows, error: traktCalError } = useQuery({
    queryKey: ['trakt-cal-shows', traktClientIdEff, traktAccessToken],
    queryFn: () => traktApi.getWatchedShows(traktClientIdEff, traktAccessToken),
    enabled: hasTrakt,
    staleTime: 1000 * 60 * 30,
    retry: (count, error) => !(error instanceof TraktUnauthorizedError) && count < 2,
  });

  useEffect(() => {
    if (traktCalError instanceof TraktUnauthorizedError) {
      handleTraktUnauthorized().then((refreshed) => {
        if (refreshed) queryClient.invalidateQueries({ queryKey: ['trakt-cal-shows'] });
      });
    }
  }, [traktCalError]);

  const traktShowTmdbIds = useMemo(() => {
    if (!traktWatchedShows?.length) return [];
    return traktWatchedShows
      .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
      .map((s) => s.show.ids.tmdb)
      .filter((id): id is number => !!id && !watchlistShowIds.includes(id))
      .slice(0, 40);
  }, [traktWatchedShows, watchlistShowIds]);

  const { data: traktShowDetails, isLoading: traktShowsLoading } = useQuery({
    queryKey: ['trakt-show-details-cal', traktShowTmdbIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        traktShowTmdbIds.map((id) => tmdbApi.getTVDetail(id))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: traktShowTmdbIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });

  // ── For You — genre-matched upcoming releases ────────────────────────────

  const topGenreIds = useMemo(() => {
    const count = new Map<number, number>();
    const allShows = [...(watchlistShowDetails ?? []), ...(traktShowDetails ?? [])];
    for (const show of allShows) {
      for (const g of (show.genres ?? [])) {
        count.set(g.id, (count.get(g.id) ?? 0) + 1);
      }
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => id);
  }, [watchlistShowDetails, traktShowDetails]);

  const { data: forYouRaw } = useQuery({
    queryKey: ['for-you-releases', topGenreIds.join(',')],
    queryFn: async () => {
      const todayStr = format(startOfToday(), 'yyyy-MM-dd');
      const futureStr = format(addMonths(startOfToday(), 6), 'yyyy-MM-dd');
      const genreStr = topGenreIds.join(',');
      const settled = await Promise.allSettled([
        tmdbApi.discoverMovies({ sort_by: 'popularity.desc', 'primary_release_date.gte': todayStr, 'primary_release_date.lte': futureStr, with_genres: genreStr, page: 1 }),
        tmdbApi.discoverMovies({ sort_by: 'popularity.desc', 'primary_release_date.gte': todayStr, 'primary_release_date.lte': futureStr, with_genres: genreStr, page: 2 }),
        tmdbApi.discoverTV({ sort_by: 'popularity.desc', 'first_air_date.gte': todayStr, 'first_air_date.lte': futureStr, with_genres: genreStr, page: 1 }),
        tmdbApi.discoverTV({ sort_by: 'popularity.desc', 'first_air_date.gte': todayStr, 'first_air_date.lte': futureStr, with_genres: genreStr, page: 2 }),
      ]);
      const movieItems = settled.slice(0, 2)
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value.map((m: any) => ({ ...m, _mediaType: 'movie' as const })));
      const tvItems = settled.slice(2)
        .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value.map((s: any) => ({ ...s, _mediaType: 'tv' as const })));
      return [...movieItems, ...tvItems];
    },
    enabled: topGenreIds.length > 0,
    staleTime: 1000 * 60 * 60 * 12,
  });

  // ── Season episode schedules ──────────────────────────────────────────────
  // For every show that has a scheduled next episode, fetch the full current
  // season so we can populate all future episodes (not just the next one).

  const seasonFetchList = useMemo(() => {
    const list: { showId: number; seasonNumber: number }[] = [];
    const seen = new Set<string>();
    const allShows = [...(watchlistShowDetails ?? []), ...(traktShowDetails ?? [])];
    for (const show of allShows) {
      const sn = show.next_episode_to_air?.season_number;
      if (!sn) continue;
      const key = `${show.id}-${sn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ showId: show.id, seasonNumber: sn });
    }
    return list;
  }, [watchlistShowDetails, traktShowDetails]);

  const { data: seasonData, isLoading: seasonsLoading } = useQuery({
    queryKey: ['season-episodes', seasonFetchList.map((s) => `${s.showId}-${s.seasonNumber}`)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        seasonFetchList.map(({ showId, seasonNumber }) =>
          tmdbApi.getTVSeason(showId, seasonNumber).then((d) => ({ showId, ...d }))
        )
      );
      return results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: seasonFetchList.length > 0,
    staleTime: 1000 * 60 * 60,
  });

  // ── TV show search ────────────────────────────────────────────────────────

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['tv-search', searchQuery],
    queryFn: () => tmdbApi.searchTVShows(searchQuery),
    enabled: searchQuery.length > 1,
    staleTime: 1000 * 60 * 5,
  });

  // ── Pinned show next episode ──────────────────────────────────────────────

  const { data: pinnedShowDetail, isLoading: pinnedLoading } = useQuery({
    queryKey: ['pinned-show', pinnedShow?.id],
    queryFn: () => tmdbApi.getTVDetail(pinnedShow!.id),
    enabled: !!pinnedShow,
    staleTime: 1000 * 60 * 30,
  });

  // ── Build entries ─────────────────────────────────────────────────────────

  const watchlistMovieIds = useMemo(
    () => new Set(watchlist.filter((w) => w.media_type === 'movie').map((w) => w.tmdb_id)),
    [watchlist]
  );

  const allEntries: CalendarEntry[] = useMemo(() => {
    const entries: CalendarEntry[] = [];
    const today = startOfToday();
    const cutoff = addYears(today, 1);

    // Build showId → episodes map from fetched season data
    const seasonEpMap = new Map<number, any[]>();
    for (const season of (seasonData ?? [])) {
      seasonEpMap.set(season.showId, season.episodes ?? []);
    }

    // TV shows — watchlist (isFromWatchlist=true) + Trakt history (false)
    const showSources = [
      ...(watchlistShowDetails ?? []).map((s: any) => ({ show: s, fromWatchlist: true })),
      ...(traktShowDetails ?? []).map((s: any) => ({ show: s, fromWatchlist: false })),
    ];
    const seenEpKeys = new Set<string>();

    for (const { show, fromWatchlist } of showSources) {
      const episodes = seasonEpMap.get(show.id);

      if (episodes?.length) {
        // Full season schedule
        for (const ep of episodes) {
          if (!ep.air_date) continue;
          let airDate: Date;
          try { airDate = parseISO(ep.air_date); } catch { continue; }
          if (isBefore(airDate, today) || isAfter(airDate, cutoff)) continue;
          const key = `${show.id}-S${ep.season_number}E${ep.episode_number}`;
          if (seenEpKeys.has(key)) continue;
          seenEpKeys.add(key);
          entries.push({
            id: key,
            tmdbId: show.id,
            mediaType: 'tv',
            title: show.name,
            posterPath: show.poster_path,
            airDate,
            note: `S${String(ep.season_number).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')} — ${ep.name ?? 'New episode'}`,
            isFromWatchlist: fromWatchlist,
            notifyEnabled: fromWatchlist ? true : !isUnfollowed(show.id),
          });
        }
      } else if (show.next_episode_to_air?.air_date) {
        // Fallback: season data not yet loaded / unavailable
        const next = show.next_episode_to_air;
        let airDate: Date;
        try { airDate = parseISO(next.air_date); } catch { continue; }
        if (isBefore(airDate, today) || isAfter(airDate, cutoff)) continue;
        const key = `${show.id}-S${next.season_number}E${next.episode_number}`;
        if (!seenEpKeys.has(key)) {
          seenEpKeys.add(key);
          entries.push({
            id: key,
            tmdbId: show.id,
            mediaType: 'tv',
            title: show.name,
            posterPath: show.poster_path,
            airDate,
            note: `S${String(next.season_number).padStart(2, '0')}E${String(next.episode_number).padStart(2, '0')} — ${next.name ?? 'New episode'}`,
            isFromWatchlist: fromWatchlist,
            notifyEnabled: fromWatchlist ? true : !isUnfollowed(show.id),
          });
        }
      }
    }

    // Movies — full year
    const seenMovieIds = new Set<number>();
    for (const m of (upcomingMoviesYear ?? [])) {
      if (!m.release_date || seenMovieIds.has(m.id)) continue;
      seenMovieIds.add(m.id);
      let airDate: Date;
      try { airDate = parseISO(m.release_date); } catch { continue; }
      if (isBefore(airDate, today) || isAfter(airDate, cutoff)) continue;
      entries.push({
        id: `movie-${m.id}`,
        tmdbId: m.id,
        mediaType: 'movie',
        title: m.title,
        posterPath: m.poster_path,
        airDate,
        note: 'In cinemas',
        isFromWatchlist: watchlistMovieIds.has(m.id),
        notifyEnabled: watchlistMovieIds.has(m.id) || isFollowed(m.id),
      });
    }

    return entries;
  }, [seasonData, watchlistShowDetails, traktShowDetails, upcomingMoviesYear, watchlistMovieIds, isFollowed, isUnfollowed]);

  // ── Filter sets ───────────────────────────────────────────────────────────

  const watchedShowTmdbIds = useMemo(() => {
    return new Set(
      (traktWatchedShows ?? []).map((s) => s.show.ids.tmdb).filter((id): id is number => !!id)
    );
  }, [traktWatchedShows]);

  const watchlistTvIdSet = useMemo(
    () => new Set(watchlistShowIds),
    [watchlistShowIds]
  );

  const anticipatedEntries = useMemo(() => {
    const cutoff = addYears(today, 1);
    const seenKeys = new Set<string>();
    const entries: CalendarEntry[] = [];
    for (const item of (anticipatedRaw ?? [])) {
      const isMovie = item._mediaType === 'movie';
      const dateStr = isMovie ? item.release_date : item.first_air_date;
      const title = isMovie ? item.title : item.name;
      const key = `${item._mediaType}-${item.id}`;
      if (!dateStr || !title || seenKeys.has(key)) continue;
      seenKeys.add(key);
      let airDate: Date;
      try { airDate = parseISO(dateStr); } catch { continue; }
      if (isBefore(airDate, today) || isAfter(airDate, cutoff)) continue;
      entries.push({
        id: isMovie ? `movie-${item.id}` : `anticipated-tv-${item.id}`,
        tmdbId: item.id,
        mediaType: item._mediaType,
        title,
        posterPath: item.poster_path,
        airDate,
        note: 'Highly anticipated',
        isFromWatchlist: isMovie ? watchlistMovieIds.has(item.id) : false,
        notifyEnabled: watchlistMovieIds.has(item.id) || isFollowed(item.id),
      });
    }
    return entries;
  }, [anticipatedRaw, watchlistMovieIds, isFollowed, isUnfollowed, today]);

  const watchingTvIdSet = useMemo(
    () => new Set([...watchlistShowIds, ...traktShowTmdbIds]),
    [watchlistShowIds, traktShowTmdbIds]
  );

  const forYouEntries = useMemo(() => {
    const cutoff = addYears(today, 1);
    const seenKeys = new Set<string>();
    const entries: CalendarEntry[] = [];
    for (const item of (forYouRaw ?? [])) {
      const isMovie = item._mediaType === 'movie';
      const dateStr = isMovie ? item.release_date : item.first_air_date;
      const title = isMovie ? item.title : item.name;
      const key = `${item._mediaType}-${item.id}`;
      if (!dateStr || !title || seenKeys.has(key)) continue;
      if (!isMovie && watchingTvIdSet.has(item.id)) continue;
      seenKeys.add(key);
      let airDate: Date;
      try { airDate = parseISO(dateStr); } catch { continue; }
      if (isBefore(airDate, today) || isAfter(airDate, cutoff)) continue;
      entries.push({
        id: isMovie ? `movie-${item.id}` : `forYou-tv-${item.id}`,
        tmdbId: item.id,
        mediaType: item._mediaType,
        title,
        posterPath: item.poster_path,
        airDate,
        note: 'Based on your taste',
        isFromWatchlist: isMovie ? watchlistMovieIds.has(item.id) : false,
        notifyEnabled: watchlistMovieIds.has(item.id) || isFollowed(item.id),
      });
    }
    return entries;
  }, [forYouRaw, watchlistMovieIds, watchingTvIdSet, isFollowed, today]);

  const toggleWatching = () => {
    if (showWatching && !showNewMovies && !showAnticipated && !showForYou) return;
    setShowWatching((v) => !v);
  };
  const toggleNewMovies = () => {
    if (showNewMovies && !showWatching && !showAnticipated && !showForYou) return;
    setShowNewMovies((v) => !v);
  };
  const toggleAnticipated = () => {
    if (showAnticipated && !showWatching && !showNewMovies && !showForYou) return;
    setShowAnticipated((v) => !v);
  };
  const toggleForYou = () => {
    if (showForYou && !showWatching && !showNewMovies && !showAnticipated) return;
    setShowForYou((v) => !v);
  };

  const filteredEntries = useMemo(() => {
    const isRecent = (e: CalendarEntry) =>
      isAfter(e.airDate, addDays(today, -1)) || isSameDay(e.airDate, today);

    const results: CalendarEntry[] = [];
    const seenMovieIds = new Set<number>();
    const seenEpKeys = new Set<string>();

    const add = (entries: CalendarEntry[]) => {
      for (const e of entries) {
        if (!isRecent(e)) continue;
        if (e.mediaType === 'movie') {
          if (seenMovieIds.has(e.tmdbId)) continue;
          seenMovieIds.add(e.tmdbId);
        } else {
          if (seenEpKeys.has(e.id)) continue;
          seenEpKeys.add(e.id);
        }
        results.push(e);
      }
    };

    if (showWatching) {
      add(allEntries.filter(
        (e) => e.mediaType === 'tv' && (watchedShowTmdbIds.has(e.tmdbId) || watchlistTvIdSet.has(e.tmdbId))
      ));
    }
    if (showNewMovies) {
      add(allEntries.filter((e) => e.mediaType === 'movie'));
    }
    if (showAnticipated) {
      add(anticipatedEntries);
    }
    if (showForYou) {
      add(forYouEntries);
    }

    return results;
  }, [allEntries, anticipatedEntries, forYouEntries, today, showWatching, showNewMovies, showAnticipated, showForYou, watchedShowTmdbIds, watchlistTvIdSet]);

  const sections = useMemo(() => groupByDate(filteredEntries), [filteredEntries]);

  const handleShowSelect = useCallback((show: any) => {
    setPinnedShow({ id: show.id, name: show.name });
    setSearchQuery('');
    setSearchActive(false);
  }, []);

  const isLoading = moviesLoading || traktShowsLoading || seasonsLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Calendar</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/(tabs)/search')}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter buttons */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterBtn, showWatching && styles.filterBtnActive]}
          onPress={toggleWatching}
          activeOpacity={0.8}
        >
          <Ionicons name="eye-outline" size={14} color={showWatching ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.filterBtnText, showWatching && styles.filterBtnTextActive]}>Watching</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterBtn, showNewMovies && styles.filterBtnActive]}
          onPress={toggleNewMovies}
          activeOpacity={0.8}
        >
          <Ionicons name="film-outline" size={14} color={showNewMovies ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.filterBtnText, showNewMovies && styles.filterBtnTextActive]}>New Movies</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterBtn, showAnticipated && styles.filterBtnActive]}
          onPress={toggleAnticipated}
          activeOpacity={0.8}
        >
          <Ionicons name="flame-outline" size={14} color={showAnticipated ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.filterBtnText, showAnticipated && styles.filterBtnTextActive]}>Most Anticipated</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterBtn, showForYou && styles.filterBtnActive]}
          onPress={toggleForYou}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles-outline" size={14} color={showForYou ? Colors.background : Colors.textSecondary} />
          <Text style={[styles.filterBtnText, showForYou && styles.filterBtnTextActive]}>For You</Text>
        </TouchableOpacity>
      </View>

      {/* Show search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={(t) => { setSearchQuery(t); setSearchActive(true); }}
            onFocus={() => setSearchActive(true)}
            placeholder="Search a TV show for episode dates..."
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.primary}
            returnKeyType="search"
          />
          {(searchQuery.length > 0 || pinnedShow) && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setPinnedShow(null); setSearchActive(false); }}>
              <Ionicons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {searchActive && searchQuery.length > 1 && (
          <View style={styles.searchDropdown}>
            {searchLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ padding: 12 }} />
            ) : (
              <FlatList
                data={(searchResults ?? []).slice(0, 6)}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <ShowSearchResult show={item} onPress={() => handleShowSelect(item)} />
                )}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
        )}
      </View>

      {/* Pinned show next episode */}
      {pinnedShow && (
        <View style={styles.pinnedCard}>
          {pinnedLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : pinnedShowDetail?.next_episode_to_air ? (
            <>
              <Text style={styles.pinnedTitle}>{pinnedShow.name}</Text>
              <Text style={styles.pinnedEp}>
                S{String(pinnedShowDetail.next_episode_to_air.season_number).padStart(2, '0')}
                E{String(pinnedShowDetail.next_episode_to_air.episode_number).padStart(2, '0')}
                {' — '}{pinnedShowDetail.next_episode_to_air.name ?? 'New episode'}
              </Text>
              <Text style={styles.pinnedDate}>
                {format(parseISO(pinnedShowDetail.next_episode_to_air.air_date), 'EEEE, MMMM d, yyyy')}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.pinnedTitle}>{pinnedShow.name}</Text>
              <Text style={styles.pinnedEp}>No upcoming episodes scheduled</Text>
            </>
          )}
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : sections.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {showForYou && topGenreIds.length === 0
              ? 'No taste data yet'
              : !hasTrakt && showWatching && !showNewMovies && !showAnticipated && !showForYou
              ? 'Connect Trakt to see your shows'
              : 'Nothing scheduled'}
          </Text>
          <Text style={styles.emptyText}>
            {showForYou && topGenreIds.length === 0
              ? 'Add shows to your watchlist or connect Trakt so we can match your taste.'
              : !hasTrakt && showWatching && !showNewMovies && !showAnticipated && !showForYou
              ? 'Go to Settings → Trakt to connect your account.'
              : 'No upcoming releases for the selected filters.'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section: { title, isTonight } }) => (
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionHeaderText, isTonight && styles.sectionHeaderTonight]}>
                {title}
              </Text>
            </View>
          )}
          renderItem={({ item, section }) => <CalendarCard entry={item} isTonight={section.isTonight} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xl,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  subtitle: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    gap: 6, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, paddingHorizontal: 14, paddingVertical: 7,
  },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterBtnText: { ...Typography.label, color: Colors.textMuted, fontWeight: '600' },
  filterBtnTextActive: { color: Colors.background },
  searchWrap: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm, zIndex: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 10, gap: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.body, color: Colors.text },
  searchDropdown: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4, maxHeight: 280, overflow: 'hidden',
  },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.sm,
    gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchResultPoster: { width: 40, height: 56, borderRadius: 4, backgroundColor: Colors.surfaceElevated },
  searchResultInfo: { flex: 1 },
  searchResultTitle: { ...Typography.body, color: Colors.text, fontWeight: '600' },
  searchResultYear: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
  pinnedCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    backgroundColor: Colors.primary + '15', borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.primary + '40', padding: Spacing.md, gap: 4,
  },
  pinnedTitle: { ...Typography.subheading, color: Colors.primary, fontWeight: '700' },
  pinnedEp: { ...Typography.body, color: Colors.text },
  pinnedDate: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: 32 },
  sectionHeader: { paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  sectionHeaderText: { ...Typography.heading, color: Colors.text },
  sectionHeaderTonight: { color: '#f59e0b' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  cardHighlighted: { borderColor: Colors.primary + '50', backgroundColor: Colors.primary + '08' },
  cardPoster: { width: 52, height: 74, backgroundColor: Colors.surfaceElevated },
  cardInfo: { flex: 1, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.subheading, color: Colors.text, flex: 1 },
  tonightBadge: {
    backgroundColor: '#f59e0b22', borderRadius: BorderRadius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tonightBadgeText: { fontSize: 10, fontWeight: '700', color: '#f59e0b' },
  cardNote: { ...Typography.caption, color: Colors.primary, fontWeight: '600' },
  cardDate: { ...Typography.caption, color: Colors.textMuted },
  cardRight: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginRight: Spacing.md,
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: Spacing.md,
  },
  emptyTitle: { ...Typography.heading, color: Colors.textSecondary },
  emptyText: { ...Typography.body, color: Colors.textMuted, textAlign: 'center', lineHeight: 22 },
});
