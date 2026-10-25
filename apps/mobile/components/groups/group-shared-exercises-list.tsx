import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ExerciseEditorModal,
  type ExerciseEditorSaveInput,
} from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ActionButton,
  Card,
  IconButton,
  ListRow,
  SearchField,
  Sheet,
  Tag,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import {
  saveExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import {
  createExerciseWithGroupLink,
  linkExercise,
  listLinks,
} from '@/src/data/exercise-group-links';
import { useExerciseCatalog, type ExerciseCatalogCacheSnapshot } from '@/src/exercise-catalog/cache';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import {
  createGroupSharedExercise,
  deleteGroupSharedExercise,
  groupCacheKeys,
  listGroupSharedExercises,
  useGroupResource,
  type GroupRole,
} from '@/src/groups';
import { formatBoardDate } from '@/src/groups/board-view-model';
import type {
  GroupSharedExerciseItemWire,
  GroupSharedExercisesListWire,
} from '@/src/groups/competition-wire';
import type { MyGroupExerciseLink } from '@/src/groups/exercise-view-model';
import { formatMemberName } from '@/src/groups/stream-view-model';
import { useMyGroupExerciseLinks } from '@/src/groups/use-my-group-exercise-links';
import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';

import { GroupMissingDataState, GroupStateView } from './group-state-view';
import { GroupWriteNotice } from './write-notice';

type Props = {
  groupId: string;
  groupName: string;
  myRole: GroupRole;
  userId: string | null;
  offline: boolean;
};

type Feedback = { tone: 'error' | 'success'; message: string };

type GroupSharedExerciseCardProps = {
  item: GroupSharedExerciseItemWire;
  userId: string | null;
  dateFormat: ExerciseDateFormat;
  catalog: ExerciseCatalogCacheSnapshot;
  links: readonly MyGroupExerciseLink[] | null;
  canDelete: boolean;
  isPending: boolean;
  onDelete: (item: GroupSharedExerciseItemWire) => void;
  onLinkExisting: (item: GroupSharedExerciseItemWire, personalExerciseId: string) => void;
  onDirectAdd: (item: GroupSharedExerciseItemWire) => void;
  onCustomize: (item: GroupSharedExerciseItemWire) => void;
};

function GroupSharedExerciseCard({
  item,
  userId,
  dateFormat,
  catalog,
  links,
  canDelete,
  isPending,
  onDelete,
  onLinkExisting,
  onDirectAdd,
  onCustomize,
}: GroupSharedExerciseCardProps) {
  const who = item.shared_by.user_id === userId ? 'You' : formatMemberName(item.shared_by.username);
  const date = formatBoardDate(item.exercise.created_at_ms, dateFormat);
  const matching = catalog.exercises.find(
    (e) => !e.deletedAt && e.name.trim().toLowerCase() === item.exercise.name.trim().toLowerCase(),
  );
  const isItemLinked =
    matching &&
    item.exercise.group_exercise_id &&
    links?.some(
      (l) =>
        l.exerciseDefinitionId === matching.id &&
        l.groupExerciseId === item.exercise.group_exercise_id,
    );
  const itemTestID = `group-shared-exercise-${item.id}`;

  return (
    <Card key={item.id} style={styles.card} testID={itemTestID}>
      <View style={styles.cardHeader}>
        <Text allowFontScaling={false} style={styles.cardAuthor}>
          {who} · {date}
        </Text>
        {canDelete ? (
          <IconButton
            accessibilityLabel={`Delete ${item.exercise.name}`}
            disabled={isPending}
            name="trash"
            onPress={() => onDelete(item)}
            size="sm"
            testID={`${itemTestID}-delete-btn`}
            tone="danger"
          />
        ) : null}
      </View>
      <Text allowFontScaling={false} style={styles.exerciseName}>
        {item.exercise.name}
      </Text>
      <View style={styles.tagsRow}>
        <Tag label={LOAD_INPUT_MODE_LABELS[item.exercise.load_input_mode]} tone="neutral" />
        {item.exercise.group_exercise_name ? (
          <Tag label={`Leaderboard: ${item.exercise.group_exercise_name}`} tone="neutral" />
        ) : null}
      </View>
      <View style={styles.cardActions}>
        {isItemLinked ? (
          <Tag label="In your exercises (Linked)" testID={`${itemTestID}-status-linked`} tone="neutral" />
        ) : matching && item.exercise.group_exercise_id ? (
          <>
            <ActionButton
              accessibilityLabel={`Link ${matching.name} to leaderboard`}
              disabled={isPending}
              label="Link to leaderboard"
              onPress={() => void onLinkExisting(item, matching.id)}
              testID={`${itemTestID}-link-btn`}
              variant="primary"
            />
            <ActionButton
              accessibilityLabel="Add as new exercise"
              disabled={isPending}
              label="Add as new"
              onPress={() => void onDirectAdd(item)}
              testID={`${itemTestID}-add-new-btn`}
              variant="outline"
            />
          </>
        ) : matching ? (
          <>
            <Tag label="Already in your exercises" testID={`${itemTestID}-status-exists`} tone="neutral" />
            <ActionButton
              accessibilityLabel="Add another copy"
              disabled={isPending}
              label="Add another"
              onPress={() => void onDirectAdd(item)}
              testID={`${itemTestID}-add-another-btn`}
              variant="outline"
            />
          </>
        ) : (
          <>
            <ActionButton
              accessibilityLabel={`Add ${item.exercise.name} to my exercises`}
              disabled={isPending}
              label="Add to my exercises"
              onPress={() => void onDirectAdd(item)}
              testID={`${itemTestID}-add-btn`}
              variant="primary"
            />
            <ActionButton
              accessibilityLabel="Customize exercise before adding"
              disabled={isPending}
              label="Customize…"
              onPress={() => onCustomize(item)}
              testID={`${itemTestID}-customize-btn`}
              variant="outline"
            />
          </>
        )}
      </View>
    </Card>
  );
}

type ShareExercisePickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  search: string;
  onSearchChange: (text: string) => void;
  exercises: readonly ExerciseCatalogExercise[];
  onSelect: (exercise: ExerciseCatalogExercise) => void;
};

function ShareExercisePickerSheet({
  visible,
  onDismiss,
  search,
  onSearchChange,
  exercises,
  onSelect,
}: ShareExercisePickerSheetProps) {
  return (
    <Sheet
      dismissLabel="Close exercise picker"
      onDismiss={onDismiss}
      testID="group-share-exercise-sheet"
      title="Share exercise with group"
      visible={visible}>
      <View style={styles.sheetContent}>
        <SearchField
          accessibilityLabel="Filter personal exercises"
          onChangeText={onSearchChange}
          placeholder="Search exercises…"
          testID="group-share-exercise-search"
          value={search}
        />
        <ScrollView style={styles.sheetList}>
          {exercises.length === 0 ? (
            <Text allowFontScaling={false} style={styles.emptySearchText}>
              No exercises found.
            </Text>
          ) : (
            exercises.map((exercise) => (
              <ListRow
                accessibilityLabel={`Share ${exercise.name}`}
                key={exercise.id}
                label={exercise.name}
                onPress={() => void onSelect(exercise)}
                testID={`group-share-exercise-option-${exercise.id}`}
              />
            ))
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

async function shareCatalogExercise(exercise: ExerciseCatalogExercise, groupId: string): Promise<void> {
  const allLinks = await listLinks();
  const existingLink = allLinks.find(
    (l) => l.groupId === groupId && l.exerciseDefinitionId === exercise.id,
  );
  await createGroupSharedExercise({
    groupId,
    name: exercise.name,
    mode: exercise.loadInputMode ?? 'total_load',
    contribution: exercise.bodyweightContribution,
    mappings: exercise.mappings.map((m) => ({
      muscle_group_id: m.muscleGroupId,
      weight: m.weight,
      role: m.role,
    })),
    groupExerciseId: existingLink ? existingLink.groupExerciseId : null,
  });
}

async function importSharedExercise(
  item: GroupSharedExerciseItemWire,
  reloadLinks: () => Promise<unknown>,
): Promise<void> {
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
    void reloadLinks();
  } else {
    await saveExerciseCatalogExercise({
      name: item.exercise.name,
      loadInputMode: item.exercise.load_input_mode,
      bodyweightContribution: item.exercise.bodyweight_contribution,
      mappings,
    });
  }
}

export function GroupSharedExercisesList({ groupId, groupName, myRole, userId, offline }: Props) {
  const dateFormat = useDateFormat();
  const catalog = useExerciseCatalog();
  const links = useMyGroupExerciseLinks(groupId);

  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [customizingItem, setCustomizingItem] = useState<GroupSharedExerciseItemWire | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const fetcher = useCallback(() => listGroupSharedExercises(groupId), [groupId]);
  const resource = useGroupResource<GroupSharedExercisesListWire>({
    userId,
    cacheKey: groupCacheKeys.sharedExercises(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });

  const canDelete = (item: GroupSharedExerciseItemWire): boolean =>
    item.shared_by.user_id === userId || myRole === 'owner' || myRole === 'admin';

  const handleSharePersonalExercise = async (exercise: ExerciseCatalogExercise) => {
    setSharePickerOpen(false);
    setShareSearch('');
    setFeedback(null);
    try {
      await shareCatalogExercise(exercise, groupId);
      setFeedback({ tone: 'success', message: `Shared "${exercise.name}" with ${groupName}.` });
      void resource.refresh();
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Could not share exercise.' });
    }
  };

  const handleDirectAdd = async (item: GroupSharedExerciseItemWire) => {
    setFeedback(null);
    setPendingId(item.id);
    try {
      await importSharedExercise(item, links.reload);
      setFeedback({ tone: 'success', message: `Added "${item.exercise.name}" to your exercises.` });
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Could not add exercise.' });
    } finally {
      setPendingId(null);
    }
  };

  const handleLinkExisting = async (item: GroupSharedExerciseItemWire, personalExerciseId: string) => {
    if (!item.exercise.group_exercise_id) return;
    setFeedback(null);
    setPendingId(item.id);
    try {
      await linkExercise(personalExerciseId, groupId, item.exercise.group_exercise_id);
      void links.reload();
      setFeedback({ tone: 'success', message: `Linked to ${item.exercise.group_exercise_name ?? 'leaderboard'}.` });
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Could not link exercise.' });
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = (item: GroupSharedExerciseItemWire) => {
    Alert.alert(
      'Remove shared exercise',
      `Remove "${item.exercise.name}" from the group's shared exercises?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setFeedback(null);
            setPendingId(item.id);
            try {
              await deleteGroupSharedExercise(groupId, item.id);
              void resource.refresh();
              setFeedback({ tone: 'success', message: `Removed "${item.exercise.name}".` });
            } catch (err) {
              setFeedback({ tone: 'error', message: err instanceof Error ? err.message : 'Could not delete exercise.' });
            } finally {
              setPendingId(null);
            }
          },
        },
      ],
    );
  };

  const handleCustomSave = async (saveInput: ExerciseEditorSaveInput): Promise<ExerciseCatalogExercise> => {
    const item = customizingItem;
    if (!item) throw new Error('No shared exercise selected');
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
    setCustomizingItem(null);
    setFeedback({ tone: 'success', message: `Added "${exercise.name}" to your exercises.` });
  };

  const availablePersonalExercises = useMemo(() => {
    const q = shareSearch.trim().toLowerCase();
    return catalog.exercises
      .filter((e) => !e.deletedAt)
      .filter((e) => q.length === 0 || e.name.toLowerCase().includes(q));
  }, [catalog.exercises, shareSearch]);

  const items = resource.data?.shared_exercises ?? [];

  return (
    <View style={styles.container} testID="group-shared-exercises-section">
      <View style={styles.header}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
          Shared library
        </Text>
        <ActionButton
          accessibilityLabel="Share exercise with group"
          label="+ Share exercise"
          onPress={() => setSharePickerOpen(true)}
          testID="group-shared-exercises-share-btn"
          variant="outline"
        />
      </View>

      {feedback ? (
        <GroupWriteNotice message={feedback.message} testID="group-shared-exercises-feedback" tone={feedback.tone} />
      ) : null}

      {!resource.data && (offline || resource.error) ? (
        <GroupMissingDataState
          error={resource.error}
          offline={offline}
          onRetry={resource.refresh}
          testIDPrefix="group-shared-exercises"
        />
      ) : items.length === 0 ? (
        <GroupStateView
          body="Share exercises from your personal catalog with the group so members can add or link them."
          testID="group-shared-exercises-empty"
          title="No shared exercises yet"
        />
      ) : (
        <View style={styles.list} testID="group-shared-exercises-list">
          {items.map((item) => (
            <GroupSharedExerciseCard
              canDelete={canDelete(item)}
              catalog={catalog}
              dateFormat={dateFormat}
              isPending={pendingId === item.id}
              item={item}
              key={item.id}
              links={links.links}
              onCustomize={setCustomizingItem}
              onDelete={handleDelete}
              onDirectAdd={handleDirectAdd}
              onLinkExisting={handleLinkExisting}
              userId={userId}
            />
          ))}
        </View>
      )}

      {/* Sheet to pick personal exercise to share */}
      <ShareExercisePickerSheet
        exercises={availablePersonalExercises}
        onDismiss={() => {
          setSharePickerOpen(false);
          setShareSearch('');
        }}
        onSearchChange={setShareSearch}
        onSelect={handleSharePersonalExercise}
        search={shareSearch}
        visible={sharePickerOpen}
      />

      {/* Exercise editor modal for customizing before saving */}
      {customizingItem ? (
        <ExerciseEditorModal
          editingExercise={null}
          onRequestClose={() => setCustomizingItem(null)}
          onSave={handleCustomSave}
          onSaved={handleCustomSaved}
          prefill={{
            name: customizingItem.exercise.name,
            loadInputMode: customizingItem.exercise.load_input_mode,
            bodyweightContribution: customizingItem.exercise.bodyweight_contribution,
            mappings: customizingItem.exercise.mappings.map((m) => ({
              muscleGroupId: m.muscle_group_id,
              weight: m.weight,
              role: m.role ?? 'primary',
            })),
          }}
          visible={customizingItem !== null}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: uiSpace.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  microLabel: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.sm, color: uiRoles.inkMuted },
  list: { gap: uiSpace.sm },
  card: { padding: uiSpace.md, gap: uiSpace.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardAuthor: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, color: uiRoles.inkMuted },
  exerciseName: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.lg, color: uiRoles.ink },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: uiSpace.xs, marginTop: uiSpace.xs },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: uiSpace.sm, marginTop: uiSpace.xs },
  sheetContent: { gap: uiSpace.md, maxHeight: 400 },
  sheetList: { maxHeight: 320 },
  emptySearchText: { padding: uiSpace.md, textAlign: 'center', color: uiRoles.inkMuted },
});
