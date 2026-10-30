import { useCallback } from 'react';
import { getCoW } from './api';
import type { CoWWriteWire } from './cow-wire';
import { useGroupOnlinePages } from './use-group-online-pages';
const items = (): never[] => [];
const cursor = () => null;
const hasMore = () => false;
const itemKey = () => '';

export function useCoWDefinition(groupId: string, cowId: string | null, userId: string) {
  const fetchPage = useCallback(() => getCoW(groupId, cowId!), [groupId, cowId]);
  return useGroupOnlinePages<CoWWriteWire, never, string>({ userId, groupId, viewKey: cowId ? `cow:${cowId}` : null,
    fetchPage, selectItems: items, selectCursor: cursor, selectHasMore: hasMore, itemKey });
}
