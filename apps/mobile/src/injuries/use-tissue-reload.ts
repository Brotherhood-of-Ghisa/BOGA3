import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { InjuryView } from '@/src/data/injuries';
import { subscribeToInjuries } from '@/src/data/injury-invalidation';
import { collectMuscleSetContributions } from '@/src/data/muscle-analytics';
import { createDrizzleStatsStore } from '@/src/data/stats';
import { localWeekWindow } from '@/src/utils/local-calendar';
import {
  computeAllTissueReloadMetrics,
  RELOAD_BASELINE_WINDOW_DAYS,
  type TissueReloadMetrics,
} from './tissue-reload';

const statsStore = createDrizzleStatsStore();

export function useTissueReloadMetrics(
  activeInjuries?: readonly InjuryView[],
  providedMetrics?: readonly TissueReloadMetrics[],
  options: { now?: Date } = {}
): readonly TissueReloadMetrics[] {
  const [metrics, setMetrics] = useState<readonly TissueReloadMetrics[]>([]);
  const latestRequest = useRef(0);

  const injuryKey = activeInjuries
    ? activeInjuries.map(i => `${i.id}:${i.status}:${i.startedAt.getTime()}`).join('|')
    : '';

  const liveInjuries = useMemo(
    () => (activeInjuries ?? []).filter(i => i.status !== 'resolved'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [injuryKey]
  );

  const reload = useCallback(() => {
    if (providedMetrics !== undefined) {
      return;
    }

    const requestId = ++latestRequest.current;

    if (liveInjuries.length === 0) {
      void Promise.resolve().then(() => {
        if (latestRequest.current === requestId) {
          setMetrics(prev => (prev.length === 0 ? prev : []));
        }
      });
      return;
    }

    const now = options.now ?? new Date();

    // Find earliest startedAt among live injuries
    let earliestStartedAt = liveInjuries[0].startedAt.getTime();
    for (const injury of liveInjuries) {
      if (injury.startedAt.getTime() < earliestStartedAt) {
        earliestStartedAt = injury.startedAt.getTime();
      }
    }

    const windowDaysMs = RELOAD_BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const start = new Date(earliestStartedAt - windowDaysMs);
    const end = localWeekWindow(now).end;

    void statsStore
      .loadAggregationInput({ start, end, now })
      .then(input => {
        if (latestRequest.current !== requestId) return;
        const contributions = collectMuscleSetContributions({
          ...input,
          includeRehabSets: true,
        });
        const computed = computeAllTissueReloadMetrics(contributions, liveInjuries, now);
        setMetrics(computed);
      })
      .catch(() => {
        if (latestRequest.current !== requestId) return;
        setMetrics(prev => (prev.length === 0 ? prev : []));
      });
  }, [liveInjuries, providedMetrics, options.now]);

  useEffect(() => {
    reload();
    return subscribeToInjuries(() => {
      reload();
    });
  }, [reload]);

  if (providedMetrics !== undefined) {
    return providedMetrics;
  }

  return metrics;
}
