import { useCallback, useEffect, useRef, useState } from 'react';

import { deriveMuscleReportPreset } from '@/src/data/muscle-report-settings';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { effectiveMuscleTargetOverrides } from '@/src/preferences/muscle-targets';
import { loadTodayPlan, type TodayPlan, type TodayPlanOptions } from '@/src/today-plan';

import { useDailyReread } from './use-daily-reread';

/** Reads the Plan page at `now`, against Settings' weekly targets and secondary sets. */
export type TodayPlanLoader = (now: Date, options: TodayPlanOptions) => Promise<TodayPlan>;

export type TodayPlanState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; plan: TodayPlan };

export type UseTodayPlanInput = {
  isFocused: boolean;
  load?: TodayPlanLoader;
  now?: () => Date;
};

const systemNow = () => new Date();

/**
 * The Plan page's read, again on every focus, at local midnight, on return to
 * the foreground and when a weekly target or the secondary-set default changes.
 * Per-muscle targets ([[muscle.weekly-targets]]) wait for the catalogue, which
 * names the muscle setup they belong to.
 * The first read shows loading; a re-read keeps the page until it lands.
 */
export function useTodayPlan({ isFocused, load = loadTodayPlan, now = systemNow }: UseTodayPlanInput) {
  const { accountRevision: context, values } = useAccountLocalPreferenceState();
  const { weeklyWorkingSetTarget: weeklyTarget, progressCountSecondary: countSecondary } = values;
  const catalog = useExerciseCatalog();
  const perMuscle = values.muscleTargetMode === 'per-muscle';
  const overrides = effectiveMuscleTargetOverrides(values, deriveMuscleReportPreset(catalog.muscleGroups));
  const overridesKey = JSON.stringify(overrides);
  const targetsReady = !perMuscle || catalog.status === 'ready';
  const [result, setResult] = useState<{ context: number; state: TodayPlanState }>({ context, state: { status: 'loading' } });
  const generationRef = useRef(0);
  const loadRef = useRef(load);
  const nowRef = useRef(now);
  useEffect(() => {
    loadRef.current = load;
    nowRef.current = now;
  });

  // The overrides travel as their JSON, so a new object with the same targets never reads again.
  const read = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () => generationRef.current === generation;
    return loadRef.current(nowRef.current(), { weeklyTarget, overrides: JSON.parse(overridesKey) as Record<string, number>, countSecondary }).then(
      (plan) => {
        if (isCurrent()) setResult({ context, state: { status: 'loaded', plan } });
      },
      (error: unknown) => {
        if (isCurrent()) {
          setResult({ context, state: { status: 'error', message: error instanceof Error ? error.message : 'Unable to load your plan' } });
        }
      },
    );
  }, [context, weeklyTarget, overridesKey, countSecondary]);

  const readNow = useCallback(() => {
    if (targetsReady) void read();
  }, [read, targetsReady]);

  // A catalogue that failed is loaded again; once it is ready the targets change and the page reads.
  const retry = useCallback(() => {
    setResult({ context, state: { status: 'loading' } });
    return targetsReady ? read() : ensureExerciseCatalogLoaded();
  }, [read, context, targetsReady]);

  useDailyReread(isFocused, readNow, nowRef, generationRef);

  const state: TodayPlanState = perMuscle && catalog.status === 'error'
    ? { status: 'error', message: catalog.lastError ?? 'Unable to load your muscle targets' }
    : result.context === context ? result.state : { status: 'loading' };
  return { state, retry };
}
