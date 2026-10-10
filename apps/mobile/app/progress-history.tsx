import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DayCell } from '@/components/heatmaps';
import {
  EXERCISE_HISTORY_METRIC_OPTIONS,
  HistoryView,
  MUSCLE_HISTORY_METRIC_OPTIONS,
  type MuscleHistoryMetric,
} from '@/components/stats/history-view';
import { useHistory, type HistorySubject } from '@/components/stats/use-history';
import { ActionButton, Notice, Screen, StatePanel, uiSpace } from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import type { CalendarHeatmapMetric } from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { completedSessionHref, historyDayHref, sessionsWeekHref } from '@/src/navigation/routes';
import type { HeatmapView } from '@/src/preferences/model';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';

// One exercise's or one muscle's history, pushed from Progress. The subject is
// the page's native title, and the view and metric selectors sit in one row
// above the chart. The params carry an id, never a name: the page resolves
// the name from the exercise catalogue cache, which also decides the
// unavailable state (`navigation-contract.md`: a bad id renders in route).

/** The route's declared title, kept until the subject's name resolves. */
export const PROGRESS_HISTORY_TITLE = 'History';

const firstRouteParam = (value: string | string[] | undefined): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Exactly one id names the subject. Both or neither is a malformed link and
 * renders the unavailable state, rather than guessing which was meant.
 */
export const resolveHistorySubject = (params: {
  exerciseDefinitionId?: string | string[];
  muscleGroupId?: string | string[];
}): HistorySubject | null => {
  const exerciseDefinitionId = firstRouteParam(params.exerciseDefinitionId);
  const muscleGroupId = firstRouteParam(params.muscleGroupId);
  if (exerciseDefinitionId && muscleGroupId) return null;
  if (exerciseDefinitionId) return { kind: 'exercise', id: exerciseDefinitionId };
  if (muscleGroupId) return { kind: 'muscle', id: muscleGroupId };
  return null;
};

export type ProgressHistoryScreenProps = {
  subject: HistorySubject | null;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  todayDateKey?: string;
};

export function ProgressHistoryScreen({ subject, todayDateKey }: ProgressHistoryScreenProps) {
  const { values, pending, accountRevision, error: preferenceError, retry: retryPreferences } = useAccountLocalPreferenceState();
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const revision = useBodyWeightContextRevision();
  const [muscleMetric, setMuscleMetric] = useState<MuscleHistoryMetric>('totalVolume');
  const [exerciseMetric, setExerciseMetric] = useState<CalendarHeatmapMetric>('totalVolume');

  // The catalogue is the one name source for both kinds, and it is already
  // loaded by boot. Until it is, the page keeps its declared title; once it is
  // ready, an id it does not hold is a subject that no longer exists.
  const name = useMemo(() => {
    if (!subject) return null;
    if (subject.kind === 'muscle') return catalog.muscleGroupsById[subject.id]?.displayName ?? null;
    return catalog.exercises.find(exercise => exercise.id === subject.id)?.name ?? null;
  }, [catalog, subject]);
  const unavailable = !subject || (catalog.status === 'ready' && name === null);
  // A subject that no longer exists is never read for.
  const history = useHistory(unavailable ? null : subject, values.historyLookbackWeeks, revision, accountRevision);
  // Stable, so the charts' memoised trees survive a re-render.
  const openDay = useCallback((day: DayCell) => {
    const href = historyDayHref(day.dateKey, day.sessionIds);
    if (href) router.push(href);
  }, [router]);
  const openWeek = useCallback((weekStartDateKey: string) => router.push(sessionsWeekHref(weekStartDateKey)), [router]);
  const openSession = useCallback((sessionId: string) => router.push(completedSessionHref(sessionId)), [router]);

  if (unavailable) {
    return (
      <Screen testID="progress-history-screen">
        <Stack.Screen options={{ title: PROGRESS_HISTORY_TITLE }} />
        <StatePanel
          body="Open it again from Progress."
          testID="progress-history-unavailable"
          title="This history isn't available"
        />
      </Screen>
    );
  }

  const shared = {
    dailyMetrics: history.daily,
    errorMessage: history.error,
    isLoading: history.loading,
    lookbackWeeks: values.historyLookbackWeeks,
    onRetry: history.retry,
    onSelectView: (view: HeatmapView) => updatePreferences({ heatmapView: view }),
    onOpenDay: openDay,
    onOpenWeek: openWeek,
    subject: name,
    todayDateKey,
    // A view whose save failed stays the chosen one here, as a draft the
    // preference store will retry; the band below says it is not saved yet.
    view: pending.heatmapView ?? values.heatmapView,
    weeklyEffort: history.weekly,
    timeline: {
      weekSetsTarget: subject.kind === 'muscle' ? { muscleGroupIds: [subject.id] } : { exerciseDefinitionId: subject.id },
      onOpenSession: openSession,
    },
  };

  return (
    <Screen testID="progress-history-screen">
      <Stack.Screen options={{ title: name ?? PROGRESS_HISTORY_TITLE }} />
      {/* The view selector writes a preference; this is the only screen that
          now offers it, so a failed save says so here, with its Retry. */}
      {preferenceError ? (
        <View style={styles.notice}>
          <Notice
            action={<ActionButton label="Retry" onPress={() => void retryPreferences()} size="compact"
              testID="progress-history-preferences-retry" variant="outline" />}
            live
            message={preferenceError}
            testID="progress-history-preferences-error"
            tone="danger"
          />
        </View>
      ) : null}
      {subject.kind === 'muscle' ? (
        <HistoryView
          {...shared}
          kind="muscle"
          metric={muscleMetric}
          metricOptions={MUSCLE_HISTORY_METRIC_OPTIONS}
          muscleTargets={{ muscleIds: [subject.id], weeklyTarget: values.weeklyWorkingSetTarget }}
          onSelectMetric={setMuscleMetric}
        />
      ) : (
        <HistoryView
          {...shared}
          kind="exercise"
          metric={exerciseMetric}
          metricOptions={EXERCISE_HISTORY_METRIC_OPTIONS}
          onSelectMetric={setExerciseMetric}
        />
      )}
    </Screen>
  );
}

export default function ProgressHistoryRoute() {
  const params = useLocalSearchParams<{
    exerciseDefinitionId?: string | string[];
    muscleGroupId?: string | string[];
  }>();
  return <ProgressHistoryScreen subject={resolveHistorySubject(params)} />;
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
});
