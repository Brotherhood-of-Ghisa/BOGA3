import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { EMPTY_SESSION_WEIGHT, type ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { SessionMuscleBreakdown, SessionSummaryContent, type MuscleCatalogState } from '@/components/session-complete/session-summary-content';
import type { SessionComparisonMode } from '@/components/session-recorder/session-insight-presentation';
import type { ViewSessionSection } from '@/components/view-session/view-session-screen';
import { Card } from '@/components/ui/card';
import { SessionCompletionScreen } from '@/components/session-complete';
import { SessionTopBar } from '@/components/session-view';
import { ActionButton } from '@/components/ui/action-button';
import { StatePanel, type StatePanelKind } from '@/components/ui/state-panel';
import { uiRoles } from '@/components/ui/tokens';
import { ViewSessionScreen, ViewSessionTopBar } from '@/components/view-session';
import {
  formatSessionListCompactDuration,
  loadLocalGymById,
  loadSessionSnapshotById,
  setSessionDeletedState,
  type SessionSetTypeValue,
} from '@/src/data';
import { loadSessionRecordBaselines, toCompletedSessionDetailExercises } from '@/src/session-recorder/completed-session-cards';
import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { sessionViewHref } from '@/src/navigation/active-session-entry';
import { isDevMode } from '@/src/utils/isDevMode';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { completedSessionTitle } from '@/src/session-recorder/session-view-model';
import {
  isConfirmedPerformedSet,
  isWorkingSet,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';
import {
  deriveSessionExerciseVolumeComparisons,
  loadCompletedSessionInsights,
  summarizeCurrentSessionMuscleLoad,
  type CompletedSessionInsights,
} from '@/src/session-insights';

// The route's three non-content states; each keeps its testID for the flows.
type StateTestID = 'completed-session-detail-loading' | 'completed-session-detail-error' | 'completed-session-detail-empty';
const STATE_KIND: Record<StateTestID, StatePanelKind> = {
  'completed-session-detail-loading': 'loading',
  'completed-session-detail-error': 'error',
  'completed-session-detail-empty': 'message',
};

export type CompletedSessionDetailSet = {
  id: string;
  weight: string;
  reps: string;
  setType: SessionSetTypeValue;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type CompletedSessionDetailExercise = {
  id: string;
  exerciseDefinitionId?: string | null;
  name: string;
  loadContext?: LoadContext;
  sets: CompletedSessionDetailSet[];
};

export type CompletedSessionDetailRecord = ResolvedSessionWeight & {
  id: string;
  startedAt: string;
  completedAt: string;
  durationDisplay: string;
  gymName: string | null;
  deletedAt: string | null;
  exercises: CompletedSessionDetailExercise[];
};

export type CompletedSessionDetailDataClient = {
  loadCompletedSession(sessionId: string): Promise<CompletedSessionDetailRecord | null>;
  loadInsights?(sessionId: string, historyLookbackWeeks: number): Promise<CompletedSessionInsights | null>;
  // Each exercise's records in the sessions before this one, for the
  // detail's record band. Optional: without it, no record shows.
  loadHistoricalBests?(
    session: { sessionId: string; completedAt: Date },
    exerciseDefinitionIds: string[]
  ): Promise<ReadonlyMap<string, RecordBaseline>>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
};

export type CompletedSessionDetailScreenShellProps = {
  sessionId?: string | null;
  dataClient?: CompletedSessionDetailDataClient;
  presentation?: 'detail' | 'completion' | 'summary';
  shouldFailNextMaestroShare?: boolean;
  shouldFailNextMaestroCatalog?: boolean;
  maestroInsights?: 'loading' | 'error';
};

function formatDateTimeStamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  const year = parsed.getFullYear();
  const hours = `${parsed.getHours()}`.padStart(2, '0');
  const minutes = `${parsed.getMinutes()}`.padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function coerceRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export const resolveCompletedSessionPresentation = (
  value: string | string[] | undefined
): 'detail' | 'completion' | 'summary' => {
  const presentation = coerceRouteParam(value);
  return presentation === 'completion' || presentation === 'summary' ? presentation : 'detail';
};

const getCompletedPerformedSets = (
  sets: CompletedSessionDetailSet[]
): CompletedSessionDetailSet[] =>
  sets.filter((set) => isConfirmedPerformedSet(set));

const DEFAULT_COMPLETED_SESSION_DETAILS: Record<string, CompletedSessionDetailRecord> = {
  'session-completed-1': {
    ...EMPTY_SESSION_WEIGHT,
    id: 'session-completed-1',
    startedAt: '2026-02-19T16:00:00.000Z',
    completedAt: '2026-02-19T16:58:00.000Z',
    durationDisplay: '58m',
    gymName: 'Westside Barbell Club',
    deletedAt: null,
    exercises: [
      {
        id: 'm7-detail-ex-1',
        exerciseDefinitionId: null,
        name: 'Bench Press',
        sets: [
          { id: 'm7-detail-set-1', weight: '185', reps: '8', setType: null },
          { id: 'm7-detail-set-2', weight: '185', reps: '6', setType: null },
        ],
      },
      {
        id: 'm7-detail-ex-2',
        exerciseDefinitionId: null,
        name: 'Lat Pulldown',
        sets: [
          { id: 'm7-detail-set-3', weight: '120', reps: '12', setType: null },
          { id: 'm7-detail-set-4', weight: '120', reps: '12', setType: null },
        ],
      },
    ],
  },
  'session-completed-2': {
    ...EMPTY_SESSION_WEIGHT,
    id: 'session-completed-2',
    startedAt: '2026-02-17T18:10:00.000Z',
    completedAt: '2026-02-17T19:15:00.000Z',
    durationDisplay: '1h 5m',
    gymName: 'Downtown Fitness',
    deletedAt: '2026-02-18T08:00:00.000Z',
    exercises: [
      {
        id: 'm7-detail-ex-3',
        exerciseDefinitionId: null,
        name: 'Leg Press',
        sets: [
          { id: 'm7-detail-set-5', weight: '360', reps: '10', setType: null },
          { id: 'm7-detail-set-6', weight: '360', reps: '10', setType: null },
        ],
      },
    ],
  },
};

export const DEFAULT_COMPLETED_SESSION_DETAIL_DATA_CLIENT: CompletedSessionDetailDataClient = {
  async loadCompletedSession(sessionId) {
    const sessionGraph = await loadSessionSnapshotById(sessionId);

    if (sessionGraph && sessionGraph.status === 'completed') {
      const gymRecord = sessionGraph.gymId ? await loadLocalGymById(sessionGraph.gymId) : null;
      const completedAt = sessionGraph.completedAt ?? sessionGraph.startedAt;
      return {
        id: sessionGraph.sessionId,
        bodyWeightKg: sessionGraph.bodyWeightKg,
        bodyWeightSource: sessionGraph.bodyWeightSource,
        bodyWeightMeasurementId: sessionGraph.bodyWeightMeasurementId,
        bodyWeightMeasuredAt: sessionGraph.bodyWeightMeasuredAt,

        startedAt: sessionGraph.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationDisplay: formatSessionListCompactDuration(sessionGraph.durationSec),
        gymName: gymRecord?.name ?? null,
        deletedAt: sessionGraph.deletedAt ? sessionGraph.deletedAt.toISOString() : null,
        exercises: toCompletedSessionDetailExercises(sessionGraph.exercises),
      };
    }

    return DEFAULT_COMPLETED_SESSION_DETAILS[sessionId] ?? null;
  },
  async loadInsights(sessionId, historyLookbackWeeks) {
    return loadCompletedSessionInsights(sessionId, historyLookbackWeeks);
  },
  loadHistoricalBests: loadSessionRecordBaselines,
  async setCompletedSessionDeletedState(sessionId, isDeleted) {
    await setSessionDeletedState(sessionId, isDeleted);
  },
};

export function CompletedSessionDetailScreenShell({
  sessionId,
  dataClient = DEFAULT_COMPLETED_SESSION_DETAIL_DATA_CLIENT,
  presentation = 'detail',
  shouldFailNextMaestroShare = false,
  shouldFailNextMaestroCatalog = false,
  maestroInsights,
}: CompletedSessionDetailScreenShellProps) {
  const router = useRouter();
  const exerciseCatalog = useExerciseCatalog();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const datedWeightRevision = useBodyWeightContextRevision();
  const { values: { historyLookbackWeeks }, accountRevision } = useAccountLocalPreferenceState();
  const [session, setSession] = useState<CompletedSessionDetailRecord | null>(null);
  const [completedInsights, setCompletedInsights] = useState<CompletedSessionInsights | null>(null);
  const [insightState, setInsightState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [section, setSection] = useState<ViewSessionSection>('summary');
  const [comparisonMode, setComparisonMode] = useState<SessionComparisonMode>('exercise');
  const isDeleted = session?.deletedAt != null;
  // Another session opens on its summary, reset in the render that shows it.
  const [shownSessionId, setShownSessionId] = useState(sessionId);
  if (shownSessionId !== sessionId) {
    setShownSessionId(sessionId);
    setSection('summary');
    setComparisonMode('exercise');
  }
  const [historicalBests, setHistoricalBests] = useState<ReadonlyMap<string, RecordBaseline>>(
    () => new Map()
  );
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isTogglingDeletedState, setIsTogglingDeletedState] = useState(false);

  const reloadSession = useCallback(() => {
    let cancelled = false;

    if (!sessionId) {
      setSession(null);
      setErrorMessage(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    setErrorMessage(null);
    setActionFeedback(null);
    setHistoricalBests(new Map());

    void dataClient
      .loadCompletedSession(sessionId)
      .then((loadedSession) => {
        if (cancelled) {
          return;
        }
        setSession(loadedSession);
        if (presentation === 'completion' || !loadedSession || !dataClient.loadHistoricalBests) {
          return;
        }
        // Records are optional enrichment: while history loads, or if it
        // fails, the cards show none.
        const definitionIds = loadedSession.exercises.flatMap((exercise) =>
          exercise.exerciseDefinitionId ? [exercise.exerciseDefinitionId] : []
        );
        void dataClient
          .loadHistoricalBests(
            { sessionId: loadedSession.id, completedAt: new Date(loadedSession.completedAt) },
            definitionIds
          )
          .then((bests) => {
            if (!cancelled) setHistoricalBests(bests);
          })
          .catch(() => undefined);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load session');
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  // A saved weight invalidates this read without changing the route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataClient, presentation, sessionId, datedWeightRevision]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = reloadSession();
      return () => {
        cleanup?.();
      };
    }, [reloadSession])
  );

  // Enrichment has its own focus lifecycle: a slow/failed history read never
  // prevents reviewing sets or using session actions. Delete/undelete refreshes
  // just these projections, preserving the review section and facts.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const isCurrent = () => !cancelled && accountRevision === getAccountLocalPreferenceAccountRevision();
      setCompletedInsights(null);
      setInsightState(dataClient.loadInsights ? 'loading' : 'error');
      if (!sessionId || isDeleted) {
        setInsightState('error');
        return;
      }
      if (maestroInsights) {
        setInsightState(maestroInsights);
      } else if (dataClient.loadInsights) {
        void dataClient
          .loadInsights(sessionId, historyLookbackWeeks)
          .then((loadedInsights) => {
            if (isCurrent()) {
              setCompletedInsights(loadedInsights);
              setInsightState(loadedInsights ? 'ready' : 'error');
            }
          })
          .catch(() => {
            if (isCurrent()) {
              setCompletedInsights(null);
              setInsightState('error');
            }
          });
      }

      return () => { cancelled = true; };
    // Weight corrections invalidate the derived comparisons too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataClient, sessionId, isDeleted, maestroInsights, datedWeightRevision, historyLookbackWeeks, accountRevision])
  );

  const formattedStartedAt = useMemo(
    () => (session ? formatDateTimeStamp(session.startedAt) : '—'),
    [session]
  );
  const performedExercises = useMemo(
    () =>
      session?.exercises
        .map((exercise) => ({
          ...exercise,
          sets: getCompletedPerformedSets(exercise.sets),
        }))
        .filter((exercise) => exercise.sets.length > 0) ?? [],
    [session]
  );
  const workingSetCount = useMemo(
    () =>
      performedExercises.reduce(
        (count, exercise) =>
          count + exercise.sets.filter((set) => isWorkingSet(set, exercise.loadContext?.effortPolicy)).length,
        0
      ),
    [performedExercises]
  );
  const sessionMuscleSummary = useMemo(() => {
    if (!session || exerciseCatalog.status !== 'ready') {
      return null;
    }

    return summarizeCurrentSessionMuscleLoad({
      sessionId: session.id,
      sessionAt: new Date(session.completedAt),
      bodyWeightKg: session.bodyWeightKg,
      exercises: session.exercises.map((exercise, exerciseIndex) => ({
        id: exercise.id,
        orderIndex: exerciseIndex,
        exerciseDefinitionId: exercise.exerciseDefinitionId ?? null,
        exerciseName: exercise.name,
        loadContext: exercise.loadContext,
        sets: exercise.sets.map((set, setIndex) => ({
          id: set.id,
          orderIndex: setIndex,
          weightValue: set.weight,
          repsValue: set.reps,
          setType: set.setType,
          performanceStatus: set.performanceStatus,
        })),
      })),
      exerciseDefinitions: exerciseCatalog.exercises.map((exercise) => ({
        id: exercise.id,
        loadInputMode: exercise.loadInputMode ?? 'total_load',
        bodyweightContribution: exercise.bodyweightContribution,
      })),
      muscleMappings: exerciseCatalog.exercises.flatMap((exercise) =>
        exercise.mappings.map((mapping) => ({
          exerciseDefinitionId: exercise.id,
          muscleGroupId: mapping.muscleGroupId,
          role: mapping.role,
          weight: mapping.weight,
        }))
      ),
      muscleGroups: exerciseCatalog.muscleGroups,
    });
  }, [exerciseCatalog.exercises, exerciseCatalog.muscleGroups, exerciseCatalog.status, session]);

  const fallbackExerciseVolumeComparisons = useMemo(() => {
    if (!session) return [];
    return deriveSessionExerciseVolumeComparisons({
      targetSession: {
        sessionId: session.id,
        status: 'completed',
        completedAt: new Date(session.completedAt),
        deletedAt: session.deletedAt ? new Date(session.deletedAt) : null,
        exercises: session.exercises.map((exercise, exerciseIndex) => ({
          id: exercise.id,
          orderIndex: exerciseIndex,
          exerciseDefinitionId: exercise.exerciseDefinitionId ?? null,
          exerciseName: exercise.name,
        loadContext: exercise.loadContext,
          sets: exercise.sets.map((set, setIndex) => ({
            id: set.id,
            orderIndex: setIndex,
            weightValue: set.weight,
            repsValue: set.reps,
            setType: set.setType,
            performanceStatus: set.performanceStatus,
          })),
        })),
      },
      historicalSessions: [],
    });
  }, [session]);

  const handleCompletionExit = useCallback(() => {
    router.replace('/progress');
  }, [router]);

  useEffect(() => {
    if (presentation !== 'completion') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCompletionExit();
      return true;
    });
    return () => subscription.remove();
  }, [handleCompletionExit, presentation]);

  const safeExitButton =
    presentation === 'completion' ? (
      <ActionButton
        label="Back to Progress"
        onPress={handleCompletionExit}
        testID="session-completion-safe-exit"
        variant="outline"
      />
    ) : null;

  // All presentations draw their own top bar, like the session view they sit
  // beside; completion also blocks the back gesture (its exits replace to
  // Progress). The stack title is the back label of what the detail pushes.
  const stackOptions =
    presentation === 'completion'
      ? { title: 'Session complete', headerShown: false, gestureEnabled: false }
      : { title: 'View Session', headerShown: false };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/progress');
    }
  };

  // Completed sessions are edited in the session view.
  const handleEdit = () => {
    if (!session) {
      return;
    }

    router.push(sessionViewHref(session.id));
  };

  const handleToggleDeletedState = () => {
    if (!session || isTogglingDeletedState) {
      return;
    }

    const sessionId = session.id;
    const nextIsDeleted = session.deletedAt === null;
    setActionFeedback(null);
    setIsTogglingDeletedState(true);

    void dataClient
      .setCompletedSessionDeletedState(sessionId, nextIsDeleted)
      .then(() => {
        setSession((current) => {
          if (!current || current.id !== sessionId) {
            return current;
          }

          return {
            ...current,
            deletedAt: nextIsDeleted ? new Date().toISOString() : null,
          };
        });
      })
      .catch((error) => {
        setActionFeedback(
          error instanceof Error ? error.message : 'Unable to update deleted state for this session.'
        );
      })
      .finally(() => {
        setIsTogglingDeletedState(false);
      });
  };

  // Loading, error and not-found keep the route's frame: the detail's top bar
  // (back only), or the completion's (no Done) and its one safe exit.
  const renderState = (testID: StateTestID, title: string, body?: string) => (
    <>
      <Stack.Screen options={stackOptions} />
      <View style={styles.frame}>
        {presentation !== 'completion' ? <ViewSessionTopBar onBack={handleBack} /> : <SessionTopBar mode="complete" />}
        <StatePanel
          body={body}
          kind={STATE_KIND[testID]}
          testID={testID}
          title={title}>
          {safeExitButton}
        </StatePanel>
      </View>
    </>
  );

  // A background read must preserve open editors and their unsaved input.
  const hasLoadedSession = session !== null && session.id === sessionId;
  if (isLoading && !hasLoadedSession) {
    return renderState('completed-session-detail-loading', 'Loading session...');
  }

  if (errorMessage && !hasLoadedSession) {
    return renderState('completed-session-detail-error', 'Unable to load session', errorMessage);
  }

  if (!sessionId || !session || (presentation === 'completion' && session.deletedAt !== null)) {
    return renderState(
      'completed-session-detail-empty',
      'Session not found',
      'This completed session could not be loaded.'
    );
  }

  const muscleCatalogState: MuscleCatalogState =
    shouldFailNextMaestroCatalog || exerciseCatalog.status === 'error'
      ? 'error'
      : exerciseCatalog.status === 'ready' ? 'ready' : 'loading';

  if (presentation === 'completion') {
    const personalRecords = completedInsights?.personalRecords ?? [];
    const exerciseVolumeComparisons =
      completedInsights && completedInsights.exerciseVolumeComparisons.length > 0
        ? completedInsights.exerciseVolumeComparisons
        : fallbackExerciseVolumeComparisons;
    return (
      <>
        <Stack.Screen options={stackOptions} />
        <SessionCompletionScreen
          completedAt={session.completedAt}
          durationDisplay={session.durationDisplay}
          exerciseCount={performedExercises.length}
          exerciseVolumeComparisons={exerciseVolumeComparisons}
          gymName={session.gymName}
          muscleCatalogState={muscleCatalogState}
          muscleSummary={shouldFailNextMaestroCatalog ? null : sessionMuscleSummary}
          muscleVolumeComparisons={completedInsights?.muscleVolumeComparisons ?? []}
          onDone={handleCompletionExit}
          personalRecords={personalRecords}
          shouldFailNextShare={shouldFailNextMaestroShare}
          workingSetCount={workingSetCount}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={stackOptions} />
      <ViewSessionScreen
        section={section}
        onSectionChange={setSection}
        summaryContent={
          <>
            {workingSetCount > 0 ? (
              <Card>
                <SessionMuscleBreakdown
                  standalone
                  workingSetCount={workingSetCount}
                  muscleSummary={shouldFailNextMaestroCatalog ? null : sessionMuscleSummary}
                  muscleCatalogState={muscleCatalogState}
                />
              </Card>
            ) : null}
            <SessionSummaryContent
              completedAt={session.completedAt}
              durationDisplay={session.durationDisplay}
              exerciseCount={performedExercises.length}
              workingSetCount={workingSetCount}
              personalRecords={completedInsights?.personalRecords ?? []}
              exerciseVolumeComparisons={completedInsights?.exerciseVolumeComparisons ?? []}
              muscleVolumeComparisons={completedInsights?.muscleVolumeComparisons ?? []}
              historyState={insightState}
              unavailableMessage={isDeleted ? 'Comparisons unavailable for deleted sessions.' : undefined}
              muscleCatalogState={muscleCatalogState}
              comparisonMode={comparisonMode}
              onComparisonModeChange={setComparisonMode}
              shouldFailNextShare={shouldFailNextMaestroShare}
            />
          </>
        }
        error={actionFeedback ?? errorMessage}
        model={buildCompletedSessionDetailModel(session.exercises, historicalBests)}
        onBack={handleBack}
        onEdit={handleEdit}
        onToggleDeleted={handleToggleDeletedState}
        summary={{
          title: completedSessionTitle(new Date(session.startedAt)),
          start: formattedStartedAt,
          duration: session.durationDisplay,
          gymName: session.gymName,
          deleted: session.deletedAt !== null,
        }}
      />
    </>
  );
}

export default function CompletedSessionDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    intent?: string | string[];
    presentation?: string | string[];
    maestroShare?: string | string[];
    maestroCatalog?: string | string[];
    maestroInsights?: string | string[];
  }>();
  const maestroInsightsParam = coerceRouteParam(params.maestroInsights);
  const maestroInsights = isDevMode() && (maestroInsightsParam === 'loading' || maestroInsightsParam === 'error') ? maestroInsightsParam : undefined;
  const sessionId = coerceRouteParam(params.sessionId);
  const intent = coerceRouteParam(params.intent);
  const presentation = resolveCompletedSessionPresentation(params.presentation);
  const shouldFailNextMaestroShare =
    isDevMode() && coerceRouteParam(params.maestroShare) === 'fail-once';
  const shouldFailNextMaestroCatalog =
    isDevMode() && coerceRouteParam(params.maestroCatalog) === 'fail-once';

  useEffect(() => {
    if (intent !== 'edit' || !sessionId) {
      return;
    }

    router.replace(sessionViewHref(sessionId));
  }, [intent, router, sessionId]);

  if (intent === 'edit' && sessionId) {
    return (
      <View style={styles.frame}>
        <StatePanel testID="completed-session-detail-edit-redirect" title="Opening editor..." />
      </View>
    );
  }

  return (
    <CompletedSessionDetailScreenShell
      maestroInsights={maestroInsights}
      presentation={presentation}
      sessionId={sessionId}
      shouldFailNextMaestroCatalog={shouldFailNextMaestroCatalog}
      shouldFailNextMaestroShare={shouldFailNextMaestroShare}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
});
