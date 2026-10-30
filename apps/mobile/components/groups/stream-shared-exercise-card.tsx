import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  useOpenExerciseEditor,
  type ExerciseEditorSaveInput,
} from '@/components/exercise-catalog/exercise-editor-request';
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
import { reportedExerciseMuscles, reportedMuscleName } from '@/src/exercise-catalog/reported-muscles';
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
  isAuthor: boolean;
  isTargetLinked: boolean;
  matchingExercise?: ExerciseCatalogExercise;
  groupExerciseId?: string | null;
  exerciseName: string;
  canLinkExisting: boolean;
  pending: boolean;
  onLinkExisting: () => void;
  onDirectAdd: () => void;
  onOpenCustomizer: () => void;
};

function StreamSharedExerciseCardActions({
  testID,
  isAuthor,
  isTargetLinked,
  matchingExercise,
  groupExerciseId,
  exerciseName,
  canLinkExisting,
  pending,
  onLinkExisting,
  onDirectAdd,
  onOpenCustomizer,
}: ActionsProps) {
  if (isAuthor || isTargetLinked) {
    return null;
  }

  if (canLinkExisting && matchingExercise) {
    return (
      <>
        <ActionButton
          accessibilityLabel={`Link ${matchingExercise.name} to leaderboard`}
          disabled={pending}
          label="Link to leaderboard"
          onPress={onLinkExisting}
          size="compact"
          testID={`${testID}-link-existing-btn`}
          variant="primary"
        />
        <ActionButton
          accessibilityLabel="Add as new exercise"
          disabled={pending}
          label="Add as new"
          onPress={onDirectAdd}
          size="compact"
          testID={`${testID}-add-new-btn`}
          variant="outline"
        />
      </>
    );
  }

  if (matchingExercise) {
    if (groupExerciseId && !canLinkExisting) {
      return (
        <ActionButton
          accessibilityLabel="Add as new exercise"
          disabled={pending}
          label="Add as new"
          onPress={onDirectAdd}
          size="compact"
          testID={`${testID}-add-new-btn`}
          variant="outline"
        />
      );
    }
    return null;
  }

  return (
    <>
      <ActionButton
        accessibilityLabel={`Add ${exerciseName} to my exercises`}
        disabled={pending}
        label="Add to my exercises"
        onPress={onDirectAdd}
        size="compact"
        testID={`${testID}-add-btn`}
        variant="primary"
      />
      <ActionButton
        accessibilityLabel="Customize exercise before adding"
        disabled={pending}
        label="Customize…"
        onPress={onOpenCustomizer}
        size="compact"
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
  const openExerciseEditor = useOpenExerciseEditor();

  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAuthor = item.shared_by.user_id === userId;
  const who = isAuthor ? 'You' : formatMemberName(item.shared_by.username);
  const date = formatBoardDate(item.sort_at_ms, dateFormat);

  const matchingExercise = useMemo(() => {
    return catalog.exercises.find(
      (e) => !e.deletedAt && e.name.trim().toLowerCase() === item.exercise.name.trim().toLowerCase(),
    );
  }, [catalog.exercises, item.exercise.name]);

  const isTargetLinked = useMemo(() => {
    if (!matchingExercise || !item.exercise.group_exercise_id || !links.links) return false;
    return links.links.some(
      (l) =>
        l.exerciseDefinitionId === matchingExercise.id &&
        l.groupExerciseId === item.exercise.group_exercise_id,
    );
  }, [matchingExercise, item.exercise.group_exercise_id, links.links]);

  const canLinkExisting = useMemo(() => {
    if (!matchingExercise || !item.exercise.group_exercise_id || links.links === null) return false;
    return !links.links.some((l) => l.exerciseDefinitionId === matchingExercise.id);
  }, [matchingExercise, item.exercise.group_exercise_id, links.links]);

  const testID = `group-stream-shared-exercise-${item.id}`;

  const statusTag = useMemo(() => {
    if (isAuthor) return null;
    if (isTargetLinked) {
      return <Tag label="In your exercises (Linked)" testID={`${testID}-status-linked`} tone="neutral" />;
    }
    if (matchingExercise && (!item.exercise.group_exercise_id || !canLinkExisting)) {
      return <Tag label="Already in your exercises" testID={`${testID}-status-exists`} tone="neutral" />;
    }
    return null;
  }, [canLinkExisting, isAuthor, isTargetLinked, item.exercise.group_exercise_id, matchingExercise, testID]);

  const hasActions = useMemo(() => {
    if (isAuthor || isTargetLinked) return false;
    if (canLinkExisting && matchingExercise) return true;
    if (matchingExercise) return Boolean(item.exercise.group_exercise_id && !canLinkExisting);
    return true;
  }, [canLinkExisting, isAuthor, isTargetLinked, item.exercise.group_exercise_id, matchingExercise]);

  const muscleNames = useMemo(() => {
    const exerciseForReport = {
      mappings: item.exercise.mappings.map((m, index) => ({
        id: `m-${index}`,
        muscleGroupId: m.muscle_group_id,
        weight: m.weight,
        role: m.role ?? null,
      })),
    };
    return reportedExerciseMuscles(exerciseForReport, catalog.muscleSetup.assignment)
      .map(({ muscleGroupId }) => reportedMuscleName(catalog.muscleSetup, catalog.muscleGroupsById, muscleGroupId))
      .filter((name): name is string => Boolean(name));
  }, [catalog.muscleGroupsById, catalog.muscleSetup, item.exercise.mappings]);

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
    setFeedback(`Added "${exercise.name}" to your exercises.`);
    onAdded?.(exercise.name);
  };

  const handleOpenCustomizer = () => {
    openExerciseEditor({
      title: 'Customize shared exercise',
      prefill: {
        name: item.exercise.name,
        loadInputMode: item.exercise.load_input_mode,
        bodyweightContribution: item.exercise.bodyweight_contribution,
        mappings: item.exercise.mappings.map((m) => ({
          muscleGroupId: m.muscle_group_id,
          weight: m.weight,
          role: m.role ?? 'primary',
        })),
      },
      onSave: handleCustomSave,
      onSaved: handleCustomSaved,
    });
  };

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
        {statusTag}
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
      ) : hasActions ? (
        <View style={styles.actionsRow}>
          <StreamSharedExerciseCardActions
            canLinkExisting={canLinkExisting}
            exerciseName={item.exercise.name}
            groupExerciseId={item.exercise.group_exercise_id}
            isAuthor={isAuthor}
            isTargetLinked={isTargetLinked}
            matchingExercise={matchingExercise}
            onDirectAdd={() => void handleDirectAdd()}
            onLinkExisting={() => void handleLinkExisting()}
            onOpenCustomizer={handleOpenCustomizer}
            pending={pending}
            testID={testID}
          />
        </View>
      ) : null}
      <Text allowFontScaling={false} style={styles.muted}>
        {date}
      </Text>
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
