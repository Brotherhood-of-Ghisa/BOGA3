import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import {
  ExerciseEditorModal,
  type ExerciseEditorSaveInput,
} from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ActionButton,
  Card,
  Notice,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import {
  GROUP_EXERCISE_ACTION_LABELS,
  buildGroupExerciseRows,
  canManageGroup,
  describeGroupExerciseWriteError,
  groupExerciseActionSuccessMessage,
  groupExerciseActionsFor,
  groupExerciseArchiveConfirmation,
  groupExerciseLinkedMessage,
  useGroupAction,
  useMyGroupExerciseLinks,
  type GroupApiError,
  type GroupExercise,
  type GroupExerciseAction,
  type GroupResourceState,
  type GroupRole,
  type LinkableExercise,
} from '@/src/groups';
import { buildAddAsNewPrefill, requireAddAsNewCompatibility } from '@/src/groups/add-as-new';
import { archiveCompetitionExercise } from '@/src/groups/api';
import { competitionLinkExercise,describeCompetitionRules } from '@/src/groups/competition-view-model';
import type { CompetitionExerciseListWire } from '@/src/groups/competition-wire';
import type { PersonalExerciseLinkChoice } from '@/src/groups/exercise-view-model';
import { useExerciseUnlink, type ExerciseUnlinkTarget } from '@/src/groups/use-exercise-unlink';

import { GroupActionSheet } from './group-action-sheet';
import { GroupExercisePickSheet, type GroupExercisePickTarget } from './group-exercise-pick-sheet';
import { GroupExerciseRow } from './group-exercise-row';
import { GroupExerciseUnlinkSheet } from './group-exercise-unlink-sheet';
import { GroupMissingDataState, GroupStateView } from './group-state-view';
import { GroupWriteNotice } from './write-notice';

type Feedback = { tone: 'error' | 'success'; message: string };

type GroupExercisesPageProps = {
  groupId: string;
  groupName: string;
  myRole: GroupRole;
  /** The group exercise list through its versioned cache resource, owned by the group screen. */
  exercises: GroupResourceState<CompetitionExerciseListWire>;
  offline: boolean;
  error: GroupApiError | null;
  onRetry: () => void;
  /** Re-reads `group_get` after a refusal, so a demoted admin loses the actions. */
  refreshGroup: () => Promise<void>;
};

const runArchiveWrite = (groupId: string, action: 'archive' | 'unarchive', groupExerciseId: string) =>
  archiveCompetitionExercise(groupId,groupExerciseId,action === 'archive');

/**
 * The group management page's Exercises list (product E0.4; contract): the
 * group's exercises with my local link status and, on an active row none of
 * mine is linked to, "Link your exercise" for every member — the pick
 * sheet in link-only mode (a local write, so it works offline; nothing is
 * added to a session). The owner and admins also get Add exercise and a
 * per-row sheet (Rename, Archive / Unarchive): online-only writes (08
 * pattern 9); Archive confirms first. `Add exercise` is an outline beside the
 * section's micro-label: `Invite` is the group screen's one `accent` (T13-D1).
 */
export function GroupExercisesPage({
  groupId,
  groupName,
  myRole,
  exercises,
  offline,
  error,
  onRetry,
  refreshGroup,
}: GroupExercisesPageProps) {
  const router = useRouter();
  const links = useMyGroupExerciseLinks(groupId);
  const [sheetExercise, setSheetExercise] = useState<GroupExercise | null>(null);
  const [pickTarget, setPickTarget] = useState<GroupExercisePickTarget | null>(null);
  const [addAsNewTarget, setAddAsNewTarget] = useState<GroupExercise | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const unlink = useExerciseUnlink({ offline, reloadLinks: links.reload, onNotice: setFeedback });
  const [unlinkExercise, setUnlinkExercise] = useState<GroupExercise | null>(null);
  const [chooserVisible, setChooserVisible] = useState(false);
  const selectedUnlink = useRef<ExerciseUnlinkTarget | null>(null);
  const focusGroupExerciseId = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, ViewInstance>());
  const restoreRowFocus = () => {
    const row = rowRefs.current.get(focusGroupExerciseId.current ?? '');
    const handle = row ? findNodeHandle(row) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const unlinkTarget = (exercise: GroupExercise, choice: PersonalExerciseLinkChoice): ExerciseUnlinkTarget => ({
    personalExerciseId: choice.exerciseDefinitionId, personalExerciseName: choice.label,
    groupId, groupName, groupExerciseId: exercise.group_exercise_id, groupExerciseName: exercise.name,
    archived: exercise.archived_at_ms !== null, inactive: false,
  });
  const openUnlink = (exercise: GroupExercise, choices: PersonalExerciseLinkChoice[]) => {
    if (unlink.pending || links.links === null) return;
    focusGroupExerciseId.current = exercise.group_exercise_id;
    if (choices.length === 1) {
      unlink.confirmUnlink(unlinkTarget(exercise, choices[0]), restoreRowFocus);
    } else if (choices.length > 1) {
      selectedUnlink.current = null;
      setUnlinkExercise(exercise);
      setChooserVisible(true);
    }
  };
  const finishChooser = () => {
    const target = selectedUnlink.current;
    selectedUnlink.current = null;
    setUnlinkExercise(null);
    if (target) unlink.confirmUnlink(target, restoreRowFocus);
    else restoreRowFocus();
  };
  const archiveWrite = useGroupAction(runArchiveWrite);
  const canManage = canManageGroup(myRole);
  const addAsNewPrefill = useMemo(() => (addAsNewTarget ? buildAddAsNewPrefill(addAsNewTarget) : null), [addAsNewTarget]);

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

  const openLink = (exercise: GroupExercise) => {
    setFeedback(null);
    setPickTarget({ groupId, groupName, groupExercise: exercise, mode: 'link', linkedExercises: [] });
  };

  // A local write, so it works offline; a failure rejects into the sheet's inline error.
  const linkFromSheet = async (exercise: LinkableExercise) => {
    const target = pickTarget;
    if (!target) return;
    await linkExercise(exercise.id, groupId, target.groupExercise.group_exercise_id);
    setPickTarget(null);
    await links.reload();
    setFeedback({ tone: 'success', message: groupExerciseLinkedMessage(exercise.name, target.groupExercise.name) });
  };

  const openAddAsNew = () => {
    setAddAsNewTarget(pickTarget?.groupExercise ?? null);
    setPickTarget(null);
  };

  // "Add as new": my exercise and its link commit in one local transaction.
  const saveAddAsNew = async (input: ExerciseEditorSaveInput): Promise<ExerciseCatalogExercise> => {
    const target = addAsNewTarget;
    if (!target) {
      throw new Error('No group exercise selected.');
    }
    requireAddAsNewCompatibility(input, target);
    const { exercise } = await createExerciseWithGroupLink(input, { groupId, groupExerciseId: target.group_exercise_id });
    return exercise;
  };

  const onAddAsNewSaved = (exercise: ExerciseCatalogExercise) => {
    const target = addAsNewTarget;
    setAddAsNewTarget(null);
    void links.reload();
    if (target) {
      setFeedback({ tone: 'success', message: groupExerciseLinkedMessage(exercise.name, target.name) });
    }
  };

  const header = (
    <View style={styles.header}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel} testID="group-screen-exercises-title">
        Exercises
      </Text>
      {canManage ? (
        <ActionButton
          accessibilityLabel="Add exercise"
          label="Add exercise"
          onPress={() => router.push(`/group/${groupId}/exercises/new`)}
          testID="group-exercises-add-button"
          variant="outline"
        />
      ) : null}
    </View>
  );

  if (!exercises.data) {
    return (
      <View style={styles.page}>
        {header}
        <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-screen-exercises" />
      </View>
    );
  }

  const wireById = new Map(exercises.data.exercises.map(exercise => [exercise.group_exercise_id,exercise]));
  const sheetStandard = sheetExercise ? wireById.get(sheetExercise.group_exercise_id) : null;
  const presented = exercises.data.exercises.map(competitionLinkExercise);
  const byId = new Map(presented.map((exercise) => [exercise.group_exercise_id, exercise]));
  const rows = buildGroupExerciseRows(presented, links.links);
  const sheetActions = sheetExercise ? groupExerciseActionsFor(myRole, sheetExercise) : [];

  return (
    <View style={styles.page} testID="group-screen-exercises">
      {header}
      {feedback ? <GroupWriteNotice message={feedback.message} testID="group-exercises-action-feedback" tone={feedback.tone} /> : null}
      {links.failed ? (
        <Notice
          action={
            <ActionButton
              accessibilityLabel="Retry reading links"
              label="Retry"
              onPress={() => void links.reload()}
              testID="group-exercises-links-retry"
              variant="outline"
            />
          }
          live
          message="Couldn't read your links on this device, so link status isn't shown."
          testID="group-exercises-links-error"
          tone="danger"
        />
      ) : null}
      {rows.length === 0 ? (
        <GroupStateView
          body={canManage ? 'Add an exercise so members can link theirs and compare.' : 'Admins add exercises here.'}
          testID="group-exercises-empty"
          title="No group exercises yet"
        />
      ) : (
        <Card testID="group-exercises-list">
          {rows.map((row, index) => {
            const exercise = byId.get(row.groupExerciseId) ?? null;
            return (
              <GroupExerciseRow
                divider={index > 0}
                key={row.groupExerciseId}
                focusRef={(node) => { if (node) rowRefs.current.set(row.groupExerciseId, node); else rowRefs.current.delete(row.groupExerciseId); }}
                onUnlink={row.personalLinks.length > 0 && exercise ? () => openUnlink(exercise, row.personalLinks) : undefined}
                unlinkPending={unlink.pending}
                onLink={row.linkable && exercise && !unlink.pending ? () => openLink(exercise) : undefined}
                onPress={canManage && !archiveWrite.pending ? () => setSheetExercise(exercise) : undefined}
                row={row}
                standard={describeCompetitionRules(wireById.get(row.groupExerciseId)!)}
              />
            );
          })}
        </Card>
      )}
      <GroupExerciseUnlinkSheet
        choices={rows.find((row) => row.groupExerciseId === unlinkExercise?.group_exercise_id)?.personalLinks ?? []}
        groupExerciseName={unlinkExercise?.name ?? ''}
        groupName={groupName}
        onClose={() => { selectedUnlink.current = null; setChooserVisible(false); }}
        onDismissed={finishChooser}
        onSelect={(choice) => {
          if (!unlinkExercise) return;
          selectedUnlink.current = unlinkTarget(unlinkExercise, choice);
          setChooserVisible(false);
        }}
        visible={chooserVisible}
      />
      <GroupActionSheet
        actionTestIDPrefix="group-exercise-action"
        actions={sheetActions.map((action) => ({
          key: action,
          label: action === 'rename' ? 'Edit comparison' : GROUP_EXERCISE_ACTION_LABELS[action],
          destructive: action === 'archive',
        }))}
        dismissLabel="Dismiss exercise actions"
        onClose={() => setSheetExercise(null)}
        onSelect={onSelectAction}
        subtitle={
          sheetExercise
            ? sheetExercise.archived_at_ms !== null
              ? 'Archived'
              : sheetStandard ? describeCompetitionRules(sheetStandard) : LOAD_INPUT_MODE_LABELS[sheetExercise.load_input_mode]
            : undefined
        }
        testIDPrefix="group-exercise-actions"
        title={sheetExercise?.name ?? ''}
        visible={sheetExercise !== null}
      />
      <GroupExercisePickSheet
        exercises={links.exercises}
        links={links.allLinks}
        onAddAsNew={openAddAsNew}
        onLinkAndAdd={linkFromSheet}
        onRequestClose={() => setPickTarget(null)}
        purpose="link-only"
        target={pickTarget}
      />
      <ExerciseEditorModal
        editingExercise={null}
        onRequestClose={() => setAddAsNewTarget(null)}
        onSave={saveAddAsNew}
        onSaved={onAddAsNewSaved}
        prefill={addAsNewPrefill}
        title="Add as new exercise"
        visible={addAsNewTarget !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: uiSpace.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
  },
  microLabel: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
});
