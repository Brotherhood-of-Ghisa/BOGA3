import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SessionContentLayout } from '@/components/session-recorder/session-content-layout';
import { uiColors } from '@/components/ui';
import {
  formatSessionListCompactDuration,
  listSessionExerciseAssignedTags,
  loadLocalGymById,
  loadSessionSnapshotById,
  appendCompletedSessionExerciseAsPlanned as appendCompletedSessionExerciseAsPlannedDraft,
  normalizeSessionSetType,
  setSessionDeletedState,
  type SessionSetTypeValue,
} from '@/src/data';

export type CompletedSessionDetailSet = {
  id: string;
  weight: string;
  reps: string;
  setType: SessionSetTypeValue;
};

export type CompletedSessionDetailExerciseTag = {
  tagDefinitionId: string;
  name: string;
  deletedAt: string | null;
};

export type CompletedSessionDetailExercise = {
  id: string;
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
  appendCompletedSessionExerciseAsPlanned(sessionId: string, sessionExerciseId: string): Promise<void>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
};

export type CompletedSessionDetailScreenShellProps = {
  sessionId?: string | null;
  dataClient?: CompletedSessionDetailDataClient;
  initialMode?: 'view' | 'edit';
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

const formatSetEffortLabel = (setType: SessionSetTypeValue): string => {
  switch (setType) {
    case 'warm_up':
      return 'W-Up';
    case 'rir_0':
      return 'RIR 0';
    case 'rir_1':
      return 'RIR 1';
    case 'rir_2':
      return 'RIR 2';
    default:
      return '-';
  }
};

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
          name: exercise.name,
          machineName: exercise.machineName,
          tags: tagsBySessionExerciseId.get(exercise.id) ?? [],
          sets: exercise.sets.map((set) => ({
            id: set.id,
            weight: set.weightValue,
            reps: set.repsValue,
            setType: normalizeSessionSetType(set.setType),
          })),
        })),
      };
    }

    return DEFAULT_COMPLETED_SESSION_DETAILS[sessionId] ?? null;
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
}: CompletedSessionDetailScreenShellProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<CompletedSessionDetailRecord | null>(null);
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

    dataClient
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

    return () => {
      cancelled = true;
    };
  }, [dataClient, sessionId]);

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

  const handleEdit = () => {
    if (!session) {
      return;
    }

    router.push(`/session-recorder?mode=completed-edit&sessionId=${session.id}`);
  };

  const handleAppendExercise = (sessionExerciseId: string) => {
    if (!session) {
      return;
    }

    setActionFeedback(null);
    void dataClient
      .appendCompletedSessionExerciseAsPlanned(session.id, sessionExerciseId)
      .then(() => {
        router.push('/session-recorder');
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
        <Stack.Screen options={{ title: 'View Session' }} />
        <View style={styles.centerState} testID="completed-session-detail-loading">
          <Text style={styles.stateTitle}>Loading session...</Text>
        </View>
      </>
    );
  }

  if (errorMessage) {
    return (
      <>
        <Stack.Screen options={{ title: 'View Session' }} />
        <View style={styles.centerState} testID="completed-session-detail-error">
          <Text style={styles.stateTitle}>Unable to load session</Text>
          <Text style={styles.stateBody}>{errorMessage}</Text>
        </View>
      </>
    );
  }

  if (!sessionId || !session) {
    return (
      <>
        <Stack.Screen options={{ title: 'View Session' }} />
        <View style={styles.centerState} testID="completed-session-detail-empty">
          <Text style={styles.stateTitle}>Session not found</Text>
          <Text style={styles.stateBody}>This completed session could not be loaded.</Text>
        </View>
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
          exercises={session.exercises}
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
  const params = useLocalSearchParams<{ sessionId?: string | string[]; intent?: string | string[] }>();
  const sessionId = coerceRouteParam(params.sessionId);
  const intent = coerceRouteParam(params.intent);
  const initialMode = 'view';

  useEffect(() => {
    if (intent !== 'edit' || !sessionId) {
      return;
    }

    router.replace(`/session-recorder?mode=completed-edit&sessionId=${sessionId}`);
  }, [intent, router, sessionId]);

  if (intent === 'edit' && sessionId) {
    return (
      <View style={styles.centerState} testID="completed-session-detail-edit-redirect">
        <Text style={styles.stateTitle}>Opening editor...</Text>
      </View>
    );
  }

  return <CompletedSessionDetailScreenShell sessionId={sessionId} initialMode={initialMode} />;
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    backgroundColor: uiColors.surfacePage,
  },
  stickyActionBarWrap: {
    backgroundColor: uiColors.surfacePage,
    paddingBottom: 2,
  },
  centerState: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: uiColors.surfacePage,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: 13,
    color: uiColors.textSecondary,
    textAlign: 'center',
  },
  headerCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 12,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCell: {
    width: '48%',
    gap: 2,
  },
  metricLabel: {
    color: uiColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    color: uiColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  actionBarCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 10,
    gap: 6,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBarButton: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
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
    fontSize: 12,
  },
  actionBarSecondaryButton: {
    backgroundColor: uiColors.actionNeutralSubtleBg,
    borderColor: uiColors.actionNeutralSubtleBorder,
  },
  actionBarSecondaryButtonText: {
    color: uiColors.actionNeutralSubtleText,
    fontWeight: '700',
    fontSize: 12,
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
    fontSize: 12,
  },
  actionBarDangerButton: {
    backgroundColor: uiColors.actionDangerSubtleBg,
    borderColor: uiColors.actionDangerSubtleBorder,
  },
  actionBarDangerButtonText: {
    color: uiColors.actionDangerText,
    fontWeight: '700',
    fontSize: 12,
  },
  exerciseAppendButton: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 34,
    maxWidth: 96,
  },
  actionFeedbackText: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: 12,
    fontWeight: '600',
  },
  editModeBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.surfaceInfo,
    padding: 10,
    gap: 4,
  },
  editModeBannerTitle: {
    color: uiColors.textAccentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  editModeBannerBody: {
    color: uiColors.textAccentMuted,
    fontSize: 12,
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    borderRadius: 8,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  readOnlyFieldText: {
    color: uiColors.actionNeutralSubtleText,
    fontWeight: '600',
  },
  editFieldInput: {
    borderWidth: 1,
    borderColor: uiColors.borderInputStrong,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: uiColors.textPrimary,
    fontWeight: '600',
  },
  setRowEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: 8,
    padding: 8,
    backgroundColor: uiColors.surfaceInfo,
  },
  setIndexText: {
    color: uiColors.textPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  editSetInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: uiColors.borderInputStrong,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 8,
    paddingVertical: 7,
    color: uiColors.textPrimary,
    fontWeight: '600',
  },
  setTableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  setTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderTopWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 8,
    backgroundColor: uiColors.surfaceDefault,
  },
  setTableCell: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: 12,
    fontWeight: '600',
  },
  setTableHeaderCell: {
    color: uiColors.textSecondary,
    fontSize: 11,
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
    gap: 8,
  },
  exerciseTagChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  exerciseTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    maxWidth: '100%',
  },
  exerciseTagChipDeleted: {
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
  },
  exerciseTagChipText: {
    fontSize: 12,
    color: uiColors.textAccentStrong,
    fontWeight: '600',
    maxWidth: 180,
  },
});
