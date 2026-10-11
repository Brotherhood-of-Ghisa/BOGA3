import { useCallback, useEffect } from 'react';

import { getCompetitionPeriodTotals } from './api';
import { groupCacheKeys } from './cache';
import type { CompetitionPeriodTotalsWire } from './competition-wire';
import {
  groupHomeSeriesWindows,
  groupHomeWindowFor,
  readGroupHomeSeries,
  toCompetitionPeriodWindows,
  type GroupHomePeriod,
  type GroupHomeWindow,
} from './home-periods';
import { useGroupResource, type GroupResourceState } from './use-group-resource';

export type GroupGlanceState = {
  resource: GroupResourceState<CompetitionPeriodTotalsWire>;
  /** The periods in view, oldest first; null until a read for exactly these windows lands. */
  series: GroupHomeWindow[] | null;
};

/**
 * At a glance's read: one `group_competition_period_totals` call for the
 * period at `offset` and the five before it, cache-first like every group read
 * (one entry per period and offset). A null `groupId` reads nothing. A cached
 * read for other windows (the week has turned over since) is never shown and
 * is refreshed at once.
 */
export function useGroupGlance({
  userId,
  groupId,
  period,
  offset,
  now,
}: {
  userId: string;
  groupId: string | null;
  period: GroupHomePeriod;
  offset: number;
  now: Date;
}): GroupGlanceState {
  const windows = groupHomeSeriesWindows({ period, offset, now });
  // The windows depend on `now` only through the period it falls in, so the
  // fetcher keys on that period's start: a new `now` in the same week keeps it.
  const currentStartMs = groupHomeWindowFor(period, now, 0).start.getTime();
  const fetcher = useCallback(
    () =>
      getCompetitionPeriodTotals(
        groupId ?? '',
        toCompetitionPeriodWindows(groupHomeSeriesWindows({ period, offset, now: new Date(currentStartMs) })),
      ),
    [groupId, period, offset, currentStartMs],
  );
  const resource = useGroupResource<CompetitionPeriodTotalsWire>({
    userId,
    cacheKey: groupId ? groupCacheKeys.glance(groupId, period, offset) : null,
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const series = resource.data ? readGroupHomeSeries({ totals: resource.data, windows, myUserId: userId }) : null;

  // Each stale payload that lands asks once more: a refresh already in flight
  // when the period turned over still carries the old windows. It cannot loop,
  // since the next request is built from the windows now in view.
  const stale = resource.data !== null && series === null;
  const refresh = resource.refresh;
  const landedAtMs = resource.lastUpdatedAtMs;
  useEffect(() => {
    if (stale) void refresh();
  }, [stale, refresh, currentStartMs, landedAtMs]);

  return { resource, series };
}
