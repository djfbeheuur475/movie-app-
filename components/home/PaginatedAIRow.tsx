import { useState, useCallback, useMemo } from 'react';
import ContentRow from './ContentRow';
import { getListItemsPage } from '../../lib/trakt';
import { tmdbApi, normalizeMovie, normalizeTVShow } from '../../lib/tmdb';
import { hasGoodMetadata } from '../../lib/quality';
import type { ContentItem } from '../../types';

interface Props {
  title: string;
  subtitle?: string;
  initialItems: ContentItem[];
  // The Trakt list this row's initial items came from — lets us fetch further
  // pages of the same list for continuous scroll. Null for rows with no
  // backing list (e.g. the new-user/thematic fallback), which just show
  // their fixed initial items with no "load more".
  traktListId: number | null;
}

// The server already consumed page 1 (up to 80 raw candidates, limit=30 shown)
// building the initial row, so client-side pagination starts one page further
// in to minimise refetching titles the server already looked at.
const START_PAGE = 3;
const PAGE_LIMIT = 30;

export default function PaginatedAIRow({ title, subtitle, initialItems, traktListId }: Props) {
  const [extraItems, setExtraItems] = useState<ContentItem[]>([]);
  const [page, setPage] = useState(START_PAGE);
  const [hasMore, setHasMore] = useState(traktListId !== null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const allItems = useMemo(() => [...initialItems, ...extraItems], [initialItems, extraItems]);
  const seenIds = useMemo(() => new Set(allItems.map((i) => i.id)), [allItems]);

  const loadMore = useCallback(async () => {
    if (!traktListId || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const { items: listItems, pageCount } = await getListItemsPage(traktListId, page, PAGE_LIMIT);

      const candidates = listItems
        .map((i) => ({
          mediaType: i.type === 'movie' ? ('movie' as const) : ('tv' as const),
          tmdbId: (i.type === 'movie' ? i.movie : i.show)?.ids.tmdb,
        }))
        .filter((c): c is { mediaType: 'movie' | 'tv'; tmdbId: number } => !!c.tmdbId && !seenIds.has(c.tmdbId));

      const enriched = await Promise.allSettled(
        candidates.map((c) =>
          c.mediaType === 'movie'
            ? tmdbApi.getMovieBasic(c.tmdbId).then(normalizeMovie)
            : tmdbApi.getTVBasic(c.tmdbId).then(normalizeTVShow)
        )
      );
      const newItems = enriched
        .filter((r): r is PromiseFulfilledResult<ContentItem> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter(hasGoodMetadata);

      setExtraItems((prev) => [...prev, ...newItems]);
      setHasMore(page < pageCount);
      setPage((p) => p + 1);
    } catch {
      setHasMore(false); // stop retrying a broken page rather than looping forever
    } finally {
      setIsLoadingMore(false);
    }
  }, [traktListId, page, isLoadingMore, hasMore, seenIds]);

  return (
    <ContentRow
      title={`✦ ${title}`}
      subtitle={subtitle}
      items={allItems}
      isLoading={false}
      isLoadingMore={isLoadingMore}
      onEndReached={hasMore ? loadMore : undefined}
      showRating
      accent
    />
  );
}
