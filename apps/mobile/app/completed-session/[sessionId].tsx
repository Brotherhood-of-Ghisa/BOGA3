import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SessionCompletionPresentation } from '@/components/session-recorder/session-completion-presentation';
import {
  ExerciseCardCollapsedSummary,
  SessionContentLayout,
} from '@/components/session-recorder/session-content-layout';
import { UiButton, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import {
  formatSessionListCompactDuration,
  listSessionExerciseAssignedTags,
  loadLocalGymById,
  loadSessionSnapshotById,
  appendCompletedSessionExerciseAsPlanned as appendCompletedSessionExerciseAsPlannedDraft,
  formatSessionSetType,
  isWorkingSessionSetType,
  normalizeSessionSetType,
  setSessionDeletedState,
  type SessionSetTypeValue,
} from '@/src/data';
import { parseCalculationSet } from '@/src/exercise-calculations';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { activeSessionHref, sessionViewHref } from '@/src/navigation/active-session-entry';
import { loadActiveSessionId } from '@/src/session-entry';
import { useNewScreensEnabled } from '@/src/session-recorder/new-screens-preference';
import { isDevMode } from '@/src/utils/isDevMode';
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

export type CompletedSessionDetailSet = {
  id: string;
  weight: string;
  reps: string;
  setType: SessionSetTypeValue;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type CompletedSessionDetailExerciseTag = {
  tagDefinitionId: string;
  name: string;
  deletedAt: string | null;
};

export type CompletedSessionDetailExercise = {
  id: string;
  exerciseDefinitionId?: string | null;
  name: string;
  machineName: string | null;
  tags: CompletedSessionDetailExerciseTag[];
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
  appendCompletedSessionExerciseAsPlanned(sessionId: string, sessionExerciseId: string): Promise<void>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
};

export type CompletedSessionDetailScreenShellProps = {
  sessionId?: string | null;
  dataClient?: CompletedSessionDetailDataClient;
  initialMode?: 'view' | 'edit';
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

const formatSetEffortLabel = (setType: SessionSetTypeValue): string =>
  formatSessionSetType(setType) ?? '-';

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
        machineName: 'Flat Bench',
        tags: [],
        sets: [
          { id: 'm7-detail-set-1', weight: '185', reps: '8', setType: null },
          { id: 'm7-detail-set-2', weight: '185', reps: '6', setType: null },
        ],
      },
      {
        id: 'm7-detail-ex-2',
        exerciseDefinitionId: null,
        name: 'Lat Pulldown',
        machineName: 'Cable',
        tags: [],
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
        machineName: 'Hammer Strength',
        tags: [],
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
      const tagsBySessionExerciseId = new Map<string, CompletedSessionDetailExerciseTag[]>(
        await Promise.all(
          sessionGraph.exercises.map(async (exercise) => {
            try {
              const assignedTags = await listSessionExerciseAssignedTags(exercise.id);
              return [
                exercise.id,
                assignedTags.map((tag) => ({
                  tagDefinitionId: tag.tagDefinitionId,
                  name: tag.name,
                  deletedAt: tag.deletedAt ? tag.deletedAt.toISOString() : null,
                })),
              ] as const;
            } catch {
              return [exercise.id, [] as CompletedSessionDetailExerciseTag[]] as const;
            }
          })
        )
      );

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
          machineName: exercise.machineName,
          tags: tagsBySessionExerciseId.get(exercise.id) ?? [],
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
  async appendCompletedSessionExerciseAsPlanned(sessionId, sessionExerciseId) {
    await appendCompletedSessionExerciseAsPlannedDraft(sessionId, sessionExerciseId);
  },
  async setCompletedSessionDeletedState(sessionId, isDeleted) {
    await setSessionDeletedState(sessionId, isDeleted);
  },
};

export function CompletedSessionDetailScreenShell({
  sessionId,
  dataClient = DEFAULT_COMPLETED_SESSION_DETAIL_DATA_CLIENT,
  initialMode = 'view',
  presentation = 'detail',
  shouldFailNextMaestroShare = false,
  shouldFailNextMaestroCatalog = false,
}: CompletedSessionDetailScreenShellProps) {
  const router = useRouter();
  const [newScreensEnabled] = useNewScreensEnabled();
  const exerciseCatalog = useExerciseCatalog();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<CompletedSessionDetailRecord | null>(null);
  const [completedInsights, setCompletedInsights] = useState<CompletedSessionInsights | null>(null);
  const [collapsedExerciseIds, setCollapsedExerciseIds] = useState<Set<string>>(() => new Set());
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const toggleExerciseCollapsed = useCallback((exerciseId: string) => {
    setCollapsedExerciseIds((current) => {
      const next = new Set(current);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  }, []);
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
    setCollapsedExerciseIds(new Set());
    setCompletedInsights(null);

    void dataClient
      .loadCompletedSession(sessionId)
      .then((loadedSession) => {
        if (cancelled) {
          return;
        }
        setSession(loadedSession);
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

  const deleteLabel = isTogglingDeletedState
    ? session?.deletedAt
      ? 'Undeleting...'
      : 'Deleting...'
    : session?.deletedAt
      ? 'Undelete'
      : 'Delete';
  const editLabel = 'Edit';

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
      <UiButton
        accessibilityLabel="Back to Stats and History"
        label="Back to Stats and History"
        testID="session-completion-safe-exit"
        onPress={handleCompletionExit}
      />
    ) : null;

  const stackOptions =
    presentation === 'completion'
      ? { title: 'Session complete', headerBackVisible: false, gestureEnabled: false }
      : { title: 'View Session' };

  // Edited in the session view, whatever the new-screens setting says.
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
      .then(async () => {
        const activeSessionId = newScreensEnabled ? await loadActiveSessionId() : null;
        router.push(activeSessionHref(activeSessionId, newScreensEnabled));
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
        setActionFeedback(
          nextIsDeleted ? 'Session hidden from default history.' : 'Session restored to default history.'
        );
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

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={stackOptions} />
        <View style={styles.centerState} testID="completed-session-detail-loading">
          <Text style={styles.stateTitle}>Loading session...</Text>
          {safeExitButton}
        </View>
      </>
    );
  }

  if (errorMessage) {
    return (
      <>
        <Stack.Screen options={stackOptions} />
        <View style={styles.centerState} testID="completed-session-detail-error">
          <Text style={styles.stateTitle}>Unable to load session</Text>
          <Text style={styles.stateBody}>{errorMessage}</Text>
          {safeExitButton}
        </View>
      </>
    );
  }

  if (!sessionId || !session || (presentation === 'completion' && session.deletedAt !== null)) {
    return (
      <>
        <Stack.Screen options={stackOptions} />
        <View style={styles.centerState} testID="completed-session-detail-empty">
          <Text style={styles.stateTitle}>Session not found</Text>
          <Text style={styles.stateBody}>This completed session could not be loaded.</Text>
          {safeExitButton}
        </View>
      </>
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
        <SessionCompletionPresentation
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
      <Stack.Screen options={{ title: 'View Session' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        stickyHeaderIndices={[0]}
        testID="completed-session-detail-screen">
        <View style={styles.stickyActionBarWrap}>
          <View style={styles.actionBarCard}>
            <View style={styles.actionBar} testID="completed-session-detail-action-bar">
              <Pressable
                accessibilityRole="button"
                onPress={handleEdit}
                style={[styles.actionBarButton, styles.actionBarPrimaryButton]}
                testID="completed-session-detail-edit-button">
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={styles.actionBarPrimaryButtonText}>
                  {editLabel}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={isTogglingDeletedState}
                onPress={handleToggleDeletedState}
                style={[
                  styles.actionBarButton,
                  styles.actionBarDangerButton,
                  isTogglingDeletedState ? styles.disabledActionButton : null,
                ]}
                testID="completed-session-detail-delete-button">
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[
                    styles.actionBarDangerButtonText,
                    isTogglingDeletedState ? styles.disabledActionButtonText : null,
                  ]}>
                  {deleteLabel}
                </Text>
              </Pressable>
            </View>

            {actionFeedback ? <Text style={styles.actionFeedbackText}>{actionFeedback}</Text> : null}
          </View>
        </View>

        <View style={styles.headerCard}>
          <View style={styles.metricGrid}>
            <View style={styles.metricCell}>
              <Text
                adjustsFontSizeToFit
                ellipsizeMode="clip"
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.metricLabel}>
                Start
              </Text>
              <Text style={styles.metricValue}>{formattedStartedAt}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text
                adjustsFontSizeToFit
                ellipsizeMode="clip"
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.metricLabel}>
                End
              </Text>
              <Text style={styles.metricValue}>{formattedCompletedAt}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text
                adjustsFontSizeToFit
                ellipsizeMode="clip"
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.metricLabel}>
                Duration
              </Text>
              <Text style={styles.metricValue}>{session.durationDisplay}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text
                adjustsFontSizeToFit
                ellipsizeMode="clip"
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.metricLabel}>
                Location
              </Text>
              <Text numberOfLines={1} style={styles.metricValue}>
                {session.gymName?.trim() ? session.gymName : 'No gym'}
              </Text>
            </View>
          </View>
        </View>

        <SessionContentLayout<CompletedSessionDetailSet, CompletedSessionDetailExercise>
          collapsedExerciseIds={collapsedExerciseIds}
          onToggleExerciseCollapse={toggleExerciseCollapsed}
          renderCollapsedExerciseSummary={({ exercise }) => {
            const performedSets = getCompletedPerformedSets(exercise.sets);
            const workingSetCount = performedSets.filter(
              (set) => {
                const setType = normalizeSessionSetType(set.setType);
                return isWorkingSessionSetType(setType);
              }
            ).length;

            return (
              <ExerciseCardCollapsedSummary
                workingSetCount={workingSetCount}
                setCount={performedSets.length}
                testID={`completed-session-detail-collapsed-summary-${exercise.id}`}
              />
            );
          }}
          showMetadataSection={false}
          dateTimeValue={
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyFieldText}>{formattedStartedAt}</Text>
            </View>
          }
          gymValue={
            <View style={styles.readOnlyField}>
              <Text numberOfLines={1} style={styles.readOnlyFieldText}>
                {session.gymName?.trim() ? session.gymName : 'No gym'}
              </Text>
            </View>
          }
          exercises={performedExercises}
          emptyExercisesText="No exercises logged in this session."
          renderExerciseHeaderAction={({ exercise }) => (
            <Pressable
              accessibilityLabel={`Append ${exercise.name || 'exercise'} block to current session`}
              accessibilityRole="button"
              onPress={() => handleAppendExercise(exercise.id)}
              style={[styles.exerciseAppendButton, styles.actionBarSecondaryButton]}
              testID={`completed-session-detail-append-exercise-button-${exercise.id}`}>
              <Text
                adjustsFontSizeToFit
                ellipsizeMode="clip"
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.actionBarSecondaryButtonText}>
                Append
              </Text>
            </Pressable>
          )}
          renderSetRow={({ exercise, set, setIndex }) => (
            <View>
              {setIndex === 0 ? (
                <View
                  style={styles.setTableHeaderRow}
                  testID={`completed-session-detail-sets-table-header-${exercise.id}`}>
                  <Text
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={[styles.setTableHeaderCell, styles.setTableIndexCell]}>
                    Set
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={[styles.setTableHeaderCell, styles.setTableValueCell]}>
                    Weight
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={[styles.setTableHeaderCell, styles.setTableValueCell]}>
                    Reps
                  </Text>
                  <Text
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.75}
                    numberOfLines={1}
                    style={[styles.setTableHeaderCell, styles.setTableEffortCell]}>
                    Effort
                  </Text>
                </View>
              ) : null}
              <View style={styles.setTableRow} testID={`completed-session-detail-set-row-${set.id}`}>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[styles.setTableCell, styles.setTableIndexCell]}>
                  {setIndex + 1}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[styles.setTableCell, styles.setTableValueCell]}>
                  {set.weight || '—'}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[styles.setTableCell, styles.setTableValueCell]}>
                  {set.reps || '—'}
                </Text>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[styles.setTableCell, styles.setTableEffortCell]}>
                  {formatSetEffortLabel(set.setType)}
                </Text>
              </View>
            </View>
          )}
          renderExerciseMeta={({ exercise }) =>
            exercise.tags.length > 0 ? (
              <View style={styles.exerciseTagSection} testID={`completed-session-detail-tags-${exercise.id}`}>
                <View style={styles.exerciseTagChipWrap}>
                  {exercise.tags.map((tag) => (
                    <View
                      key={`${exercise.id}-${tag.tagDefinitionId}`}
                      style={[styles.exerciseTagChip, tag.deletedAt ? styles.exerciseTagChipDeleted : null]}>
                      <Text numberOfLines={1} style={styles.exerciseTagChipText}>
                        {tag.deletedAt ? `${tag.name} (deleted)` : tag.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      </ScrollView>
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
  const initialMode = 'view';

  useEffect(() => {
    if (intent !== 'edit' || !sessionId) {
      return;
    }

    router.replace(sessionViewHref(sessionId));
  }, [intent, router, sessionId]);

  if (intent === 'edit' && sessionId) {
    return (
      <View style={styles.centerState} testID="completed-session-detail-edit-redirect">
        <Text style={styles.stateTitle}>Opening editor...</Text>
      </View>
    );
  }

  return (
    <CompletedSessionDetailScreenShell
      initialMode={initialMode}
      presentation={presentation}
      sessionId={sessionId}
      shouldFailNextMaestroCatalog={shouldFailNextMaestroCatalog}
      shouldFailNextMaestroShare={shouldFailNextMaestroShare}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: uiSpace.xl,
    gap: uiSpace.lg,
    backgroundColor: uiColors.surfacePage,
  },
  stickyActionBarWrap: {
    backgroundColor: uiColors.surfacePage,
    paddingBottom: uiSpace.xs,
  },
  centerState: {
    flex: 1,
    padding: uiSpace.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfacePage,
  },
  stateTitle: {
    fontSize: uiTypography.size.lg,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
    textAlign: 'center',
  },
  headerCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.md,
  },
  metricCell: {
    width: '48%',
    gap: uiSpace.xs,
  },
  metricLabel: {
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  metricValue: {
    color: uiColors.textPrimary,
    fontSize: uiTypography.size.base,
    fontWeight: '700',
  },
  actionBarCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  actionBarButton: {
    flex: 1,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 36,
  },
  actionBarPrimaryButton: {
    backgroundColor: uiColors.actionPrimary,
    borderColor: uiColors.actionPrimary,
  },
  actionBarPrimaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  actionBarSecondaryButton: {
    backgroundColor: uiColors.actionNeutralSubtleBg,
    borderColor: uiColors.actionNeutralSubtleBorder,
  },
  actionBarSecondaryButtonText: {
    color: uiColors.actionNeutralSubtleText,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  disabledActionButton: {
    backgroundColor: uiColors.surfaceDisabled,
    borderColor: uiColors.borderMuted,
  },
  disabledActionButtonText: {
    color: uiColors.textDisabled,
  },
  reopenHintText: {
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.sm,
  },
  actionBarDangerButton: {
    backgroundColor: uiColors.actionDangerSubtleBg,
    borderColor: uiColors.actionDangerSubtleBorder,
  },
  actionBarDangerButtonText: {
    color: uiColors.actionDangerText,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  exerciseAppendButton: {
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 34,
    maxWidth: 96,
  },
  actionFeedbackText: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  editModeBanner: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.surfaceInfo,
    padding: uiSpace.md,
    gap: uiSpace.xs,
  },
  editModeBannerTitle: {
    color: uiColors.textAccentStrong,
    fontSize: uiTypography.size.md,
    fontWeight: '700',
  },
  editModeBannerBody: {
    color: uiColors.textAccentMuted,
    fontSize: uiTypography.size.sm,
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
  },
  readOnlyFieldText: {
    color: uiColors.actionNeutralSubtleText,
    fontWeight: '600',
  },
  editFieldInput: {
    borderWidth: 1,
    borderColor: uiColors.borderInputStrong,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    color: uiColors.textPrimary,
    fontWeight: '600',
  },
  setRowEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.sm,
    padding: uiSpace.sm,
    backgroundColor: uiColors.surfaceInfo,
  },
  setIndexText: {
    color: uiColors.textPrimary,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  editSetInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: uiColors.borderInputStrong,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    color: uiColors.textPrimary,
    fontWeight: '600',
  },
  setTableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopLeftRadius: uiRadius.sm,
    borderTopRightRadius: uiRadius.sm,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  setTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderTopWidth: 0,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfaceDefault,
  },
  setTableCell: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  setTableHeaderCell: {
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  setTableIndexCell: {
    width: 36,
  },
  setTableValueCell: {
    flex: 1,
  },
  setTableEffortCell: {
    width: 56,
  },
  exerciseTagSection: {
    gap: uiSpace.sm,
  },
  exerciseTagChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
    alignItems: 'center',
  },
  exerciseTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: uiRadius.full,
    paddingVertical: uiSpace.xs,
    paddingHorizontal: uiSpace.sm,
    maxWidth: '100%',
  },
  exerciseTagChipDeleted: {
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
  },
  exerciseTagChipText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textAccentStrong,
    fontWeight: '600',
    maxWidth: 180,
  },
});
