import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import {
  deleteExerciseCatalogExercise,
  undeleteExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  buildExerciseListModel,
  getExerciseListDateRangeLabel,
  type ExerciseListItem,
} from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';

const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

type CatalogFilters = {
  muscleGroupIds: ReadonlySet<string>;
  showDeleted: boolean;
  showNeverDone: boolean;
};

const DEFAULT_FILTERS: CatalogFilters = {
  muscleGroupIds: new Set<string>(),
  showDeleted: false,
  showNeverDone: true,
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

export default function ExerciseCatalogScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string | string[]; intent?: string | string[] }>();
  const routeSource = coerceRouteParam(params.source);
  const routeIntent = coerceRouteParam(params.intent);
  const isFromSessionRecorder = routeSource === 'session-recorder';

  const [isEditorModalVisible, setIsEditorModalVisible] = useState(false);
  const [isCatalogOptionsMenuVisible, setIsCatalogOptionsMenuVisible] = useState(false);
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [didHandleInitialIntent, setDidHandleInitialIntent] = useState(false);
  const [exerciseActionMenuTarget, setExerciseActionMenuTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [editorExerciseTarget, setEditorExerciseTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [exerciseSearchValue, setExerciseSearchValue] = useState('');
  const [expandedExerciseFamilies, setExpandedExerciseFamilies] = useState<Set<string>>(() => new Set());
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  // Signed in only: linking needs my groups' exercises (M25-T07).
  const groupLinkingUserId = useGroupLinkingUserId();

  const catalog = useExerciseCatalog();
  const isLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const loadError = catalog.status === 'error' ? catalog.lastError ?? 'Unable to load exercise catalog. Try again.' : null;
  const exercises = catalog.exercises;
  const muscleGroups = catalog.muscleGroups;

  const statsResult = useExerciseCatalogStats(listPreferences.dateRange);
  const { stats, reload: reloadStats } = statsResult;

  useFocusEffect(
    useCallback(() => {
      reloadStats();
    }, [reloadStats])
  );

  const debouncedExerciseSearchValue = useDebouncedValue(exerciseSearchValue, SEARCH_DEBOUNCE_MS);

  const exerciseListModel = useMemo(
    () =>
      buildExerciseListModel({
        exercises,
        muscleGroups,
        stats,
        preferences: listPreferences,
        query: debouncedExerciseSearchValue,
        includeDeleted: filters.showDeleted,
        showNeverDone: filters.showNeverDone,
        selectedMuscleGroupIds: filters.muscleGroupIds,
      }),
    [
      exercises,
      muscleGroups,
      stats,
      listPreferences,
      debouncedExerciseSearchValue,
      filters.showDeleted,
      filters.showNeverDone,
      filters.muscleGroupIds,
    ]
  );

  const openEditorForExercise = useCallback((exercise: ExerciseCatalogExercise) => {
    setEditorExerciseTarget(exercise);
    setSaveFeedback(null);
    setIsEditorModalVisible(true);
  }, []);

  const handlePressEditRow = useCallback(
    (exercise: ExerciseListItem) => {
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

  const renderExerciseActions = useCallback(
    (exercise: ExerciseListItem) => (
      <Pressable
        accessibilityLabel={`Exercise actions ${exercise.name}`}
        style={styles.exerciseRowKebabButton}
        onPress={() => handlePressRowActions(exercise)}>
        <Text style={styles.exerciseRowKebabText}>⋮</Text>
      </Pressable>
    ),
    [handlePressRowActions]
  );

  const toggleExerciseFamily = useCallback((familyName: string) => {
    setExpandedExerciseFamilies((current) => {
      const next = new Set(current);
      if (next.has(familyName)) {
        next.delete(familyName);
      } else {
        next.add(familyName);
      }
      return next;
    });
  }, []);

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

  const toggleFilterMuscleGroup = (muscleGroupId: string) => {
    setFilters((current) => {
      const next = new Set(current.muscleGroupIds);
      if (next.has(muscleGroupId)) {
        next.delete(muscleGroupId);
      } else {
        next.add(muscleGroupId);
      }
      return { ...current, muscleGroupIds: next };
    });
  };
  const clearFilterMuscleGroups = () => {
    setFilters((current) => ({ ...current, muscleGroupIds: new Set<string>() }));
  };
  const toggleFilterShowDeleted = () => {
    setFilters((current) => ({ ...current, showDeleted: !current.showDeleted }));
    setSaveError(null);
    setSaveFeedback(null);
  };
  const toggleFilterShowNeverDone = () => {
    setFilters((current) => ({ ...current, showNeverDone: !current.showNeverDone }));
  };

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    chips.push({ key: 'period', label: `Range: ${getExerciseListDateRangeLabel(listPreferences.dateRange)}` });
    chips.push({ key: 'grouping', label: listPreferences.groupByMuscleFamily ? 'Grouped' : 'Flat' });
    chips.push({ key: 'recents', label: listPreferences.recentsOnTop ? 'Recents: On' : 'A-Z' });
    if (filters.muscleGroupIds.size > 0) {
      chips.push({ key: 'muscles', label: `Muscles: ${filters.muscleGroupIds.size}` });
    }
    if (!filters.showNeverDone) chips.push({ key: 'never-done', label: 'Hide never-done' });
    if (filters.showDeleted) chips.push({ key: 'deleted', label: 'Deleted: On' });
    return chips;
  }, [filters, listPreferences]);

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
        <MoreHubBackButton />
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
        {activeFilterChips.length > 0 ? (
          <View style={styles.activeFilterChipsRow}>
            {activeFilterChips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityLabel={`Open filters (${chip.label})`}
                onPress={() => setIsCatalogOptionsMenuVisible(true)}>
                <Text selectable style={styles.activeFilterChip}>
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </View>
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

      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <ExerciseListContent
          mode={exerciseListModel.mode}
          items={exerciseListModel.items}
          sections={exerciseListModel.sections}
          expandedFamilies={expandedExerciseFamilies}
          emptyText={
            exercises.length === 0
              ? 'No active exercises yet. Create one with the button above.'
              : 'No exercises match the current filters.'
          }
          onToggleFamily={toggleExerciseFamily}
          onPressExercise={handlePressEditRow}
          getExerciseAccessibilityLabel={(exercise) => `Edit exercise definition ${exercise.name}`}
          renderActions={renderExerciseActions}
        />
        {exerciseListModel.items.length === 0 && exerciseListModel.mode === 'grouped' ? (
          <Text selectable style={styles.helperText}>
            {exercises.length === 0
              ? 'No active exercises yet. Create one with the button above.'
              : 'No exercises match the current filters.'}
          </Text>
        ) : null}
      </ScrollView>

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
          <View style={styles.filtersModalCard}>
            <View style={styles.filtersModalHeader}>
              <Text selectable style={styles.modalTitle}>
                Filters
              </Text>
              <Pressable
                accessibilityLabel="Close filters"
                style={styles.filtersCloseButton}
                onPress={() => setIsCatalogOptionsMenuVisible(false)}>
                <Text style={styles.filtersCloseButtonText}>Done</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.filtersScroll}
              contentContainerStyle={styles.filtersScrollContent}
              keyboardShouldPersistTaps="handled">
              <ExerciseListPreferenceControls
                preferences={listPreferences}
                onChangePreferences={setListPreferences}
              />

              <View style={styles.filtersSectionHeaderRow}>
                <Text selectable style={styles.filtersSectionLabel}>
                  Muscle groups
                </Text>
                {filters.muscleGroupIds.size > 0 ? (
                  <Pressable
                    accessibilityLabel="Clear muscle group selection"
                    onPress={clearFilterMuscleGroups}>
                    <Text style={styles.filtersClearLink}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.filtersPillRow}>
                {muscleGroups.length === 0 ? (
                  <Text style={styles.helperText}>No muscle groups defined.</Text>
                ) : (
                  muscleGroups.map((group) => {
                    const selected = filters.muscleGroupIds.has(group.id);
                    return (
                      <Pressable
                        key={group.id}
                        accessibilityLabel={`Toggle muscle group ${group.displayName}`}
                        style={[styles.filterPill, selected && styles.filterPillSelected]}
                        onPress={() => toggleFilterMuscleGroup(group.id)}>
                        <Text
                          style={[
                            styles.filterPillText,
                            selected && styles.filterPillTextSelected,
                          ]}>
                          {group.displayName}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>

              <Text selectable style={styles.filtersSectionLabel}>
                Visibility
              </Text>
              <View style={styles.filtersPillRow}>
                <Pressable
                  accessibilityLabel={
                    filters.showDeleted ? 'Hide deleted exercises' : 'Show deleted exercises'
                  }
                  style={[styles.filterPill, filters.showDeleted && styles.filterPillSelected]}
                  onPress={toggleFilterShowDeleted}>
                  <Text
                    style={[
                      styles.filterPillText,
                      filters.showDeleted && styles.filterPillTextSelected,
                    ]}>
                    Show deleted
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={
                    filters.showNeverDone
                      ? 'Hide exercises never done'
                      : 'Show exercises never done'
                  }
                  style={[styles.filterPill, filters.showNeverDone && styles.filterPillSelected]}
                  onPress={toggleFilterShowNeverDone}>
                  <Text
                    style={[
                      styles.filterPillText,
                      filters.showNeverDone && styles.filterPillTextSelected,
                    ]}>
                    Show never-done
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
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
            {groupLinkingUserId ? (
              <Pressable
                accessibilityLabel="Link to group exercise from actions"
                accessibilityState={{ disabled: Boolean(exerciseActionMenuTarget?.deletedAt) }}
                style={styles.actionMenuButton}
                testID="exercise-action-link-group"
                // A soft-deleted exercise is never linked from the UI (M25-T07 (b)).
                disabled={Boolean(exerciseActionMenuTarget?.deletedAt)}
                onPress={() => {
                  const target = exerciseActionMenuTarget;
                  setExerciseActionMenuTarget(null);
                  if (target && !target.deletedAt) {
                    router.push(exerciseLinkHref(target.id));
                  }
                }}>
                <Text style={styles.actionMenuButtonText}>Link to group exercise…</Text>
              </Pressable>
            ) : null}
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
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.md,
  },
  pinnedTopRegion: {
    gap: uiSpace.sm,
    flexShrink: 0,
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  topActionButtonsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    marginLeft: 'auto',
  },
  iconActionButton: {
    width: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  iconActionButtonText: {
    fontSize: uiTypography.size.lg,
    lineHeight: 18,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  createExerciseButton: {
    backgroundColor: uiColors.actionPrimary,
    borderColor: uiColors.actionPrimary,
  },
  createExerciseButtonText: {
    fontSize: uiTypography.size.xxl,
    lineHeight: 26,
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  activeFilterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  activeFilterChip: {
    fontSize: uiTypography.size.xs,
    fontWeight: '700',
    color: uiColors.textAccentStrong,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: uiRadius.full,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
    overflow: 'hidden',
  },
  filterInput: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    color: uiColors.textPrimary,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
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
    padding: uiSpace.xl,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  stateText: {
    fontSize: uiTypography.size.base,
    color: uiColors.textPrimary,
  },
  section: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  feedbackCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  errorCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  helperText: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
  },
  errorText: {
    fontSize: uiTypography.size.md,
    color: uiColors.actionDanger,
    fontWeight: '500',
  },
  successText: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSuccess,
    fontWeight: '600',
  },
  exerciseRowKebabButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
  },
  exerciseRowKebabText: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textSecondary,
    lineHeight: 16,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: uiSpace.lg,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  actionMenuCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.sm,
  },
  actionMenuButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.md,
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
    fontSize: uiTypography.size.xl,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  filtersModalCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.sm,
    maxHeight: '85%',
  },
  filtersModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  filtersCloseButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  filtersCloseButtonText: {
    color: uiColors.textPrimary,
    fontWeight: '700',
  },
  filtersScroll: {
    flexGrow: 0,
  },
  filtersScrollContent: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  filtersSectionLabel: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: uiSpace.sm,
  },
  filtersSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: uiSpace.sm,
  },
  filtersClearLink: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.actionPrimary,
  },
  filtersPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  filterPill: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  filterPillSelected: {
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderColor: uiColors.actionPrimary,
  },
  filterPillText: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  filterPillTextSelected: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
  },
});
