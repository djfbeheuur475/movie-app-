import { createContext, useContext } from 'react';
import type { MediaType } from '../types';

// The Home screen's Movies / TV toggle. Rows read it from context and filter
// their own items, so it doesn't need threading through every row's props.
// Screens that don't provide it (Discover, search…) get 'all' — unfiltered.
export type MediaFilter = 'all' | MediaType;

export const MediaFilterContext = createContext<MediaFilter>('all');

export const useMediaFilter = () => useContext(MediaFilterContext);

export function filterByMedia<T extends { mediaType: MediaType }>(items: T[], filter: MediaFilter): T[] {
  return filter === 'all' ? items : items.filter((i) => i.mediaType === filter);
}
