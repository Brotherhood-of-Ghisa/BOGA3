import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, type ListRenderItem } from 'react-native';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { uiColors } from '@/components/ui';
import {
  deleteExerciseCatalogExercise,
  undeleteExerciseCatalogExercise,
  type ExerciseCatalogExercise,
  type ExerciseCatalogMuscleGroup,
} from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { filterIndexedExerciseCatalogExercises } from '@/src/exercise-catalog/search';

const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getMuscleDisplayName = (
  muscleGroupId: string,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
) => muscleGroupById.get(muscleGroupId)?.displayName ?? muscleGroupId;

const pickPrimaryMapping = (exercise: ExerciseCatalogExercise) =>
  exercise.mappings.find((mapping) => mapping.role === 'primary') ??
  [...exercise.mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

const formatExerciseMuscleSummary = (
  exercise: ExerciseCatalogExercise,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
) => {
  if (exercise.mappings.length === 0) {
    return 'No muscle links';
  }

  const primaryMapping = pickPrimaryMapping(exercise);

  if (!primaryMapping) {
    return 'No muscle links';
  }

  const secondaryMappings = exercise.mappings.filter((mapping) => mapping.id !== primaryMapping.id);
  const primaryLabel = getMuscleDisplayName(primaryMapping.muscleGroupId, muscleGroupById);

  if (secondaryMappings.length === 0) {
    return primaryLabel;
  }

  if (secondaryMappings.length === 1) {
    const secondaryLabel = getMuscleDisplayName(secondaryMappings[0].muscleGroupId, muscleGroupById);
    return `${primaryLabel} · ${secondaryLabel} (s)`;
  }

  return `${primaryLabel} · ${secondaryMappings.length} secondaries`;
};

const SEARCH_DEBOUNCE_MS = 150;

const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debouncedValue;
};

const ExerciseRowSeparator = () => <View style={styles.exerciseListRowSeparator} />;

type ExerciseRowProps = {
  exercise: ExerciseCatalogExercise;
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>;
  onPressEdit: (exercise: ExerciseCatalogExercise) => void;
  onPressActions: (exercise: ExerciseCatalogExercise) => void;
};

const ExerciseRow = memo(function ExerciseRow({
  exercise,
  muscleGroupById,
  onPressEdit,
  onPressActions,
}: ExerciseRowProps) {
  return (
    <View style={styles.exerciseListRow}>
      <Pressable
        accessibilityLabel={`Edit exercise definition ${exercise.name}`}
        style={styles.exerciseListRowMainPressable}
        onPress={() => onPressEdit(exercise)}>
        <View style={styles.exerciseListRowTextStack}>
          <View style={styles.exerciseListRowTitleRow}>
            <Text numberOfLines={1} style={styles.exerciseListRowTitle}>
              {exercise.name}
            </Text>
            {exercise.deletedAt ? (
              <Text selectable style={styles.deletedExerciseChip}>
                Deleted
              </Text>
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.exerciseListRowMuscleSummary}>
            {formatExerciseMuscleSummary(exercise, muscleGroupById)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`Exercise actions ${exercise.name}`}
        style={styles.exerciseRowKebabButton}
        onPress={() => onPressActions(exercise)}>
        <Text style={styles.exerciseRowKebabText}>⋮</Text>
      </Pressable>
    </View>
  );
});

export default function ExerciseCatalogScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string | string[]; intent?: string | string[] }>();
  const routeSource = coerceRouteParam(params.source);
  const routeIntent = coerceRouteParam(params.intent);
  const isFromSessionRecorder = routeSource === 'session-recorder';

  const [isEditorModalVisible, setIsEditorModalVisible] = useState(false);
  const [isCatalogOptionsMenuVisible, setIsCatalogOptionsMenuVisible] = useState(false);
  const [showDeletedExercises, setShowDeletedExercises] = useState(false);
  const [didHandleInitialIntent, setDidHandleInitialIntent] = useState(false);
  const [exerciseActionMenuTarget, setExerciseActionMenuTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [editorExerciseTarget, setEditorExerciseTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [exerciseSearchValue, setExerciseSearchValue] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const catalog = useExerciseCatalog();
  const isLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const loadError = catalog.status === 'error' ? catalog.lastError ?? 'Unable to load exercise catalog. Try again.' : null;
  const exercises = catalog.exercises;
  const muscleGroups = catalog.muscleGroups;

  const debouncedExerciseSearchValue = useDebouncedValue(exerciseSearchValue, SEARCH_DEBOUNCE_MS);

  const muscleGroupById = useMemo(
    () => new Map(muscleGroups.map((muscleGroup) => [muscleGroup.id, muscleGroup])),
    [muscleGroups]
  );
  const visibleExercises = useMemo(
    () => (showDeletedExercises ? exercises : exercises.filter((exercise) => !exercise.deletedAt)),
    [exercises, showDeletedExercises]
  );
  const filteredExercises = useMemo(
    () => filterIndexedExerciseCatalogExercises(visibleExercises, debouncedExerciseSearchValue),
    [visibleExercises, debouncedExerciseSearchValue]
  );

  const openEditorForExercise = useCallback((exercise: ExerciseCatalogExercise) => {
    setEditorExerciseTarget(exercise);
    setSaveFeedback(null);
    setIsEditorModalVisible(true);
  }, []);

  const handlePressEditRow = useCallback(
    (exercise: ExerciseCatalogExercise) => {
      if (exercise.deletedAt) {
        return;
      }
      openEditorForExercise(exercise);
    },
    [openEditorForExercise]
  );

  const handlePressRowActions = useCallback((exercise: ExerciseCatalogExercise) => {
    setExerciseActionMenuTarget(exercise);
  }, []);

  const renderExerciseRow = useCallback<ListRenderItem<ExerciseCatalogExercise>>(
    ({ item }) => (
      <ExerciseRow
        exercise={item}
        muscleGroupById={muscleGroupById}
        onPressEdit={handlePressEditRow}
        onPressActions={handlePressRowActions}
      />
    ),
    [muscleGroupById, handlePressEditRow, handlePressRowActions]
  );

  const keyExtractor = useCallback((item: ExerciseCatalogExercise) => item.id, []);

  const startNewExercise = () => {
    setEditorExerciseTarget(null);
    setSaveFeedback(null);
    setIsEditorModalVisible(true);
  };

  useEffect(() => {
    if (didHandleInitialIntent || isLoading || loadError) {
      return;
    }

    if (routeIntent === 'add') {
      setEditorExerciseTarget(null);
      setSaveFeedback(null);
      setIsEditorModalVisible(true);
    }

    setDidHandleInitialIntent(true);
  }, [didHandleInitialIntent, isLoading, loadError, routeIntent]);

  const closeEditorModal = () => {
    setIsEditorModalVisible(false);
    setEditorExerciseTarget(null);
    setExerciseActionMenuTarget(null);
  };

  const handleEditorSaved = () => {
    const wasEditing = editorExerciseTarget !== null;
    setSaveFeedback(wasEditing ? 'Exercise updated.' : 'Exercise created.');
    setIsEditorModalVisible(false);
    setEditorExerciseTarget(null);
    setExerciseActionMenuTarget(null);

    if (isFromSessionRecorder) {
      router.back();
    }
  };

  const deleteExercise = async (exercise: ExerciseCatalogExercise) => {
    try {
      await deleteExerciseCatalogExercise(exercise.id);
      setSaveFeedback('Exercise deleted.');

      if (editorExerciseTarget?.id === exercise.id) {
        setEditorExerciseTarget(null);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to delete exercise.');
    }
  };

  const undeleteExercise = async (exercise: ExerciseCatalogExercise) => {
    try {
      await undeleteExerciseCatalogExercise(exercise.id);
      setSaveFeedback('Exercise restored.');
      setExerciseActionMenuTarget(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to restore exercise.');
    }
  };

  const toggleShowDeletedExercises = () => {
    setIsCatalogOptionsMenuVisible(false);
    setShowDeletedExercises((current) => !current);
    setSaveError(null);
    setSaveFeedback(null);
  };

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredState}>
          <Text selectable style={styles.stateText}>
            Loading exercise catalog…
          </Text>
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredState}>
          <Text selectable style={styles.errorText}>
            {loadError}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.pinnedTopRegion}>
        <View style={styles.topActionRow}>
          <TextInput
            accessibilityLabel="Exercise filter input"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setExerciseSearchValue}
            placeholder="Filter by exercise or muscle group"
            style={[styles.filterInput, styles.filterInputInline]}
            value={exerciseSearchValue}
          />
          <View style={styles.topActionButtonsCluster}>
            <Pressable
              accessibilityLabel="Create new exercise"
              style={[styles.iconActionButton, styles.createExerciseButton]}
              onPress={startNewExercise}
              testID="create-new-exercise-button">
              <Text style={styles.createExerciseButtonText}>+</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Exercise catalog options"
              style={styles.iconActionButton}
              onPress={() => setIsCatalogOptionsMenuVisible(true)}>
              <Text style={styles.iconActionButtonText}>⋮</Text>
            </Pressable>
          </View>
        </View>
        {showDeletedExercises ? (
          <Text selectable style={styles.activeFilterChip}>
            Deleted: On
          </Text>
        ) : null}
        {saveFeedback ? (
          <View style={styles.feedbackCard}>
            <Text selectable style={styles.successText}>
              {saveFeedback}
            </Text>
          </View>
        ) : null}
        {saveError ? (
          <View style={styles.errorCard}>
            <Text selectable style={styles.errorText}>
              {saveError}
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        style={styles.scroll}
        data={filteredExercises}
        keyExtractor={keyExtractor}
        renderItem={renderExerciseRow}
        ItemSeparatorComponent={ExerciseRowSeparator}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews
        ListEmptyComponent={
          <Text selectable style={styles.helperText}>
            {exercises.length === 0
              ? showDeletedExercises
                ? 'No exercises found for this filter.'
                : 'No active exercises yet. Create one with the button above.'
              : 'No exercises match that filter.'}
          </Text>
        }
      />

      <ExerciseEditorModal
        visible={isEditorModalVisible}
        editingExercise={editorExerciseTarget}
        onRequestClose={closeEditorModal}
        onSaved={handleEditorSaved}
      />

      <Modal
        animationType="fade"
        transparent
        visible={isCatalogOptionsMenuVisible}
        onRequestClose={() => setIsCatalogOptionsMenuVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss exercise catalog options overlay"
            style={styles.modalOverlay}
            onPress={() => setIsCatalogOptionsMenuVisible(false)}
          />
          <View style={styles.actionMenuCard}>
            <Text selectable style={styles.modalTitle}>
              Catalog Options
            </Text>
            <Pressable
              accessibilityLabel={showDeletedExercises ? 'Hide deleted exercises' : 'Show deleted exercises'}
              style={styles.actionMenuButton}
              onPress={toggleShowDeletedExercises}>
              <Text style={styles.actionMenuButtonText}>{showDeletedExercises ? 'Hide deleted' : 'Show deleted'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={exerciseActionMenuTarget !== null}
        onRequestClose={() => setExerciseActionMenuTarget(null)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss exercise action menu overlay"
            style={styles.modalOverlay}
            onPress={() => setExerciseActionMenuTarget(null)}
          />
          <View style={styles.actionMenuCard}>
            <Text selectable style={styles.modalTitle}>
              Exercise Actions
            </Text>
            <Text selectable style={styles.helperText}>
              {exerciseActionMenuTarget?.name ?? 'Exercise'}
            </Text>
            <Pressable
              accessibilityLabel="Edit exercise from actions"
              style={styles.actionMenuButton}
              disabled={Boolean(exerciseActionMenuTarget?.deletedAt)}
              onPress={() => {
                const target = exerciseActionMenuTarget;
                setExerciseActionMenuTarget(null);
                if (target && !target.deletedAt) {
                  openEditorForExercise(target);
                }
              }}>
              <Text style={styles.actionMenuButtonText}>Edit</Text>
            </Pressable>
            {exerciseActionMenuTarget?.deletedAt ? (
              <Pressable
                accessibilityLabel="Undelete exercise from actions"
                style={styles.actionMenuButton}
                onPress={() => {
                  const target = exerciseActionMenuTarget;
                  if (target) {
                    void undeleteExercise(target);
                  }
                }}>
                <Text style={styles.actionMenuButtonText}>Undelete</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="Delete exercise from actions"
                style={[styles.actionMenuButton, styles.actionMenuDeleteButton]}
                onPress={() => {
                  const target = exerciseActionMenuTarget;
                  setExerciseActionMenuTarget(null);
                  if (target) {
                    void deleteExercise(target);
                  }
                }}>
                <Text style={styles.actionMenuDeleteButtonText}>Delete</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 12,
    paddingBottom: 12,
  },
  pinnedTopRegion: {
    gap: 8,
    flexShrink: 0,
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topActionButtonsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  iconActionButton: {
    width: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  iconActionButtonText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  createExerciseButton: {
    backgroundColor: uiColors.actionPrimary,
    borderColor: uiColors.actionPrimary,
  },
  createExerciseButtonText: {
    fontSize: 26,
    lineHeight: 26,
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  activeFilterChip: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.textWarning,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    color: uiColors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 42,
  },
  filterInputInline: {
    flex: 1,
    minWidth: 0,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  stateText: {
    fontSize: 15,
    color: uiColors.textPrimary,
  },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 10,
  },
  feedbackCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  exerciseListRowSeparator: {
    height: 8,
  },
  helperText: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  errorText: {
    fontSize: 13,
    color: uiColors.actionDanger,
    fontWeight: '500',
  },
  successText: {
    fontSize: 13,
    color: uiColors.textSuccess,
    fontWeight: '600',
  },
  exerciseListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: uiColors.surfaceDefault,
  },
  exerciseListRowMainPressable: {
    flex: 1,
  },
  exerciseListRowTextStack: {
    flex: 1,
    gap: 1,
  },
  exerciseListRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exerciseListRowTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  exerciseListRowMuscleSummary: {
    fontSize: 11,
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
  deletedExerciseChip: {
    fontSize: 9,
    fontWeight: '700',
    color: uiColors.textWarning,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  exerciseRowKebabButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
  },
  exerciseRowKebabText: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.textSecondary,
    lineHeight: 16,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  actionMenuCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 8,
  },
  actionMenuButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionMenuButtonText: {
    color: uiColors.textPrimary,
    fontWeight: '700',
  },
  actionMenuDeleteButton: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  actionMenuDeleteButtonText: {
    color: uiColors.actionDangerText,
    fontWeight: '700',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
});
