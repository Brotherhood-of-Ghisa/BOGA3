import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeProgressMuscleTickers, type ProgressMuscleTickers } from '@/src/data';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { encodeGymRouteParam } from '@/src/utils/gym-scope-route';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { deriveMuscleReportPreset } from '@/src/data/muscle-report-settings';
import { effectiveMuscleTargetOverrides } from '@/src/preferences/muscle-targets';

// Only Muscle List reads; table period/metric choices cannot alter its history.
export function useMuscleTickers(enabled: boolean, gymId?: string | null, countSecondary = true) {
  const { values, accountRevision } = useAccountLocalPreferenceState();
  const catalog = useExerciseCatalog();
  const scope = deriveMuscleReportPreset(catalog.muscleGroups);
  const weeklyTargets = effectiveMuscleTargetOverrides(values, scope);
  const targetsReady = values.muscleTargetMode !== 'per-muscle' || catalog.status === 'ready';
  const revision = useBodyWeightContextRevision();
  const { historyLookbackWeeks, targetWindowWeeks, weeklyWorkingSetTarget } = values;
  const key = `${accountRevision}:${revision}:${encodeGymRouteParam(gymId) ?? ''}:${countSecondary}:${historyLookbackWeeks}:${targetWindowWeeks}:${weeklyWorkingSetTarget}:${scope}:${JSON.stringify(weeklyTargets)}`;
  const [loaded, setLoaded] = useState<{ key: string; data: ProgressMuscleTickers } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!enabled || !targetsReady) return;
    let active = true;
    setFailed(null);
    void computeProgressMuscleTickers({ historyWeeks: historyLookbackWeeks, rollingWeeks: targetWindowWeeks,
      weeklyTarget: weeklyWorkingSetTarget, gymId, ...(countSecondary ? {} : { countSecondary }),
      ...(values.muscleTargetMode === 'per-muscle' ? { weeklyTargets } : {}) }).then(data => {
      if (active) setLoaded({ key, data });
    }).catch(() => { if (active) setFailed(key); });
    return () => { active = false; };
  }, [enabled, targetsReady, key, gymId, countSecondary, historyLookbackWeeks, targetWindowWeeks, weeklyWorkingSetTarget, values.muscleTargetMode, weeklyTargets]));
  const failedCatalog = values.muscleTargetMode === 'per-muscle' && catalog.status === 'error';
  return { data: targetsReady && failed !== key && loaded?.key === key ? loaded.data : null,
    status: failedCatalog || failed === key ? 'error' as const : targetsReady && loaded?.key === key ? 'loaded' as const : 'pending' as const };
}
