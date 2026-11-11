import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { DayCell } from '@/components/heatmaps';
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { ACTIVE_WORKOUT_HREF } from '@/src/navigation/active-session-entry';
import { loadActiveSessionId } from '@/src/session-entry';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { completedSessionHref, historyDayHref, muscleHistoryDetailHref, sessionsDayHref, sessionsWeekHref } from '@/src/navigation/routes';
import type { ProgressMetric } from '@/src/preferences/model';
import type { HistorySubject } from './use-history';

/** Muscle taps keep the subject; exercise history retains its session navigation. */
export function useHistoryNavigation(subject: HistorySubject | null, muscleMetric: ProgressMetric, accountRevision: number) {
  const gymId = subject?.gymId;
  const router = useRouter();
  const openActiveWorkout = useOpenActiveWorkout();
  const dayNavigation = useRef(0);
  useFocusEffect(useCallback(() => () => { dayNavigation.current += 1; }, [accountRevision]));
  // Recheck at the tap: a workout may have finished since the Grid was read.
  const openDay = useCallback(async (day: DayCell) => {
    if (subject?.kind === 'muscle') {
      if (day.sessionIds.length > 0) router.push(muscleHistoryDetailHref({ muscleGroupId: subject.id, gymId,
        countSecondary: subject.countSecondary, countSecondaryVolume: subject.countSecondaryVolume }, { day: day.dateKey }, muscleMetric));
      return;
    }
    const request = ++dayNavigation.current;
    let href = historyDayHref(day.dateKey, day.sessionIds);
    if (day.sessionIds.length === 1) {
      try {
        href = historyDayHref(day.dateKey, day.sessionIds, await loadActiveSessionId());
      } catch {
        href = sessionsDayHref(day.dateKey);
      }
    }
    if (request === dayNavigation.current && accountRevision === getAccountLocalPreferenceAccountRevision() && href) {
      if (href === ACTIVE_WORKOUT_HREF) openActiveWorkout(day.sessionIds[0]);
      else router.push(href);
    }
  }, [openActiveWorkout, router, accountRevision, subject, gymId, muscleMetric]);
  const openWeek = useCallback((week: string) => router.push(subject?.kind === 'muscle'
    ? muscleHistoryDetailHref({ muscleGroupId: subject.id, gymId, countSecondary: subject.countSecondary,
      countSecondaryVolume: subject.countSecondaryVolume }, { week }, muscleMetric)
    : sessionsWeekHref(week)), [router, subject, gymId, muscleMetric]);
  const openSession = useCallback((sessionId: string) => router.push(completedSessionHref(sessionId)), [router]);
  return { openDay, openWeek, openSession };
}
