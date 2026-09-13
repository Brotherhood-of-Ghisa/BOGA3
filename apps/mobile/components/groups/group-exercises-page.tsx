import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { UiButton, UiSurface, uiSpace } from '@/components/ui';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import {
  GROUP_EXERCISE_ACTION_LABELS,
  archiveGroupExercise,
  buildGroupExerciseRows,
  canManageGroup,
  describeGroupExerciseWriteError,
  groupExerciseActionSuccessMessage,
  groupExerciseActionsFor,
  groupExerciseArchiveConfirmation,
  unarchiveGroupExercise,
  useGroupAction,
  useMyGroupExerciseLinks,
  type GroupApiError,
  type GroupExercise,
  type GroupExerciseAction,
  type GroupExerciseListResult,
  type GroupResourceState,
  type GroupRole,
} from '@/src/groups';

import { GroupActionSheet } from './group-action-sheet';
import { GroupExerciseRow } from './group-exercise-row';
import { GroupMissingDataState, GroupStateView } from './group-state-view';
import { GroupWriteNotice } from './write-notice';

type Feedback = { tone: 'error' | 'success'; message: string };

type GroupExercisesPageProps = {
  groupId: string;
  myRole: GroupRole;
  /** `group_exercise_list` through `useGroupResource` (`group-exercises:<groupId>`), owned by the group screen. */
  exercises: GroupResourceState<GroupExerciseListResult>;
  offline: boolean;
  error: GroupApiError | null;
  onRetry: () => void;
  /** Re-reads `group_get` after a refusal, so a demoted admin loses the actions. */
  refreshGroup: () => Promise<void>;
};

const runArchiveWrite = (groupId: string, action: 'archive' | 'unarchive', groupExerciseId: string) =>
  action === 'archive' ? archiveGroupExercise(groupId, groupExerciseId) : unarchiveGroupExercise(groupId, groupExerciseId);

/**
 * The group page's Exercises segment (product E0.4; contract §4.4): the
 * group's exercises with my local link status, and for the owner and admins
 * Add exercise plus a per-row sheet (Rename, Archive / Unarchive). Writes are
 * online-only (08 pattern 9); Archive confirms first.
 */
export function GroupExercisesPage({ groupId, myRole, exercises, offline, error, onRetry, refreshGroup }: GroupExercisesPageProps) {
  const router = useRouter();
  const links = useMyGroupExerciseLinks(groupId);
  const [sheetExercise, setSheetExercise] = useState<GroupExercise | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const archiveWrite = useGroupAction(runArchiveWrite);
  const canManage = canManageGroup(myRole);

  const performArchiveWrite = async (action: 'archive' | 'unarchive', exercise: GroupExercise) => {
    setFeedback(null);
    const result = await archiveWrite.run(groupId, action, exercise.group_exercise_id);
    if (result.ok) {
      setFeedback({ tone: 'success', message: groupExerciseActionSuccessMessage(action, exercise.name) });
      void exercises.refresh();
      return;
    }
    setFeedback({ tone: 'error', message: describeGroupExerciseWriteError(result.error) });
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND' || result.error.code === 'VALIDATION') {
      void exercises.refresh();
      void refreshGroup();
    }
  };

  const onSelectAction = (action: GroupExerciseAction) => {
    const exercise = sheetExercise;
    setSheetExercise(null);
    if (!exercise) return;
    if (action === 'rename') {
      router.push(`/group/${groupId}/exercises/${exercise.group_exercise_id}/edit`);
      return;
    }
    if (action === 'archive') {
      const confirmation = groupExerciseArchiveConfirmation(exercise.name);
      Alert.alert(confirmation.title, confirmation.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: confirmation.confirmLabel, style: 'destructive', onPress: () => void performArchiveWrite('archive', exercise) },
      ]);
      return;
    }
    void performArchiveWrite('unarchive', exercise);
  };

  if (!exercises.data) {
    return <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-screen-exercises" />;
  }

  const byId = new Map(exercises.data.exercises.map((exercise) => [exercise.group_exercise_id, exercise]));
  const rows = buildGroupExerciseRows(exercises.data.exercises, links.links);
  const addButton = canManage ? (
    <UiButton
      label="Add exercise"
      onPress={() => router.push(`/group/${groupId}/exercises/new`)}
      testID="group-exercises-add-button"
    />
  ) : null;
  const sheetActions = sheetExercise ? groupExerciseActionsFor(myRole, sheetExercise) : [];

  return (
    <View style={{ gap: uiSpace.lg }} testID="group-screen-exercises">
      {feedback ? <GroupWriteNotice message={feedback.message} testID="group-exercises-action-feedback" tone={feedback.tone} /> : null}
      {links.failed ? (
        <GroupWriteNotice
          message="Couldn't read your links on this device, so link status isn't shown."
          testID="group-exercises-links-error"
          tone="error"
        />
      ) : null}
      {rows.length === 0 ? (
        <GroupStateView
          body={canManage ? 'Add an exercise so members can link theirs and compare.' : 'Admins add exercises here.'}
          testID="group-exercises-empty"
          title="No group exercises yet">
          {addButton}
        </GroupStateView>
      ) : (
        <>
          {addButton}
          <UiSurface style={{ paddingHorizontal: uiSpace.lg }} testID="group-exercises-list">
            {rows.map((row) => (
              <GroupExerciseRow
                key={row.groupExerciseId}
                onPress={
                  canManage && !archiveWrite.pending
                    ? () => setSheetExercise(byId.get(row.groupExerciseId) ?? null)
                    : undefined
                }
                row={row}
              />
            ))}
          </UiSurface>
        </>
      )}
      <GroupActionSheet
        actionTestIDPrefix="group-exercise-action"
        actions={sheetActions.map((action) => ({
          key: action,
          label: GROUP_EXERCISE_ACTION_LABELS[action],
          destructive: action === 'archive',
        }))}
        dismissLabel="Dismiss exercise actions"
        onClose={() => setSheetExercise(null)}
        onSelect={onSelectAction}
        subtitle={
          sheetExercise
            ? sheetExercise.archived_at_ms !== null
              ? 'Archived'
              : LOAD_INPUT_MODE_LABELS[sheetExercise.load_input_mode]
            : undefined
        }
        testIDPrefix="group-exercise-actions"
        title={sheetExercise?.name ?? ''}
        visible={sheetExercise !== null}
      />
    </View>
  );
}
