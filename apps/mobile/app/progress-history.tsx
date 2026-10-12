import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
  ActionButton, Icon, IconButton, ListRow, Notice, Screen, Sheet, StatePanel,
  uiFonts, uiRoles, uiSpace, uiTypography,
} from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import type { CalendarHeatmapMetric } from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  PROGRESS_HISTORY_METRIC_PARAMS, completedSessionHref, historyDayHref, progressHistoryHref, sessionsWeekHref,
} from '@/src/navigation/routes';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';

// One exercise's or one muscle's history, pushed from Progress. The subject is
// the page's native title, with the Timeline's focused week under it, and the
// view and metric selectors sit in one row above the chart. That week's
// sessions are behind the header's ⋮. The params carry an id, never a name: the
// page resolves the name from the exercise catalogue cache, which also decides
// the unavailable state (`navigation-contract.md`: a bad id renders in route).

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

// The native title: the subject, with the Timeline's focused week under it so
// the week survives scrolling the chart away. One header element for
// VoiceOver, capped like the group session's title — a rendered title sizes to
// its content, so without the cap a long name reaches the back arrow and the ⋮
// instead of truncating. `headerTitleStyle` does not reach a rendered title,
// so this one names the same face itself.
function HistoryTitle({ subject, week }: { subject: string; week: string | null }) {
  return (
    <View accessible accessibilityLabel={week === null ? subject : `${subject}, week of ${week}`}
      accessibilityRole="header" style={styles.title} testID="progress-history-title">
      <Text allowFontScaling={false} numberOfLines={1} style={styles.titleSubject}>{subject}</Text>
      {week === null ? null : (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.titleWeek} testID="progress-history-title-week">
          {week}
        </Text>
      )}
    </View>
  );
}

// The page's chrome: its title and the ⋮ that opens the focused week's
// sessions. Both are the Timeline's week, so neither appears while another view
// shows (`week` is then null), and a rest week — nothing to open — carries the
// title's week without the ⋮.
function HistoryHeader({ title, week, onOpenWeek }: {
  title: string;
  week: FocusedTimelineWeek | null;
  onOpenWeek: (weekStartDateKey: string) => void;
}) {
  const [optionsVisible, setOptionsVisible] = useState(false);
  const openWeek = () => {
    setOptionsVisible(false);
    if (week) onOpenWeek(week.weekStartDateKey);
  };
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => <HistoryTitle subject={title} week={week?.label ?? null} />,
          // A rest week has no sessions, so it has no options: the button goes
          // rather than opening a sheet that explains itself ([[copy.no-inline-explanation]]).
          // Named either way — options are merged across renders, so leaving
          // the key out would keep the last button on screen.
          headerRight: week?.hasTraining ? () => (
            <IconButton
              accessibilityLabel={`Options, week of ${week.label}`}
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
        title={week?.label}
        visible={optionsVisible}>
        <ListRow
          label="View sessions"
          leading={<Icon color={uiRoles.inkMuted} name="list" size="md" />}
          onPress={openWeek}
          testID="progress-history-view-sessions"
          trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
        />
      </Sheet>
    </>
  );
}

export type ProgressHistoryScreenProps = {
  subject: HistorySubject | null;
  /** The metric the link opens on; Volume without one. */
  initialMetric?: ProgressMetric | null;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  todayDateKey?: string;
};

export function ProgressHistoryScreen({ subject, initialMetric, todayDateKey }: ProgressHistoryScreenProps) {
  const { values, pending, accountRevision, error: preferenceError, retry: retryPreferences } = useAccountLocalPreferenceState();
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const revision = useBodyWeightContextRevision();
  const [muscleMetric, setMuscleMetric] = useState<MuscleHistoryMetric>(initialMetric ?? 'totalVolume');
  const [exerciseMetric, setExerciseMetric] = useState<CalendarHeatmapMetric>(initialMetric ?? 'totalVolume');
  // The Timeline's focused week, reported by the chart: the page draws it in
  // the title and opens its sessions from the ⋮.
  const [focusedWeek, setFocusedWeek] = useState<FocusedTimelineWeek | null>(null);

  // The catalogue is the one name source for both kinds, and it is already
  // loaded by boot. Until it is, the page keeps its declared title; once it is
  // ready, an id it does not hold is a subject that no longer exists.
  const name = useMemo(() => {
    if (!subject) return null;
    if (subject.kind === 'muscle') return catalog.muscleGroupsById[subject.id]?.displayName ?? null;
    return catalog.exercises.find(exercise => exercise.id === subject.id)?.name ?? null;
  }, [catalog, subject]);
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
  const exerciseLink = useMemo<WeekSetExerciseLink | undefined>(() => subject?.kind === 'muscle' ? {
    canOpen: id => catalog.exercises.some(exercise => exercise.id === id),
    open: id => router.push(progressHistoryHref({ exerciseDefinitionId: id }, muscleMetric)),
  } : undefined, [catalog, muscleMetric, router, subject]);

  if (unavailable) {
    return (
      <Screen testID="progress-history-screen">
        {/* Both keys are named: options merge across renders, so a subject that
            disappears from the catalogue while its page is open would otherwise
            keep its name, its week and a live options button over this panel. */}
        <Stack.Screen options={{ headerRight: undefined, headerTitle: undefined, title: PROGRESS_HISTORY_TITLE }} />
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
    onFocusWeek: setFocusedWeek,
    subject: name,
    todayDateKey,
    // A view whose save failed stays the chosen one here, as a draft the
    // preference store will retry; the band below says it is not saved yet.
    view: pending.heatmapView ?? values.heatmapView,
    weeklyEffort: history.weekly,
    timeline: {
      weekSetsTarget: subject.kind === 'muscle' ? { muscleGroupIds: [subject.id] } : { exerciseDefinitionId: subject.id },
      onOpenSession: openSession,
      exerciseLink,
    },
  };

  return (
    <Screen testID="progress-history-screen">
      <HistoryHeader onOpenWeek={openWeek} title={name ?? PROGRESS_HISTORY_TITLE} week={focusedWeek} />
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
  }>();
  const subject = resolveHistorySubject(params);
  const metric = resolveHistoryMetric(params.metric);
  // Progress pushes a fresh page each time, but a link can reach this route
  // while it is mounted: new params are a new page, opening on their own
  // metric and week rather than keeping the last link's.
  return <ProgressHistoryScreen initialMetric={metric} key={`${subject?.kind}:${subject?.id}:${metric}`} subject={subject} />;
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
  // As the group session's title (`components/groups/group-session-header-title.tsx`).
  title: { alignItems: 'center', maxWidth: 260 },
  titleSubject: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  titleWeek: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
});
