import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

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
  appendCompletedSessionExerciseAsPlanned as appendCompletedSessionExerciseAsPlannedDraft,
  isWorkingSessionSetType,
  normalizeSessionSetType,
  setSessionDeletedState,
  type SessionSetTypeValue,
} from '@/src/data';
import { parseCalculationSet } from '@/src/exercise-calculations';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { sessionViewHref } from '@/src/navigation/active-session-entry';
import { isDevMode } from '@/src/utils/isDevMode';
import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { loadHistoricalBestsExcluding } from '@/src/session-recorder/historical-bests';
import {
  isConfirmedPerformedSet,
  type SessionSetPerformanceStatus,
} from '@/src/session-recorder/set-semantics';
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
  sets: CompletedSessionDetailSet[];
};

export type CompletedSessionDetailRecord = {
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
  loadInsights?(sessionId: string): Promise<CompletedSessionInsights | null>;
  // The best 1RM of each exercise in every other completed session, for the
  // detail's record band. Optional: without it, no record shows.
  loadHistoricalBests?(
    sessionId: string,
    exerciseDefinitionIds: string[]
  ): Promise<ReadonlyMap<string, number | null>>;
  appendCompletedSessionExerciseAsPlanned(
    sessionId: string,
    sessionExerciseId: string
  ): Promise<{ sessionId: string }>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
};

export type CompletedSessionDetailScreenShellProps = {
  sessionId?: string | null;
  dataClient?: CompletedSessionDetailDataClient;
  presentation?: 'detail' | 'completion';
  shouldFailNextMaestroShare?: boolean;
  shouldFailNextMaestroCatalog?: boolean;
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
): 'detail' | 'completion' => (coerceRouteParam(value) === 'completion' ? 'completion' : 'detail');

const getCompletedPerformedSets = (
  sets: CompletedSessionDetailSet[]
): CompletedSessionDetailSet[] =>
  sets.filter(
    (set) =>
      isConfirmedPerformedSet(set) &&
      parseCalculationSet({
        weightValue: set.weight,
        repsValue: set.reps,
        setType: set.setType,
      }) !== null
  );

const DEFAULT_COMPLETED_SESSION_DETAILS: Record<string, CompletedSessionDetailRecord> = {
  'session-completed-1': {
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
        startedAt: sessionGraph.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationDisplay: formatSessionListCompactDuration(sessionGraph.durationSec),
        gymName: gymRecord?.name ?? null,
        deletedAt: sessionGraph.deletedAt ? sessionGraph.deletedAt.toISOString() : null,
        exercises: sessionGraph.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          name: exercise.name,
          sets: exercise.sets.map((set) => ({
            id: set.id,
            weight: set.weightValue,
            reps: set.repsValue,
            setType: normalizeSessionSetType(set.setType),
            performanceStatus: set.performanceStatus,
          })),
        })),
      };
    }

    return DEFAULT_COMPLETED_SESSION_DETAILS[sessionId] ?? null;
  },
  async loadInsights(sessionId) {
    return loadCompletedSessionInsights(sessionId);
  },
  async loadHistoricalBests(sessionId, exerciseDefinitionIds) {
    return loadHistoricalBestsExcluding(sessionId, exerciseDefinitionIds);
  },
  async appendCompletedSessionExerciseAsPlanned(sessionId, sessionExerciseId) {
    return appendCompletedSessionExerciseAsPlannedDraft(sessionId, sessionExerciseId);
  },
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
}: CompletedSessionDetailScreenShellProps) {
  const router = useRouter();
  const exerciseCatalog = useExerciseCatalog();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<CompletedSessionDetailRecord | null>(null);
  const [completedInsights, setCompletedInsights] = useState<CompletedSessionInsights | null>(null);
  const [historicalBests, setHistoricalBests] = useState<ReadonlyMap<string, number | null>>(
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
    setCompletedInsights(null);

    void dataClient
      .loadCompletedSession(sessionId)
      .then((loadedSession) => {
        if (cancelled) {
          return;
        }
        setSession(loadedSession);
        if (presentation !== 'detail' || !loadedSession || !dataClient.loadHistoricalBests) {
          return;
        }
        // Records are optional enrichment: while history loads, or if it
        // fails, the cards show none.
        const definitionIds = loadedSession.exercises.flatMap((exercise) =>
          exercise.exerciseDefinitionId ? [exercise.exerciseDefinitionId] : []
        );
        void dataClient
          .loadHistoricalBests(loadedSession.id, definitionIds)
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

    if (presentation !== 'detail' && dataClient.loadInsights) {
      void dataClient
        .loadInsights(sessionId)
        .then((loadedInsights) => {
          if (!cancelled) {
            setCompletedInsights(loadedInsights);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCompletedInsights(null);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [dataClient, presentation, sessionId]);

  useFocusEffect(
    useCallback(() => {
      const cleanup = reloadSession();
      return () => {
        cleanup?.();
      };
    }, [reloadSession])
  );

  const formattedStartedAt = useMemo(
    () => (session ? formatDateTimeStamp(session.startedAt) : '—'),
    [session]
  );
  const formattedCompletedAt = useMemo(
    () => (session ? formatDateTimeStamp(session.completedAt) : '—'),
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
  const performedSetCount = useMemo(
    () => performedExercises.reduce((count, exercise) => count + exercise.sets.length, 0),
    [performedExercises]
  );
  const workingSetCount = useMemo(
    () =>
      performedExercises.reduce(
        (count, exercise) =>
          count + exercise.sets.filter((set) => isWorkingSessionSetType(set.setType)).length,
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
      exercises: session.exercises.map((exercise, exerciseIndex) => ({
        id: exercise.id,
        orderIndex: exerciseIndex,
        exerciseDefinitionId: exercise.exerciseDefinitionId ?? null,
        exerciseName: exercise.name,
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

  // Both presentations draw their own top bar, like the session view they sit
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

  const handleAppendExercise = (sessionExerciseId: string) => {
    if (!session) {
      return;
    }

    setActionFeedback(null);
    void dataClient
      .appendCompletedSessionExerciseAsPlanned(session.id, sessionExerciseId)
      .then(({ sessionId: activeSessionId }) => {
        router.push(sessionViewHref(activeSessionId));
      })
      .catch((error) => {
        setActionFeedback(error instanceof Error ? error.message : 'Unable to append exercise block');
      });
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
        {presentation === 'detail' ? <ViewSessionTopBar onBack={handleBack} /> : <SessionTopBar mode="complete" />}
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

  if (isLoading) {
    return renderState('completed-session-detail-loading', 'Loading session...');
  }

  if (errorMessage) {
    return renderState('completed-session-detail-error', 'Unable to load session', errorMessage);
  }

  if (!sessionId || !session || (presentation === 'completion' && session.deletedAt !== null)) {
    return renderState(
      'completed-session-detail-empty',
      'Session not found',
      'This completed session could not be loaded.'
    );
  }

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
          muscleCatalogState={
            shouldFailNextMaestroCatalog || exerciseCatalog.status === 'error'
              ? 'error'
              : exerciseCatalog.status === 'ready'
                ? 'ready'
                : 'loading'
          }
          muscleSummary={shouldFailNextMaestroCatalog ? null : sessionMuscleSummary}
          onDone={handleCompletionExit}
          performedSetCount={performedSetCount}
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
        error={actionFeedback}
        model={buildCompletedSessionDetailModel(session.exercises, historicalBests)}
        onAppend={handleAppendExercise}
        onBack={handleBack}
        onEdit={handleEdit}
        onToggleDeleted={handleToggleDeletedState}
        summary={{
          start: formattedStartedAt,
          end: formattedCompletedAt,
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
  }>();
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
