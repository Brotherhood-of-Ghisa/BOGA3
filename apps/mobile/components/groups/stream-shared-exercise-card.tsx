import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ExerciseEditorModal,
  type ExerciseEditorSaveInput,
} from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ActionButton,
  Card,
  Notice,
  Tag,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { GroupWriteNotice } from './write-notice';
import {
  saveExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import { formatBoardDate } from '@/src/groups/board-view-model';
import type { CompetitionStreamSharedExerciseWire } from '@/src/groups/competition-wire';
import { formatMemberName } from '@/src/groups/stream-view-model';
import { useMyGroupExerciseLinks } from '@/src/groups/use-my-group-exercise-links';
import { useDateFormat } from '@/src/preferences/hooks';

type Props = {
  item: CompetitionStreamSharedExerciseWire;
  userId: string | null;
  showGroupName: boolean;
  onAdded?: (exerciseName: string) => void;
};

type ActionsProps = {
  testID: string;
  isLinked: boolean;
  matchingExercise?: ExerciseCatalogExercise;
  groupExerciseId?: string | null;
  exerciseName: string;
  pending: boolean;
  onLinkExisting: () => void;
  onDirectAdd: () => void;
  onOpenCustomizer: () => void;
};

function StreamSharedExerciseCardActions({
  testID,
  isLinked,
  matchingExercise,
  groupExerciseId,
  exerciseName,
  pending,
  onLinkExisting,
  onDirectAdd,
  onOpenCustomizer,
}: ActionsProps) {
  if (isLinked) {
    return <Tag label="In your exercises (Linked)" testID={`${testID}-status-linked`} tone="neutral" />;
  }

  if (matchingExercise && groupExerciseId) {
    return (
      <>
        <ActionButton
          accessibilityLabel={`Link ${matchingExercise.name} to leaderboard`}
          disabled={pending}
          label="Link to leaderboard"
          onPress={onLinkExisting}
          testID={`${testID}-link-existing-btn`}
          variant="primary"
        />
        <ActionButton
          accessibilityLabel="Add as new exercise"
          disabled={pending}
          label="Add as new"
          onPress={onDirectAdd}
          testID={`${testID}-add-new-btn`}
          variant="outline"
        />
      </>
    );
  }

  if (matchingExercise) {
    return (
      <>
        <Tag label="Already in your exercises" testID={`${testID}-status-exists`} tone="neutral" />
        <ActionButton
          accessibilityLabel="Add another copy"
          disabled={pending}
          label="Add another"
          onPress={onDirectAdd}
          testID={`${testID}-add-another-btn`}
          variant="outline"
        />
      </>
    );
  }

  return (
    <>
      <ActionButton
        accessibilityLabel={`Add ${exerciseName} to my exercises`}
        disabled={pending}
        label="Add to my exercises"
        onPress={onDirectAdd}
        testID={`${testID}-add-btn`}
        variant="primary"
      />
      <ActionButton
        accessibilityLabel="Customize exercise before adding"
        disabled={pending}
        label="Customize…"
        onPress={onOpenCustomizer}
        testID={`${testID}-customize-btn`}
        variant="outline"
      />
    </>
  );
}

export function StreamSharedExerciseCard({ item, userId, showGroupName, onAdded }: Props) {
  const dateFormat = useDateFormat();
  const catalog = useExerciseCatalog();
  const links = useMyGroupExerciseLinks(item.group_id);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const who = item.shared_by.user_id === userId ? 'You' : formatMemberName(item.shared_by.username);
  const date = formatBoardDate(item.sort_at_ms, dateFormat);

  const matchingExercise = useMemo(() => {
    return catalog.exercises.find(
      (e) => !e.deletedAt && e.name.trim().toLowerCase() === item.exercise.name.trim().toLowerCase(),
    );
  }, [catalog.exercises, item.exercise.name]);

  const isLinked = useMemo(() => {
    if (!matchingExercise || !item.exercise.group_exercise_id || !links.links) return false;
    return links.links.some(
      (l) =>
        l.exerciseDefinitionId === matchingExercise.id &&
        l.groupExerciseId === item.exercise.group_exercise_id,
    );
  }, [matchingExercise, item.exercise.group_exercise_id, links.links]);

  const muscleNames = useMemo(() => {
    return item.exercise.mappings.map((m) => {
      const group = catalog.muscleGroupsById[m.muscle_group_id];
      return group?.displayName ?? m.muscle_group_id;
    });
  }, [catalog.muscleGroupsById, item.exercise.mappings]);

  const handleDirectAdd = async () => {
    setError(null);
    setPending(true);
    try {
      const mappings = item.exercise.mappings.map((m) => ({
        muscleGroupId: m.muscle_group_id,
        weight: m.weight,
        role: m.role ?? 'primary',
      }));

      if (item.exercise.group_exercise_id) {
        await createExerciseWithGroupLink(
          {
            name: item.exercise.name,
            loadInputMode: item.exercise.load_input_mode,
            bodyweightContribution: item.exercise.bodyweight_contribution,
            mappings,
          },
          {
            groupId: item.group_id,
            groupExerciseId: item.exercise.group_exercise_id,
          },
        );
        void links.reload();
      } else {
        await saveExerciseCatalogExercise({
          name: item.exercise.name,
          loadInputMode: item.exercise.load_input_mode,
          bodyweightContribution: item.exercise.bodyweight_contribution,
          mappings,
        });
      }
      setFeedback(`Added "${item.exercise.name}" to your exercises.`);
      onAdded?.(item.exercise.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add exercise.');
    } finally {
      setPending(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!matchingExercise || !item.exercise.group_exercise_id) return;
    setError(null);
    setPending(true);
    try {
      await linkExercise(matchingExercise.id, item.group_id, item.exercise.group_exercise_id);
      void links.reload();
      setFeedback(`Linked "${matchingExercise.name}" to ${item.exercise.group_exercise_name ?? 'leaderboard'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link exercise.');
    } finally {
      setPending(false);
    }
  };

  const handleCustomSave = async (saveInput: ExerciseEditorSaveInput): Promise<ExerciseCatalogExercise> => {
    if (item.exercise.group_exercise_id) {
      const { exercise } = await createExerciseWithGroupLink(saveInput, {
        groupId: item.group_id,
        groupExerciseId: item.exercise.group_exercise_id,
      });
      void links.reload();
      return exercise;
    }
    return saveExerciseCatalogExercise(saveInput);
  };

  const handleCustomSaved = (exercise: ExerciseCatalogExercise) => {
    setIsEditorOpen(false);
    setFeedback(`Added "${exercise.name}" to your exercises.`);
    onAdded?.(exercise.name);
  };

  const testID = `group-stream-shared-exercise-${item.id}`;

  return (
    <Card accessibilityLabel={`${who} shared ${item.exercise.name}`} style={styles.card} testID={testID}>
      {showGroupName ? <Text allowFontScaling={false} style={styles.muted}>{item.group_id}</Text> : null}
      <Text allowFontScaling={false} style={styles.label}>
        {who} shared an exercise
      </Text>
      <Text allowFontScaling={false} style={styles.exerciseName}>
        {item.exercise.name}
      </Text>
      <View style={styles.metaRow}>
        <Tag label={LOAD_INPUT_MODE_LABELS[item.exercise.load_input_mode]} tone="neutral" />
        {item.exercise.group_exercise_name ? (
          <Tag label={`Leaderboard: ${item.exercise.group_exercise_name}`} tone="neutral" />
        ) : null}
      </View>
      {muscleNames.length > 0 ? (
        <View style={styles.musclePillsRow}>
          {muscleNames.map((name, idx) => (
            <Tag key={idx} label={name} tone="neutral" />
          ))}
        </View>
      ) : null}
      {error ? <Notice live message={error} testID={`${testID}-error`} tone="danger" /> : null}
      {feedback ? (
        <GroupWriteNotice message={feedback} testID={`${testID}-feedback`} tone="success" />
      ) : (
        <View style={styles.actionsRow}>
          <StreamSharedExerciseCardActions
            exerciseName={item.exercise.name}
            groupExerciseId={item.exercise.group_exercise_id}
            isLinked={isLinked}
            matchingExercise={matchingExercise}
            onDirectAdd={() => void handleDirectAdd()}
            onLinkExisting={() => void handleLinkExisting()}
            onOpenCustomizer={() => setIsEditorOpen(true)}
            pending={pending}
            testID={testID}
          />
        </View>
      )}
      <Text allowFontScaling={false} style={styles.muted}>
        {date}
      </Text>
      <ExerciseEditorModal
        editingExercise={null}
        onRequestClose={() => setIsEditorOpen(false)}
        onSave={handleCustomSave}
        onSaved={handleCustomSaved}
        prefill={{
          name: item.exercise.name,
          loadInputMode: item.exercise.load_input_mode,
          bodyweightContribution: item.exercise.bodyweight_contribution,
          mappings: item.exercise.mappings.map((m) => ({
            muscleGroupId: m.muscle_group_id,
            weight: m.weight,
            role: m.role ?? 'primary',
          })),
        }}
        visible={isEditorOpen}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: uiSpace.md, gap: uiSpace.xs },
  label: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.sm, color: uiRoles.record },
  exerciseName: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.lg, color: uiRoles.ink },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.xs, marginTop: uiSpace.xs },
  musclePillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.xs, marginTop: uiSpace.xs },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: uiSpace.sm, marginTop: uiSpace.xs },
  muted: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, color: uiRoles.inkMuted },
});
