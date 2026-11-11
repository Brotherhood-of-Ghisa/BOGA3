import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { DayCell } from '@/components/heatmaps';
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { loadActiveSessionId } from '@/src/session-entry';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { completedSessionHref, historyDetailHref } from '@/src/navigation/routes';
import type { CalendarHeatmapMetric } from '@/src/data';
import type { HistorySubject } from './use-history';

/** Chart taps keep their subject and period; only a set card opens a workout. */
export function useHistoryNavigation(subject: HistorySubject | null, metric: CalendarHeatmapMetric, accountRevision: number) {
  const router = useRouter();
  const openActiveWorkout = useOpenActiveWorkout();
  const navigation = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- An account change cancels pending card navigation.
  useFocusEffect(useCallback(() => () => { navigation.current += 1; }, [accountRevision]));
  const openPeriod = useCallback((period: { day: string } | { week: string }) => {
    if (!subject) return;
    const scope = subject.kind === 'muscle'
      ? { muscleGroupId: subject.id, gymId: subject.gymId, countSecondary: subject.countSecondary,
        countSecondaryVolume: subject.countSecondaryVolume }
      : { exerciseDefinitionId: subject.id, gymId: subject.gymId };
    router.push(historyDetailHref(scope, period, metric));
  }, [router, subject, metric]);
  const openDay = useCallback((day: DayCell) => {
    if (day.sessionIds.length > 0) openPeriod({ day: day.dateKey });
  }, [openPeriod]);
  const openWeek = useCallback((week: string) => openPeriod({ week }), [openPeriod]);
  const openSession = useCallback(async (sessionId: string) => {
    const request = ++navigation.current;
    const activeId = await loadActiveSessionId(sessionId).catch(() => null);
    if (request !== navigation.current || accountRevision !== getAccountLocalPreferenceAccountRevision()) return;
    if (activeId === sessionId) openActiveWorkout(sessionId);
    else router.push(completedSessionHref(sessionId));
  }, [router, openActiveWorkout, accountRevision]);
  return { openDay, openWeek, openSession };
}
