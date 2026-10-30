import { useCallback } from 'react';
import { getCoWCalendar } from './api';
import type { CoWCalendarWire } from './cow-wire';
import { useGroupOnlinePages } from './use-group-online-pages';
const items = (): never[] => [];
const cursor = () => null;
const hasMore = () => false;
const itemKey = () => '';

/** Calendar definitions stay online; the bounded summary owns offline selection. */
export function useCoWCalendar(groupId: string, userId: string) {
  const fetchPage = useCallback(() => getCoWCalendar(groupId), [groupId]);
  return useGroupOnlinePages<CoWCalendarWire, never, string>({ userId, groupId, viewKey: 'cow-calendar',
    fetchPage, selectItems: items, selectCursor: cursor, selectHasMore: hasMore, itemKey });
}
