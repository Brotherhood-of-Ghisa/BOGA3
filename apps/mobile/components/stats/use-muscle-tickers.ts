import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeProgressMuscleTickers, type ProgressMuscleTickers } from '@/src/data';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { encodeGymRouteParam } from '@/src/utils/gym-scope-route';

// Only Muscle List reads; table period/metric choices cannot alter its history.
export function useMuscleTickers(enabled: boolean, gymId?: string | null) {
  const { values, accountRevision } = useAccountLocalPreferenceState();
  const revision = useBodyWeightContextRevision();
  const { historyLookbackWeeks, targetWindowWeeks, weeklyWorkingSetTarget } = values;
  const key = `${accountRevision}:${revision}:${encodeGymRouteParam(gymId) ?? ''}:${historyLookbackWeeks}:${targetWindowWeeks}:${weeklyWorkingSetTarget}`;
  const [loaded, setLoaded] = useState<{ key: string; data: ProgressMuscleTickers } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    let active = true;
    setFailed(null);
    void computeProgressMuscleTickers({ historyWeeks: historyLookbackWeeks, rollingWeeks: targetWindowWeeks,
      weeklyTarget: weeklyWorkingSetTarget, gymId }).then(data => {
      if (active) setLoaded({ key, data });
    }).catch(() => { if (active) setFailed(key); });
    return () => { active = false; };
  }, [enabled, key, gymId, historyLookbackWeeks, targetWindowWeeks, weeklyWorkingSetTarget]));
  return { data: failed !== key && loaded?.key === key ? loaded.data : null,
    status: failed === key ? 'error' as const : loaded?.key === key ? 'loaded' as const : 'pending' as const };
}
