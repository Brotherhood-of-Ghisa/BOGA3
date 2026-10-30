import { useCallback, useEffect, useState } from 'react';
import { getCoWSummary } from './api';
import { groupCacheKeys } from './cache';
import { coWSummaryExpiresAt } from './cow-wire';
import { useGroupResource } from './use-group-resource';

/** An offline card expires at its server-selected edge; it never relabels itself as a final. */
export function useCoWSummary(groupId: string | null, userId: string | null) {
  const fetcher = useCallback(() => getCoWSummary(groupId!), [groupId]);
  const resource = useGroupResource({ userId, cacheKey: groupId ? groupCacheKeys.cowSummary(groupId) : null,
    fetcher, evictGroupIdOnNotFound: groupId });
  const [now, setNow] = useState(() => Date.now());
  const refresh = resource.refresh;
  const unset = resource.data?.week_start === null && resource.data.selection === 'none';
  const deadline = !unset && resource.data && resource.lastUpdatedAtMs !== null
    ? coWSummaryExpiresAt(resource.data, resource.lastUpdatedAtMs) : null;
  useEffect(() => {
    if (deadline === null) return;
    const delay = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => { setNow(Date.now()); void refresh(); }, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [deadline, refresh]);
  const observedNow = Math.max(now, resource.lastUpdatedAtMs ?? now);
  return { ...resource, data: deadline !== null && observedNow < deadline ? resource.data : null };
}
