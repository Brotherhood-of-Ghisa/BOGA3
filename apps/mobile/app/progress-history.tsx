import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { lockAsync, OrientationLock } from 'expo-screen-orientation';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseSessionEntrySheet } from '@/components/session-recorder/exercise-session-entry-sheet';
import type { FocusedTimelineWeek } from '@/components/heatmaps';
import type { TimelineStack } from '@/components/heatmaps/timeline';
import {
  EXERCISE_HISTORY_METRIC_OPTIONS,
  HistoryView,
  MUSCLE_HISTORY_METRIC_OPTIONS,
  type MuscleHistoryMetric,
} from '@/components/stats/history-view';
import type { WeekSetExerciseLink } from '@/components/stats/week-set-list';
import { HistoryPeriodDetail } from '@/components/stats/history-period-detail';
import { historySetsTarget, setPeriodBounds, type SetPeriod } from '@/components/stats/week-sets';
import { parseHistoryJump } from '@/components/session-list/history-jump';
import { useHistoryNavigation } from '@/components/stats/use-history-navigation';
import { historyMuscleIds, historySubjectId, useHistory, type HistorySubject } from '@/components/stats/use-history';
import { GymPicker, type GymPickerSheetProps } from '@/components/gyms/gym-picker';
import { HistoryTitle, type HistoryTitleMuscle } from '@/components/stats/history-title';
import { SecondarySetsChip } from '@/components/stats/secondary-sets-chip';
import { decodeGymRouteParam, encodeGymRouteParam } from '@/src/utils/gym-scope-route';
import {
  ActionButton, Icon, IconButton, ListRow, Notice, Screen, Sheet, StatePanel, uiSpace,
} from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import type { CalendarHeatmapMetric } from '@/src/data';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { effectiveMuscleTargetOverrides } from '@/src/preferences/muscle-targets';
import {
  PROGRESS_HISTORY_METRIC_PARAMS, PROGRESS_HISTORY_PRIMARY_ONLY_PARAM, exerciseHistoryHref, progressHistoryHref, rmCurveHref,
} from '@/src/navigation/routes';
import { reportedExercisesMuscles, reportedMuscleName } from '@/src/exercise-catalog/reported-muscles';
import { parseProgressSelection } from '@/src/utils/progress-selection';
import { EMPTY_MUSCLE_SETUP } from '@/src/exercise-catalog/muscle-setup';
import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { historyWeekBounds } from '@/src/utils/calendar-weeks';

// An exercise, muscle, or 2–5 of either, identified by IDs from Progress.
// Combined selections show their names in the title sheet and open Sets or
// Volume. The catalogue decides when the whole scope is unavailable.
/** The route's declared title, kept until the subject's name resolves. */
export const PROGRESS_HISTORY_TITLE = 'History';

const firstRouteParam = (value: string | string[] | undefined): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Exactly one scope names the subject. Multiple or absent scopes are malformed and
 * renders the unavailable state, rather than guessing which was meant.
 */
export const resolveHistorySubject = (params: {
  exerciseDefinitionId?: string | string[];
  exerciseDefinitionIds?: string | string[];
  muscleGroupId?: string | string[];
  muscleGroupIds?: string | string[];
  gymId?: string | string[];
  secondary?: string | string[];
  secondaryVolume?: string | string[];
}): HistorySubject | null => {
  const exerciseDefinitionId = firstRouteParam(params.exerciseDefinitionId);
  const muscleGroupId = firstRouteParam(params.muscleGroupId);
  const scopes = [exerciseDefinitionId, params.exerciseDefinitionIds, muscleGroupId, params.muscleGroupIds];
  if (scopes.filter(scope => scope != null).length !== 1) return null;
  const gymId = decodeGymRouteParam(firstRouteParam(params.gymId));
  const scope = gymId === undefined ? {} : { gymId };
  if (exerciseDefinitionId) return { kind: 'exercise', id: exerciseDefinitionId, ...scope };
  if (params.exerciseDefinitionIds !== undefined) {
    const ids = parseProgressSelection(params.exerciseDefinitionIds);
    return ids ? { kind: 'exercises', ids, ...scope } : null;
  }
  const ids = parseProgressSelection(params.muscleGroupIds);
  const muscleScope = muscleGroupId ? { id: muscleGroupId } : ids ? { ids } : null;
  if (!muscleScope) return null;
  const countSecondary = parseSecondary(params.secondary);
  const countSecondaryVolume = parseSecondary(params.secondaryVolume);
  return { kind: 'muscle', ...muscleScope, ...scope,
    ...(countSecondary === undefined ? {} : { countSecondary }),
    ...(countSecondaryVolume === undefined ? {} : { countSecondaryVolume }) };
};

const parseSecondary = (value: string | string[] | undefined): boolean | undefined => {
  const param = firstRouteParam(value);
  if (param === 'shown') return true;
  if (param === PROGRESS_HISTORY_PRIMARY_ONLY_PARAM) return false;
  return undefined;
};

/** The route's subject with this visit's gym and independent metric choices over it. */
const withChoices = (subject: HistorySubject | null, gym: { gymId: string | null | undefined } | null,
  countSecondary: boolean | null, countSecondaryVolume: boolean | null): HistorySubject | null => {
  if (!subject) return null;
  const scoped = gym === null ? subject : { ...subject, gymId: gym.gymId };
  if (scoped.kind !== 'muscle') return scoped;
  return { ...scoped, ...(countSecondary === null ? {} : { countSecondary }),
    ...(countSecondaryVolume === null ? {} : { countSecondaryVolume }) };
};

/**
 * The metric Progress was showing, carried over by its link. An absent or
 * unknown value opens the page on Volume, as a direct link always has.
 */
export const resolveHistoryMetric = (value: string | string[] | undefined): CalendarHeatmapMetric | null => {
  const param = firstRouteParam(value);
  const entry = (Object.entries(PROGRESS_HISTORY_METRIC_PARAMS) as [CalendarHeatmapMetric, string][])
    .find(([, name]) => name === param);
  return entry ? entry[0] : null;
};

// The metrics a history link can carry: a muscle's, which an exercise shares.
const isProgressMetric = (metric: CalendarHeatmapMetric): metric is ProgressMetric =>
  metric === 'totalVolume' || metric === 'workingSetCount';

/** A muscle the exercise counts towards, as the ⋮ offers its history. */
type HistoryMuscleLink = { id: string; name: string; role: 'primary' | 'secondary' };

const ROLE_LABELS = { primary: 'Primary', secondary: 'Secondary' } as const;

/** The history page's gym ([[gym.view-filter]]), chosen in the selector row. */
type HistoryGymChoice = Pick<GymPickerSheetProps, 'value' | 'options' | 'onChange' | 'allSessionCount' | 'supportedOrientations'>;

function MuscleHistoryFilters({ gym, metric, subject, onChangeSets, onChangeVolume }: {
  gym: HistoryGymChoice;
  metric: MuscleHistoryMetric;
  subject: Extract<HistorySubject, { kind: 'muscle' }>;
  onChangeSets: (value: boolean) => void;
  onChangeVolume: (value: boolean) => void;
}) {
  const volume = metric === 'totalVolume';
  return <>
    <GymPicker {...gym} size="compact" testID="stats-muscle-history-gym" />
    <SecondarySetsChip metric={metric} onChange={volume ? onChangeVolume : onChangeSets}
      testID="stats-muscle-history-secondary"
      value={(volume ? subject.countSecondaryVolume : subject.countSecondary) !== false} />
  </>;
}

const invalidDetailPeriod = (subject: HistorySubject | null, period: SetPeriod | null | undefined, lookbackWeeks: number): boolean => {
  if (period === undefined) return false;
  if (period === null || !subject) return true;
  const bounds = setPeriodBounds(period);
  const history = historyWeekBounds(lookbackWeeks);
  return bounds.start < history.start || bounds.start >= history.end;
};

// The page's ⋮ offers applicable week, muscle and exercise-chart actions.
// With no applicable action, hide the button rather than opening an empty sheet.
function HistoryHeader({ title, titleSwitch, week, muscles, onOpenWeek, onOpenMuscle, onOpenHistory, onOpenCurve, entryExercise, detailPeriod, selection, landscape = false }: {
  title: string;
  /** A muscle page's title switches between the user's muscles. */
  titleSwitch?: { muscles: readonly HistoryTitleMuscle[]; currentId: string; onChoose: (muscleGroupId: string) => void };
  week: FocusedTimelineWeek | null;
  muscles: readonly HistoryMuscleLink[];
  onOpenWeek: (weekStartDateKey: string) => void;
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenHistory?: () => void;
  onOpenCurve?: () => void;
  entryExercise?: { id: string; name: string; deletedAt: Date | null } | null;
  detailPeriod?: SetPeriod | null;
  selection?: ComponentProps<typeof HistoryTitle>['selection'];
  landscape?: boolean;
}) {
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [queuedSessionEntry, setQueuedSessionEntry] = useState(false);
  const [sessionEntryVisible, setSessionEntryVisible] = useState(false);
  const liveExercise = entryExercise?.deletedAt ? undefined : entryExercise;
  const sessionsWeek = !detailPeriod && week?.hasTraining ? week : null;
  const openWeek = () => {
    setOptionsVisible(false);
    if (sessionsWeek) onOpenWeek(sessionsWeek.weekStartDateKey);
  };
  const openMuscle = (muscleGroupId: string) => {
    setOptionsVisible(false);
    onOpenMuscle(muscleGroupId);
  };
  const hasOptions = sessionsWeek !== null || muscles.length > 0 || onOpenHistory !== undefined || onOpenCurve !== undefined;
  return (
    <>
      <ExerciseSessionEntrySheet exercise={sessionEntryVisible ? liveExercise ?? null : null}
        onDismiss={() => setSessionEntryVisible(false)} />
      <Stack.Screen
        options={{
          title,
          headerShown: !landscape,
          gestureEnabled: !landscape,
          orientation: landscape ? 'landscape' : 'portrait',
          headerTitle: () => <HistoryTitle title={title} selection={selection} {...titleSwitch} />,
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
        onDismissed={() => {
          if (queuedSessionEntry) { setQueuedSessionEntry(false); setSessionEntryVisible(true); }
        }}
        testID="progress-history-options-sheet"
        title={title}
        visible={optionsVisible}>
        <ScrollView testID="progress-history-options-scroll">
          {liveExercise ? <ListRow label="Add to session…" leading={<Icon colorRole="ink" name="plus" size="md" />}
            onPress={() => { setQueuedSessionEntry(true); setOptionsVisible(false); }}
            testID="progress-history-add-to-session" /> : null}
          {onOpenHistory ? (
            <ListRow
              label="History"
              leading={<Icon colorRole="inkMuted" name="list" size="md" />}
              onPress={() => { setOptionsVisible(false); onOpenHistory(); }}
              testID="progress-history-exercise-history"
              trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
            />
          ) : null}
          {onOpenCurve ? (
            <ListRow
              label="RM curve"
              leading={<Icon colorRole="inkMuted" name="timeline-columns" size="md" />}
              onPress={() => { setOptionsVisible(false); onOpenCurve(); }}
              testID="progress-history-rm-curve"
              trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
            />
          ) : null}
          {sessionsWeek ? (
            <ListRow
              description={sessionsWeek.label}
              label="View sets"
              leading={<Icon colorRole="inkMuted" name="list" size="md" />}
              onPress={openWeek}
              testID="progress-history-view-sessions"
              trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
            />
          ) : null}
          {muscles.map(muscle => (
            <ListRow
              description={ROLE_LABELS[muscle.role]}
              key={muscle.id}
              label={muscle.name}
              leading={<Icon colorRole="inkMuted" name="timeline-columns" size="md" />}
              onPress={() => openMuscle(muscle.id)}
              testID={`progress-history-muscle-${muscle.id}`}
              trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
            />
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

export type ProgressHistoryScreenProps = {
  subject: HistorySubject | null;
  /** The metric the link opens on; Volume without one. */
  initialMetric?: CalendarHeatmapMetric | null;
  initialView?: HeatmapView | null;
  /** Optional determinism seam: anchors the heatmap window. Defaults to today. */
  todayDateKey?: string;
  /** Present on a pushed day/week detail; null is a malformed period. */
  detailPeriod?: SetPeriod | null;
};

/** Resolve the whole scope together: a missing selection member never narrows the chart. */
function useHistorySubjectCatalog(subject: HistorySubject | null) {
  const catalog = useExerciseCatalog();
  // The catalogue is the one name source for both kinds, and it is already
  // loaded by boot. Until it is, the page keeps its declared title; once it is
  // ready, an id it does not hold is a subject that no longer exists.
  const exercise = useMemo(
    () => subject?.kind === 'exercise' ? catalog.exercises.find(candidate => candidate.id === subject.id) ?? null : null,
    [catalog, subject]
  );
  const selectedExercises = useMemo(() => subject?.kind === 'exercises'
    ? subject.ids.flatMap(id => {
      const found = catalog.exercises.find(candidate => candidate.id === id);
      return found ? [found] : [];
    }) : [], [catalog, subject]);
  // A muscle is the user's muscle ([[muscle.report-groups]]): an entry merged
  // into another, or one they do not track, has no history page of its own.
  const muscleSetup = catalog.muscleSetup ?? EMPTY_MUSCLE_SETUP;
  const selectedMuscles = useMemo(() => subject?.kind === 'muscle' && subject.ids
    ? subject.ids.flatMap(id => {
      const muscle = Object.hasOwn(muscleSetup.musclesById, id) ? muscleSetup.musclesById[id] : undefined;
      return muscle ? [{ id, name: muscle.displayName }] : [];
    }) : [], [muscleSetup, subject]);
  const selection = subject?.ids && (subject.kind === 'muscle'
    ? { kind: 'muscle' as const, items: selectedMuscles }
    : { kind: 'exercise' as const, items: selectedExercises });
  let name = exercise?.name ?? null;
  if (selection && subject.ids) {
    const count = subject.ids.length;
    name = catalog.status === 'ready' && selection.items.length !== count ? null : `${count} ${selection.kind}s`;
  } else if (subject?.kind === 'muscle' && subject.id) {
    name = reportedMuscleName(muscleSetup, catalog.muscleGroupsById, subject.id);
  }
  // The muscles the ⋮ links to: an exercise's counted muscles as the user sees
  // them, which the catalogue can name. A muscle's own page links to none.
  const muscleLinks = useMemo(
    () => reportedExercisesMuscles(exercise ? [exercise] : selectedExercises, muscleSetup.assignment).flatMap(({ muscleGroupId, role }) => {
      const muscleName = reportedMuscleName(muscleSetup, catalog.muscleGroupsById, muscleGroupId);
      return muscleName ? [{ id: muscleGroupId, name: muscleName, role }] : [];
    }),
    [catalog, exercise, selectedExercises, muscleSetup]
  );
  return { catalog, muscleSetup, exercise, selection, name, muscleLinks };
}

function useHistoryStack(selection: ComponentProps<typeof HistoryTitle>['selection'], history: ReturnType<typeof useHistory>) {
  const kind = selection?.kind;
  const selected = selection?.items;
  const { weekly, weeklyByExercise } = history;
  return useMemo<TimelineStack | undefined>(() => {
    if (!selected || selected.length < 2) return undefined;
    if (kind === 'muscle') {
      return { kind, items: selected.map(({ id, name }) => ({ id, name,
        weeks: new Map(weekly.flatMap(({ weekStartDateKey, muscleShares }) => {
          const share = muscleShares?.get(id);
          return share ? [[weekStartDateKey, share] as const] : [];
        })),
      })) };
    }
    if (weeklyByExercise?.size !== selected.length) return undefined;
    return { kind: 'exercise', items: selected.map(({ id, name }) => ({ id, name, weeks: weeklyByExercise.get(id)! })) };
  }, [kind, selected, weekly, weeklyByExercise]);
}

/** Single-only destinations stay absent from a combined workload's menu. */
const exerciseHistoryActions = (subject: HistorySubject, exercise: { id: string; deletedAt: Date | null } | null, router: ReturnType<typeof useRouter>) => {
  const ids = subject.kind === 'exercises' ? subject.ids : exercise?.id;
  return {
    onOpenHistory: ids ? () => router.push(exerciseHistoryHref(ids, subject.gymId)) : undefined,
    onOpenCurve: exercise && !exercise.deletedAt ? () => router.push(rmCurveHref(exercise.id)) : undefined,
  };
};

function HistoryScopeState({ unavailable, loadError }: { unavailable: boolean; loadError: string | null }) {
  return <Screen testID="progress-history-screen">
    {/* Stack options merge across renders, including after a scope disappears. */}
    <Stack.Screen options={{ headerRight: undefined, headerTitle: undefined, headerShown: true, gestureEnabled: true,
      orientation: 'portrait', title: PROGRESS_HISTORY_TITLE }} />
    {unavailable ? <StatePanel body="Open it again from Progress." testID="progress-history-unavailable"
      title="This history isn't available" /> : loadError
      ? <StatePanel kind="error" title="Could not load history" action={{
        label: 'Retry', onPress: () => void ensureExerciseCatalogLoaded(), testID: 'progress-history-names-retry',
      }} />
      : <StatePanel body="Loading history…" kind="loading" testID="progress-history-names-loading" />}
  </Screen>;
}

export function ProgressHistoryScreen({ subject: routeSubject, initialMetric, initialView, todayDateKey, detailPeriod }: ProgressHistoryScreenProps) {
  const { values, pending, accountRevision, error: preferenceError, retry: retryPreferences } = useAccountLocalPreferenceState();
  const router = useRouter();
  const revision = useBodyWeightContextRevision();
  const [landscapeRequested, setTimelineLandscape] = useState(false);
  const toggleTimelineLandscape = useCallback(() => setTimelineLandscape(value => !value), []);
  const [entryView, setEntryView] = useState<HeatmapView | null>(initialView ?? null);
  const [metric, setMetric] = useState<CalendarHeatmapMetric>(initialMetric ?? 'totalVolume');
  const muscleMetric = isProgressMetric(metric) ? metric : 'totalVolume';
  // The Timeline's focused week, reported by the chart: the ⋮ opens its sessions.
  const [focusedWeek, setFocusedWeek] = useState<FocusedTimelineWeek | null>(null);
  // The gym and, on a muscle, secondary sets ([[muscle.secondary-filter]]):
  // the ones it was opened on, until this visit changes them.
  const [chosenGym, setChosenGym] = useState<{ gymId: string | null | undefined } | null>(null);
  const [chosenSecondary, setChosenSecondary] = useState<boolean | null>(null);
  const [chosenSecondaryVolume, setChosenSecondaryVolume] = useState<boolean | null>(null);
  const subject = useMemo(() => withChoices(routeSubject?.kind === 'muscle' ? {
    ...routeSubject, countSecondary: routeSubject.countSecondary ?? values.progressCountSecondary,
    countSecondaryVolume: routeSubject.countSecondaryVolume ?? !values.muscleVolumePrimaryOnly,
  } : routeSubject, chosenGym, chosenSecondary, chosenSecondaryVolume),
  [routeSubject, chosenGym, chosenSecondary, chosenSecondaryVolume, values.progressCountSecondary, values.muscleVolumePrimaryOnly]);
  const view = entryView ?? pending.heatmapView ?? values.heatmapView;
  const gymId = subject?.gymId;
  const shownMetric = subject?.kind === 'muscle' || subject?.kind === 'exercises' ? muscleMetric : metric;

  const { catalog, muscleSetup, exercise, selection, name, muscleLinks } = useHistorySubjectCatalog(subject);
  // A muscle page's title switches in place to another of the user's muscles,
  // keeping this visit's metric, gym and secondary-set choices.
  const titleSwitch = useMemo(
    () => subject?.kind === 'muscle' && subject.id ? {
      muscles: muscleSetup.muscles,
      currentId: subject.id,
      onChoose: (muscleGroupId: string) => router.setParams({ muscleGroupId }),
    } : undefined,
    [muscleSetup, router, subject]
  );
  // Stable, so the muscle window is not rebuilt on every render of the page.
  const muscleTargets = useMemo(
    () => subject?.kind === 'muscle' ? {
      muscleIds: historyMuscleIds(subject),
      weeklyTarget: values.weeklyWorkingSetTarget,
      weeklyTargets: effectiveMuscleTargetOverrides(values),
    } : undefined,
    [subject, values]
  );
  const unavailable = !subject || (catalog.status === 'ready' && name === null)
    || invalidDetailPeriod(subject, detailPeriod, values.historyLookbackWeeks);
  const resolvingSelection = subject?.kind === 'muscle' && subject.ids !== undefined
    && selection?.items.length !== subject.ids.length && catalog.status !== 'ready';
  const canExpandTimeline = !unavailable && !resolvingSelection && detailPeriod === undefined && view === 'timeline' && Platform.OS !== 'web';
  const landscape = canExpandTimeline && landscapeRequested;
  useFocusEffect(useCallback(() => {
    if (!landscape) return;
    let focused = true;
    void lockAsync(OrientationLock.LANDSCAPE).catch(() => {
      if (focused) setTimelineLandscape(false);
    });
    return () => {
      focused = false;
      void lockAsync(OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [landscape]));
  // A subject that no longer exists is never read for.
  const history = useHistory(unavailable || resolvingSelection ? null : subject, values.historyLookbackWeeks, revision, accountRevision);
  const stack = useHistoryStack(selection, history);
  const { openDay, openWeek, openSession } = useHistoryNavigation(subject, shownMetric, accountRevision);
  // A muscle's week list links each card's exercise to its own history, on
  // the metric shown here; one the catalogue no longer holds has no page.
  const exerciseLink = useMemo<WeekSetExerciseLink | undefined>(() => {
    if (subject?.kind !== 'muscle') return undefined;
    const catalogued = new Set(catalog.exercises.map(exercise => exercise.id));
    return {
      canOpen: id => catalogued.has(id),
      open: id => router.push(progressHistoryHref({ exerciseDefinitionId: id, gymId }, muscleMetric)),
    };
  }, [catalog, muscleMetric, router, subject, gymId]);
  // A muscle's page opens on the exercise's metric when a muscle has it too
  // (Volume or Sets); 1RM and top weight are exercise-only, so it opens on Volume.
  const openMuscle = (muscleGroupId: string) => router.push(progressHistoryHref(
    { muscleGroupId, gymId },
    isProgressMetric(metric) ? metric : undefined
  ));

  if (unavailable || resolvingSelection) {
    return <HistoryScopeState unavailable={unavailable} loadError={catalog.lastError} />;
  }

  const gym: HistoryGymChoice = {
    value: gymId,
    options: history.gyms,
    onChange: next => setChosenGym({ gymId: next }),
    supportedOrientations: landscape ? ['landscape'] : undefined,
    allSessionCount: history.gyms.reduce((sum, option) => sum + (option.sessionCount ?? 0), 0),
  };
  const muscleFilters = subject.kind === 'muscle' ? <MuscleHistoryFilters gym={gym} metric={muscleMetric} subject={subject}
    onChangeSets={setChosenSecondary} onChangeVolume={setChosenSecondaryVolume} /> : null;
  const filters = muscleFilters ?? <GymPicker {...gym} size="compact" testID="stats-exercise-history-gym" />;
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
    view,
    weeklyEffort: history.weekly,
    timeline: {
      weekSetsTarget: historySetsTarget(subject, muscleMetric),
      onOpenSession: openSession,
      exerciseLink,
      stack,
    },
  };

  return (
    <Screen testID="progress-history-screen">
      <HistoryHeader
        entryExercise={exercise}
        landscape={landscape}
        muscles={muscleLinks}
        {...exerciseHistoryActions(subject, exercise, router)}
        selection={selection}
        onOpenMuscle={openMuscle}
        onOpenWeek={openWeek}
        title={name ?? PROGRESS_HISTORY_TITLE}
        titleSwitch={titleSwitch}
        week={focusedWeek}
        detailPeriod={detailPeriod}
      />
      {/* The view selector writes a preference; this is the only screen that
          now offers it, so a failed save says so here, with its Retry. */}
      {preferenceError && !landscape ? (
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
      {detailPeriod ? <HistoryPeriodDetail subject={subject} period={detailPeriod}
        metric={shownMetric} onSelectMetric={setMetric} filters={filters} onOpenSession={openSession}
        exerciseLink={exerciseLink} accountRevision={accountRevision} revision={revision} lookbackWeeks={values.historyLookbackWeeks} /> : (
        <HistoryView {...shared} kind={subject.kind === 'muscle' ? 'muscle' : 'exercise'} filters={filters} metric={shownMetric}
          metricOptions={subject.kind === 'exercise' ? EXERCISE_HISTORY_METRIC_OPTIONS : MUSCLE_HISTORY_METRIC_OPTIONS}
          muscleTargets={muscleTargets} onSelectMetric={setMetric}
          timelineDisplay={canExpandTimeline ? { expanded: landscape, onToggle: toggleTimelineLandscape } : undefined} />
      )}
    </Screen>
  );
}

export default function ProgressHistoryRoute() {
  const params = useLocalSearchParams<{
    exerciseDefinitionId?: string | string[];
    exerciseDefinitionIds?: string | string[];
    muscleGroupId?: string | string[];
    muscleGroupIds?: string | string[];
    metric?: string | string[];
    view?: string | string[];
    gymId?: string | string[];
    secondary?: string | string[];
    secondaryVolume?: string | string[];
    week?: string | string[];
    day?: string | string[];
  }>();
  const subject = resolveHistorySubject(params);
  const metric = resolveHistoryMetric(params.metric);
  const entryView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = entryView === 'timeline' || entryView === 'daily' || entryView === 'weekly' ? entryView : null;
  const detailPeriod = params.day !== undefined || params.week !== undefined ? parseHistoryJump(params) : undefined;
  // Progress pushes a fresh page each time, but a link can reach this route
  // while it is mounted: new params are a new page, opening on their own
  // metric and week rather than keeping the last link's.
  const gym = encodeGymRouteParam(subject?.gymId) ?? '';
  const countingKey = subject?.kind === 'muscle' ? `${subject.countSecondary}:${subject.countSecondaryVolume}` : '';
  return <ProgressHistoryScreen initialMetric={metric} initialView={view}
    detailPeriod={detailPeriod}
    key={`${subject?.kind}:${historySubjectId(subject)}:${metric}:${view}:${gym}:${countingKey}:${detailPeriod?.weekKey}:${detailPeriod?.dayKey}`}
    subject={subject} />;
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md },
});
