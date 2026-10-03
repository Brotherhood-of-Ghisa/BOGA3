import { useCallback, useEffect, useReducer } from 'react';

import { useAuth } from '@/src/auth';
import {
  getGroupWeekSummary,
  getLastViewedGroupId,
  groupCacheKeys,
  listMyGroups,
  resolveSelectedGroupId,
  setLastViewedGroupId,
  useGroupResource,
  type GroupApiError,
  type GroupListMineResult,
  type GroupSummary,
  type GroupWeekSummaryResult,
} from '@/src/groups';
import { localWeekWindow } from '@/src/utils/local-calendar';

/** The cached week read, stamped with its window so last week's board never shows as this week's. */
export type TodayGroupWeek = { windowStartMs: number; summary: GroupWeekSummaryResult };

export type TodayGroupState =
  | { status: 'auth-unavailable' }
  | { status: 'signed-out' }
  | {
      status: 'available';
      myUserId: string;
      /** My groups; null until the list first loads. */
      groups: GroupSummary[] | null;
      selectedGroupId: string | null;
      selectGroup: (groupId: string) => void;
      /** This week's summary for the selected group; null until it is read. */
      summary: GroupWeekSummaryResult | null;
      offline: boolean;
      error: GroupApiError | null;
      lastUpdatedAtMs: number | null;
      refresh: () => Promise<void>;
    };

const systemNow = () => new Date();

/**
 * Today's group read: My groups, then one `group_week_summary` for the
 * selected group over this local week, both cache-first. The selection is the
 * Groups screen's (last viewed, else the first group), so picking a group on
 * either screen moves both.
 */
export function useTodayGroup(now: () => Date = systemNow): TodayGroupState {
  const { isConfigured, user } = useAuth();
  const userId = isConfigured ? (user?.id ?? null) : null;

  const mine = useGroupResource<GroupListMineResult>({ userId, cacheKey: groupCacheKeys.mine, fetcher: listMyGroups });
  const groups = mine.data?.groups ?? null;

  // The selection lives in `last-viewed-group`; a pick re-renders to read it.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const selectedGroupId = groups ? resolveSelectedGroupId(groups, getLastViewedGroupId()) : null;
  useEffect(() => {
    if (selectedGroupId) setLastViewedGroupId(selectedGroupId);
  }, [selectedGroupId]);
  const selectGroup = useCallback((groupId: string) => {
    setLastViewedGroupId(groupId);
    rerender();
  }, []);

  const window = localWeekWindow(now());
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const fetcher = useCallback(
    async (): Promise<TodayGroupWeek> => ({
      windowStartMs,
      summary: await getGroupWeekSummary({ groupId: selectedGroupId ?? '', windowStartMs, windowEndMs }),
    }),
    [selectedGroupId, windowStartMs, windowEndMs],
  );
  const week = useGroupResource<TodayGroupWeek>({
    userId,
    cacheKey: selectedGroupId ? groupCacheKeys.weekSummary(selectedGroupId) : null,
    fetcher,
    evictGroupIdOnNotFound: selectedGroupId,
  });

  // Lost access to the selected group: re-read My groups so the selection moves on.
  const refreshMine = mine.refresh;
  useEffect(() => {
    if (week.lostAccess) void refreshMine();
  }, [week.lostAccess, refreshMine]);

  const refreshWeek = week.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshMine(), refreshWeek()]);
  }, [refreshMine, refreshWeek]);

  if (!isConfigured) return { status: 'auth-unavailable' };
  if (!userId) return { status: 'signed-out' };

  const current = week.data?.windowStartMs === windowStartMs ? week.data : null;
  return {
    status: 'available',
    myUserId: userId,
    groups,
    selectedGroupId,
    selectGroup,
    summary: current?.summary ?? null,
    offline: mine.offline || week.offline,
    // A lost group is not an error to show: My groups re-reads and the selection moves on.
    error: mine.error ?? (week.lostAccess ? null : week.error),
    lastUpdatedAtMs: (current ? week.lastUpdatedAtMs : null) ?? mine.lastUpdatedAtMs,
    refresh,
  };
}
