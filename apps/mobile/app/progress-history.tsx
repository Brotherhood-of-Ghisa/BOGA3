import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DayCell, FocusedTimelineWeek } from '@/components/heatmaps';
import {
  EXERCISE_HISTORY_METRIC_OPTIONS,
  HistoryView,
  MUSCLE_HISTORY_METRIC_OPTIONS,
  type MuscleHistoryMetric,
} from '@/components/stats/history-view';
import type { WeekSetExerciseLink } from '@/components/stats/week-set-list';
import { useHistory, type HistorySubject } from '@/components/stats/use-history';
import {
  ActionButton, Icon, IconButton, ListRow, Notice, Screen, Sheet, StatePanel, uiRoles, uiSpace,
} from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import type { CalendarHeatmapMetric } from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  PROGRESS_HISTORY_METRIC_PARAMS, completedSessionHref, historyDayHref, progressHistoryHref, rmCurveHref, sessionsWeekHref,
} from '@/src/navigation/routes';
import { exerciseCountedMuscles } from '@/src/exercise-catalog/exercise-muscles';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';

// One exercise's or one muscle's history, pushed from Progress. The subject is
// the page's native title, and the view and metric selectors sit in one row
// above the chart. The header's ⋮ holds the Timeline's focused week's sessions
// and, for an exercise, its RM curve and each counted muscle’s history. The
// params carry an id, never a name: the page resolves the name from the
// exercise catalogue cache, which also decides the unavailable state
// (`navigation-contract.md`: a bad id renders in route).

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

/**
 * The metric Progress was showing, carried over by its link. An absent or
 * unknown value opens the page on Volume, as a direct link always has.
 */
export const resolveHistoryMetric = (value: string | string[] | undefined): ProgressMetric | null => {
  const param = firstRouteParam(value);
  const entry = (Object.entries(PROGRESS_HISTORY_METRIC_PARAMS) as [ProgressMetric, string][])
    .find(([, name]) => name === param);
  return entry ? entry[0] : null;
};

// The metrics a history link can carry: a muscle's, which an exercise shares.
const isProgressMetric = (metric: CalendarHeatmapMetric): metric is ProgressMetric =>
  metric in PROGRESS_HISTORY_METRIC_PARAMS;

/** A muscle the exercise counts towards, as the ⋮ offers its history. */
type HistoryMuscleLink = { id: string; name: string; role: 'primary' | 'secondary' };

const ROLE_LABELS = { primary: 'Primary', secondary: 'Secondary' } as const;

// The page's ⋮ offers applicable week, muscle and exercise-chart actions.
// With no applicable action, hide the button rather than opening an empty sheet.
function HistoryHeader({ title, week, muscles, onOpenWeek, onOpenMuscle, onOpenCurve }: {
  title: string;
  week: FocusedTimelineWeek | null;
  muscles: readonly HistoryMuscleLink[];
  onOpenWeek: (weekStartDateKey: string) => void;
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenCurve?: () => void;
}) {
  const [optionsVisible, setOptionsVisible] = useState(false);
  const sessionsWeek = week?.hasTraining ? week : null;
  const openWeek = () => {
    setOptionsVisible(false);
    if (sessionsWeek) onOpenWeek(sessionsWeek.weekStartDateKey);
  };
  const openMuscle = (muscleGroupId: string) => {
    setOptionsVisible(false);
    onOpenMuscle(muscleGroupId);
  };
  const hasOptions = sessionsWeek !== null || muscles.length > 0 || onOpenCurve !== undefined;
  return (
    <>
      <Stack.Screen
        options={{
          title,
          // Named either way — options are merged across renders, so leaving
          // the key out would keep the last button on screen.
          headerRight: hasOptions ? () => (
            <IconButton
              nativeHeader
              accessibilityLabel="Options"
              name="more-vertical"
              onPress={() => setOptionsVisible(true)}
              testID="progress-history-options-button"
            />
          ) : undefined,
        }}
      />
      <Sheet
        dismissLabel="Dismiss history options"
        onDismiss={() => setOptionsVisible(false)}
        testID="progress-history-options-sheet"
        title={title}
        visible={optionsVisible}>
        {onOpenCurve ? (
          <ListRow
            label="RM curve"
            leading={<Icon color={uiRoles.inkMuted} name="timeline-columns" size="md" />}
            onPress={() => { setOptionsVisible(false); onOpenCurve(); }}
            testID="progress-history-rm-curve"
            trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
          />
        ) : null}
        {sessionsWeek ? (
          <ListRow
            description={sessionsWeek.label}
            label="View sessions"
            leading={<Icon color={uiRoles.inkMuted} name="list" size="md" />}
            onPress={openWeek}
            testID="progress-history-view-sessions"
            trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
          />
        ) : null}
        {muscles.map(muscle => (
          <ListRow
            description={ROLE_LABELS[muscle.role]}
            key={muscle.id}
            label={muscle.name}
            leading={<Icon color={uiRoles.inkMuted} name="timeline-columns" size="md" />}
            onPress={() => openMuscle(muscle.id)}
            testID={`progress-history-muscle-${muscle.id}`}
            trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
          />
        ))}
      </Sheet>
    </>
  );
}

export type ProgressHistoryScreenProps = {
  subject: HistorySubject | null;
  /** The metric the link opens on; Volume without one. */
  initialMetric?: ProgressMetric | null;
  initialView?: HeatmapView | null;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  todayDateKey?: string;
};

export function ProgressHistoryScreen({ subject, initialMetric, initialView, todayDateKey }: ProgressHistoryScreenProps) {
  const { values, pending, accountRevision, error: preferenceError, retry: retryPreferences } = useAccountLocalPreferenceState();
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const revision = useBodyWeightContextRevision();
  const [entryView, setEntryView] = useState<HeatmapView | null>(initialView ?? null);
  const [muscleMetric, setMuscleMetric] = useState<MuscleHistoryMetric>(initialMetric ?? 'totalVolume');
  const [exerciseMetric, setExerciseMetric] = useState<CalendarHeatmapMetric>(initialMetric ?? 'totalVolume');
  // The Timeline's focused week, reported by the chart: the ⋮ opens its sessions.
  const [focusedWeek, setFocusedWeek] = useState<FocusedTimelineWeek | null>(null);

  // The catalogue is the one name source for both kinds, and it is already
  // loaded by boot. Until it is, the page keeps its declared title; once it is
  // ready, an id it does not hold is a subject that no longer exists.
  const exercise = useMemo(
    () => subject?.kind === 'exercise' ? catalog.exercises.find(candidate => candidate.id === subject.id) ?? null : null,
    [catalog, subject]
  );
  const name = subject?.kind === 'muscle'
    ? catalog.muscleGroupsById[subject.id]?.displayName ?? null
    : exercise?.name ?? null;
  // The muscles the ⋮ links to: an exercise's counted muscles the catalogue
  // can name. A muscle's own page links to none.
  const muscleLinks = useMemo(
    () => exercise ? exerciseCountedMuscles(exercise).flatMap(({ muscleGroupId, role }) => {
      const muscleName = catalog.muscleGroupsById[muscleGroupId]?.displayName;
      return muscleName ? [{ id: muscleGroupId, name: muscleName, role }] : [];
    }) : [],
    [catalog, exercise]
  );
  // Stable, so the muscle window is not rebuilt on every render of the page.
  const muscleTargets = useMemo(
    () => subject?.kind === 'muscle' ? { muscleIds: [subject.id], weeklyTarget: values.weeklyWorkingSetTarget } : undefined,
    [subject, values.weeklyWorkingSetTarget]
  );
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
  // A muscle's week list links each card's exercise to its own history, on
  // the metric shown here; one the catalogue no longer holds has no page.
  const exerciseLink = useMemo<WeekSetExerciseLink | undefined>(() => {
    if (subject?.kind !== 'muscle') return undefined;
    const catalogued = new Set(catalog.exercises.map(exercise => exercise.id));
    return {
      canOpen: id => catalogued.has(id),
      open: id => router.push(progressHistoryHref({ exerciseDefinitionId: id }, muscleMetric)),
    };
  }, [catalog, muscleMetric, router, subject]);
  // A muscle's page opens on the exercise's metric when a muscle has it too
  // (Volume or Sets); 1RM and top weight are exercise-only, so it opens on Volume.
  const openMuscle = (muscleGroupId: string) => router.push(progressHistoryHref(
    { muscleGroupId },
    isProgressMetric(exerciseMetric) ? exerciseMetric : undefined
  ));

  if (unavailable) {
    return (
      <Screen testID="progress-history-screen">
        {/* Both keys are named: options merge across renders, so a subject that
            disappears from the catalogue while its page is open would otherwise
            keep its name and a live options button over this panel. */}
        <Stack.Screen options={{ headerRight: undefined, title: PROGRESS_HISTORY_TITLE }} />
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
    onSelectView: (view: HeatmapView) => {
      setEntryView(null);
      updatePreferences({ heatmapView: view });
    },
    onOpenDay: openDay,
    onOpenWeek: openWeek,
    onFocusWeek: setFocusedWeek,
    subject: name,
    todayDateKey,
    // A view whose save failed stays the chosen one here, as a draft the
    // preference store will retry; the band below says it is not saved yet.
    view: entryView ?? pending.heatmapView ?? values.heatmapView,
    weeklyEffort: history.weekly,
    timeline: {
      weekSetsTarget: subject.kind === 'muscle' ? { muscleGroupIds: [subject.id] } : { exerciseDefinitionId: subject.id },
      onOpenSession: openSession,
      exerciseLink,
    },
  };

  return (
    <Screen testID="progress-history-screen">
      <HistoryHeader
        muscles={muscleLinks}
        onOpenCurve={exercise && !exercise.deletedAt ? () => router.push(rmCurveHref(exercise.id)) : undefined}
        onOpenMuscle={openMuscle}
        onOpenWeek={openWeek}
        title={name ?? PROGRESS_HISTORY_TITLE}
        week={focusedWeek}
      />
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
          muscleTargets={muscleTargets}
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
    metric?: string | string[];
    view?: string | string[];
  }>();
  const subject = resolveHistorySubject(params);
  const metric = resolveHistoryMetric(params.metric);
  const entryView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = entryView === 'timeline' || entryView === 'daily' || entryView === 'weekly' ? entryView : null;
  // Progress pushes a fresh page each time, but a link can reach this route
  // while it is mounted: new params are a new page, opening on their own
  // metric and week rather than keeping the last link's.
  return <ProgressHistoryScreen initialMetric={metric} initialView={view} key={`${subject?.kind}:${subject?.id}:${metric}:${view}`} subject={subject} />;
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
});
