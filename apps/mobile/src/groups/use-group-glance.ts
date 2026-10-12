import { useCallback, useEffect, useState } from 'react';

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
  /**
   * The periods to draw, oldest first: the read for exactly the windows in
   * view, or — while that read is still loading after a step or a week/month
   * switch — the group's last shown series (`held`). Null when neither.
   */
  series: GroupHomeWindow[] | null;
  /** Set when `series` is that earlier read: the period and offset it is for. */
  held: GroupGlanceHeld | null;
};

export type GroupGlanceHeld = { period: GroupHomePeriod; offset: number };

type ShownSeries = GroupGlanceHeld & { scope: string; data: CompetitionPeriodTotalsWire; series: GroupHomeWindow[] };

/**
 * At a glance's read: one `group_competition_period_totals` call for the
 * period at `offset` and the five before it, cache-first like every group read
 * (one entry per period and offset). A null `groupId` reads nothing. A cached
 * read for other windows (the week has turned over since) is never shown and
 * is refreshed at once. A step to periods not yet read keeps the last series
 * on screen until their read lands or fails, so the page never drops to its
 * loading state between two reads of the same group.
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

  // The last series shown for this user and group, remembered as each read lands.
  const scope = groupId ? `${userId}\u0000${groupId}` : null;
  const [shown, setShown] = useState<ShownSeries | null>(null);
  if (scope && resource.data && series && (shown?.data !== resource.data || shown.scope !== scope)) {
    setShown({ scope, data: resource.data, series, period, offset });
  }

  // Each stale payload that lands asks once more: a refresh already in flight
  // when the period turned over still carries the old windows. It cannot loop,
  // since the next request is built from the windows now in view.
  const stale = resource.data !== null && series === null;
  const refresh = resource.refresh;
  const landedAtMs = resource.lastUpdatedAtMs;
  useEffect(() => {
    if (stale) void refresh();
  }, [stale, refresh, currentStartMs, landedAtMs]);

  // Held only while the read in view can still land: a failure, or offline
  // with nothing cached, shows its own state rather than the old figures.
  const loading = resource.error === null && !resource.offline && (stale || !resource.hydrated || resource.refreshing);
  const held = series === null && loading && shown !== null && shown.scope === scope ? shown : null;

  return { resource, series: series ?? held?.series ?? null, held: held && { period: held.period, offset: held.offset } };
}
