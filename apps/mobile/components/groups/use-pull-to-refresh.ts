import { useCallback, useState } from 'react';

/**
 * `RefreshControl` state for a user pull. Only the pull shows the spinner:
 * focus and 30 s poll refreshes run silently (ux-rules §6).
 */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [pulling, setPulling] = useState(false);
  const onRefresh = useCallback(() => {
    setPulling(true);
    void refresh().finally(() => setPulling(false));
  }, [refresh]);
  return { pulling, onRefresh };
}
