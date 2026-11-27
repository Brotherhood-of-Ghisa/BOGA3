import { useCallback, useEffect, useState } from 'react';
import { getMeet, listMeets } from './api';
import { groupCacheKeys } from './cache';
import { useGroupResource } from './use-group-resource';

export function useMeets(groupId: string, userId: string) {
  const fetcher = useCallback(() => listMeets(groupId), [groupId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.meets(groupId), fetcher, evictGroupIdOnNotFound: groupId });
}
export function useMeet(groupId: string, meetId: string | null, userId: string) {
  const fetcher = useCallback(() => getMeet(groupId, meetId!), [groupId, meetId]);
  return useGroupResource({ userId, cacheKey: meetId ? groupCacheKeys.meet(groupId, meetId) : null, fetcher, evictGroupIdOnNotFound: groupId });
}
/** Cached lifecycle labels and permitted controls move even without a successful network refresh. */
export function useMeetClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
