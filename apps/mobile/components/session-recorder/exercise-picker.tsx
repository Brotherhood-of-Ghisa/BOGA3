import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ExerciseEditorModal, type ExerciseEditorSaveInput } from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { GroupExercisePickSheet, type GroupExercisePickTarget } from '@/components/groups/group-exercise-pick-sheet';
import { pickInlineError } from '@/components/groups/group-state-view';
import { PickerGroupSectionList, PickerGroupsToggle } from '@/components/groups/picker-group-section';
import { Icon } from '@/components/ui/icon';
import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui/tokens';
import { loadSuggestedExercisePlan, type ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { type ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { normalizeSessionSetType } from '@/src/data/set-types';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { buildExerciseListModel, type ExerciseListItem } from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
import { buildAddAsNewPrefill } from '@/src/groups/add-as-new';
import {
  buildPickerGroupSections,
  groupExercisesLoaded,
  resolvePickerGroupSelection,
  type LinkableExercise,
  type PickerGroupRow,
} from '@/src/groups/link-view-model';
import { useGroupExerciseLinking, useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import {
  formatCurrentDateTime,
  formatSetRepsLabel,
  formatSetWeightLabel,
  getSetQualityDisplayLabel,
} from '@/src/session-recorder/session-model';

export type ExercisePickerPreselectionState = {
  exercise: ExerciseListItem;
  status: 'loading' | 'ready' | 'error';
  suggestion: ExerciseBlockHistorySuggestedPlan | null;
};

export type ExercisePickerProps = {
  visible: boolean;
  // Bumped by the host each time it opens the picker afresh; resets the search,
  // preselection and Groups toggle and refreshes group links. Re-showing the
  // picker without a bump (returning from Manage) keeps them.
  openRequestId: number;
  onDismiss: () => void;
  onSelectExercise: (exerciseDefinitionId: string, exerciseName: string) => void;
  onAppendPlan: (
    exercise: { id: string; name: string },
    suggestion: ExerciseBlockHistorySuggestedPlan
  ) => void;
  // The host hides the picker, navigates to the catalogue, and re-shows it on return.
  onOpenManage: () => void;
};

/**
 * The session view's exercise picker: a filtered
 * catalogue list with shared list options, the add preselection (Add empty set
 * / Append plan), `From your groups` with its pick sheet (M25-T07), inline
 * create, and a Manage exit. It hides itself while one of its own editors or
 * sheets is open and returns when that closes.
 */
export function ExercisePicker({
  visible,
  openRequestId,
  onDismiss,
  onSelectExercise,
  onAppendPlan,
  onOpenManage,
}: ExercisePickerProps) {
  const groupLinkingUserId = useGroupLinkingUserId();
  const groupLinking = useGroupExerciseLinking({ userId: groupLinkingUserId });
  const [searchValue, setSearchValue] = useState('');
  const [preselection, setPreselection] = useState<ExercisePickerPreselectionState | null>(null);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set());
  const [groupsOnly, setGroupsOnly] = useState(false);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [groupPickTarget, setGroupPickTarget] = useState<GroupExercisePickTarget | null>(null);
  const [addAsNewTarget, setAddAsNewTarget] = useState<GroupExercisePickTarget | null>(null);
  const preselectionRequestKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  const exerciseCatalog = useExerciseCatalog();
  const { stats: exerciseCatalogStats } = useExerciseCatalogStats(listPreferences.dateRange);

  const isCatalogLoading = exerciseCatalog.status === 'idle' || exerciseCatalog.status === 'loading';
  const catalogLoadError =
    exerciseCatalog.status === 'error'
      ? exerciseCatalog.lastError ?? 'Unable to load exercises right now.'
      : null;
  const exerciseOptions = useMemo(
    () => exerciseCatalog.exercises.filter((exercise) => !exercise.deletedAt),
    [exerciseCatalog.exercises]
  );
  const addAsNewPrefill = useMemo(
    () => (addAsNewTarget ? buildAddAsNewPrefill(addAsNewTarget.groupExercise) : null),
    [addAsNewTarget]
  );
  const listModel = useMemo(
    () =>
      buildExerciseListModel({
        exercises: exerciseOptions,
        muscleGroups: exerciseCatalog.muscleGroups,
        stats: exerciseCatalogStats,
        preferences: listPreferences,
        query: searchValue,
        includeDeleted: false,
        showNeverDone: true,
      }),
    [exerciseOptions, exerciseCatalog.muscleGroups, exerciseCatalogStats, listPreferences, searchValue]
  );
  // "From your groups" (E0.1): only with search text or the Groups toggle on.
  const groupSections = useMemo(
    () =>
      buildPickerGroupSections({
        catalogs: groupLinking.catalogs,
        links: groupLinking.links,
        exercises: exerciseOptions,
        query: searchValue,
        groupsOnly,
      }),
    [groupLinking.catalogs, groupLinking.links, exerciseOptions, searchValue, groupsOnly]
  );
  const groupEmptyText = !groupExercisesLoaded(groupLinking.catalogs)
    ? groupLinking.offline
      ? "Connect once to load your groups' exercises."
      : pickInlineError(groupLinking.error)
        ? "Couldn't load your groups' exercises."
        : 'Loading group exercises...'
    : 'No group exercises match.';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { reloadLinks, refresh } = groupLinking;
  useEffect(() => {
    if (openRequestId === 0) {
      return;
    }
    setGroupsOnly(false);
    void reloadLinks();
    void refresh();
    setSearchValue('');
    setPreselection(null);
    preselectionRequestKeyRef.current = null;
    // Only a new open request resets; the link loaders are stable per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestId]);

  const clearPreselection = () => {
    setPreselection(null);
    preselectionRequestKeyRef.current = null;
  };

  const dismiss = () => {
    setSearchValue('');
    clearPreselection();
    setIsOptionsVisible(false);
    setGroupsOnly(false);
    onDismiss();
  };

  const selectExercise = (exerciseDefinitionId: string, exerciseName: string) => {
    clearPreselection();
    onSelectExercise(exerciseDefinitionId, exerciseName);
  };

  const updateSearchValue = (value: string) => {
    clearPreselection();
    setSearchValue(value);
  };

  const selectListItem = (exercise: ExerciseListItem) => {
    const requestKey = `${exercise.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    preselectionRequestKeyRef.current = requestKey;
    setIsOptionsVisible(false);
    setPreselection({ exercise, status: 'loading', suggestion: null });

    void loadSuggestedExercisePlan({ exerciseDefinitionId: exercise.id })
      .then((suggestion) => {
        if (!isMountedRef.current || preselectionRequestKeyRef.current !== requestKey) {
          return;
        }
        setPreselection({ exercise, status: 'ready', suggestion });
      })
      .catch(() => {
        if (!isMountedRef.current || preselectionRequestKeyRef.current !== requestKey) {
          return;
        }
        setPreselection({ exercise, status: 'error', suggestion: null });
      });
  };

  const appendPlan = (state: ExercisePickerPreselectionState) => {
    const suggestion = state.suggestion;
    if (!suggestion || suggestion.sets.length === 0) {
      return;
    }
    setSearchValue('');
    clearPreselection();
    onAppendPlan({ id: state.exercise.id, name: state.exercise.name }, suggestion);
  };

  const toggleFamily = (familyName: string) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(familyName)) {
        next.delete(familyName);
      } else {
        next.add(familyName);
      }
      return next;
    });
  };

  const openManage = () => {
    clearPreselection();
    onOpenManage();
  };

  const openInlineCreate = () => {
    clearPreselection();
    setIsCreateModalVisible(true);
  };

  const handleInlineCreated = (exercise: ExerciseCatalogExercise) => {
    setIsCreateModalVisible(false);
    selectExercise(exercise.id, exercise.name);
  };

  // ---- M25-T07: group exercises in the picker (E0.1) and the pick sheet (E0.2).

  const toggleGroupsOnly = () => {
    clearPreselection();
    setGroupsOnly((current) => !current);
  };

  const selectGroupRow = (row: PickerGroupRow) => {
    const selection = resolvePickerGroupSelection(row);
    if (selection.kind === 'add') {
      selectExercise(selection.exercise.id, selection.exercise.name);
      return;
    }
    // Like the inline create editor: hide the picker while the sheet is open.
    clearPreselection();
    setGroupPickTarget({
      groupId: row.groupId,
      groupName: row.groupName,
      groupExercise: row.groupExercise,
      mode: selection.kind === 'choose-linked' ? 'choose-linked' : 'link',
      linkedExercises: row.linkedExercises,
    });
  };

  const addFromGroupPickSheet = (exercise: LinkableExercise) => {
    setGroupPickTarget(null);
    selectExercise(exercise.id, exercise.name);
  };

  // A local write, so it works offline; a failure rejects into the sheet's inline error.
  const linkAndAddFromGroupPickSheet = async (exercise: LinkableExercise) => {
    const target = groupPickTarget;
    if (!target) {
      return;
    }
    await linkExercise(exercise.id, target.groupId, target.groupExercise.group_exercise_id);
    void groupLinking.reloadLinks();
    setGroupPickTarget(null);
    selectExercise(exercise.id, exercise.name);
  };

  const openAddAsNewFromGroupPickSheet = () => {
    setAddAsNewTarget(groupPickTarget);
    setGroupPickTarget(null);
  };

  // "Add as new": the exercise and its link commit in one local transaction.
  const saveAddAsNewExercise = async (input: ExerciseEditorSaveInput): Promise<ExerciseCatalogExercise> => {
    const target = addAsNewTarget;
    if (!target) {
      throw new Error('No group exercise selected.');
    }
    const { exercise } = await createExerciseWithGroupLink(input, {
      groupId: target.groupId,
      groupExerciseId: target.groupExercise.group_exercise_id,
    });
    return exercise;
  };

  const handleAddAsNewSaved = (exercise: ExerciseCatalogExercise) => {
    setAddAsNewTarget(null);
    void groupLinking.reloadLinks();
    selectExercise(exercise.id, exercise.name);
  };

  const isChildOpen = isCreateModalVisible || groupPickTarget !== null || addAsNewTarget !== null;

  return (
    <>
      <Modal animationType="slide" transparent visible={visible && !isChildOpen} onRequestClose={dismiss}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            accessibilityLabel="Dismiss exercise modal overlay"
            style={styles.modalBackdrop}
            onPress={dismiss}
          />

          <View style={[styles.modalCard, styles.exercisePickerModalCard]}>
            <View style={styles.exercisePickerHeaderRow}>
              <Text allowFontScaling={false} style={styles.modalTitle}>Select Exercise</Text>
              <View style={styles.exercisePickerHeaderActionRow}>
                <Pressable
                  accessibilityLabel="Exercise picker options"
                  style={styles.exercisePickerIconButton}
                  onPress={() => {
                    clearPreselection();
                    setIsOptionsVisible((current) => !current);
                  }}>
                  <Icon color={uiColors.textMuted} name="more-vertical" size="md" />
                </Pressable>
                <Pressable
                  accessibilityLabel="Open exercise catalog manage flow"
                  style={styles.exercisePickerIconButton}
                  onPress={openManage}>
                  <Text allowFontScaling={false} style={styles.exercisePickerIconButtonText}>≡</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Open inline exercise create"
                  style={styles.exercisePickerIconButton}
                  onPress={openInlineCreate}>
                  <Text allowFontScaling={false} style={styles.exercisePickerIconButtonText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.exercisePickerSearchRow}>
              <TextInput
                allowFontScaling={false}
                accessibilityLabel="Exercise filter input"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Filter by exercise or muscle group"
                style={[styles.input, styles.exercisePickerSearchInput]}
                value={searchValue}
                onChangeText={updateSearchValue}
              />
              {groupLinkingUserId ? <PickerGroupsToggle active={groupsOnly} onToggle={toggleGroupsOnly} /> : null}
            </View>
            {isOptionsVisible ? (
              <View style={styles.exercisePickerOptionsPanel}>
                <ExerciseListPreferenceControls preferences={listPreferences} onChangePreferences={setListPreferences} />
              </View>
            ) : null}
            {/*
              The filter input above keeps focus while the user picks a result.
              With the ScrollView's default `keyboardShouldPersistTaps="never"`,
              the first tap on a result row is consumed to dismiss the keyboard
              instead of firing the row's `onPress`, so the exercise is never
              selected and the modal stays open. `"handled"` lets the tap reach
              the row Pressables while still dismissing the keyboard on taps that
              hit empty list space.
            */}
            <ScrollView contentContainerStyle={styles.modalList} keyboardShouldPersistTaps="handled">
              {isCatalogLoading ? <Text allowFontScaling={false} style={styles.emptyText}>Loading exercises...</Text> : null}
              {!isCatalogLoading && catalogLoadError ? <Text allowFontScaling={false} style={styles.emptyText}>{catalogLoadError}</Text> : null}
              {!isCatalogLoading && !catalogLoadError && preselection ? (
                <>
                  <View style={styles.exercisePickerPreselectionPanel} testID="exercise-picker-preselection-panel">
                    <Text allowFontScaling={false} style={styles.exercisePickerPreselectionTitle}>{preselection.exercise.name}</Text>
                    <View style={styles.exercisePickerPreselectionActions}>
                      <Pressable
                        accessibilityLabel={`Add empty set for ${preselection.exercise.name}`}
                        accessibilityRole="button"
                        style={styles.secondaryActionButton}
                        testID="exercise-picker-add-empty-set-button"
                        onPress={() => selectExercise(preselection.exercise.id, preselection.exercise.name)}>
                        <Text allowFontScaling={false} style={styles.secondaryActionButtonText}>Add empty set</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Append historical plan for ${preselection.exercise.name}`}
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: preselection.status !== 'ready' || !preselection.suggestion,
                        }}
                        disabled={preselection.status !== 'ready' || !preselection.suggestion}
                        style={[
                          styles.primaryActionButton,
                          preselection.status !== 'ready' || !preselection.suggestion
                            ? styles.exercisePickerAppendPlanButtonDisabled
                            : null,
                        ]}
                        testID="exercise-picker-append-plan-button"
                        onPress={() => appendPlan(preselection)}>
                        <Text allowFontScaling={false} style={styles.primaryActionButtonText}>Append plan</Text>
                      </Pressable>
                    </View>
                    {preselection.suggestion ? (
                      <View style={styles.exercisePickerPlanPreview}>
                        <Text allowFontScaling={false} style={styles.exercisePickerPlanPreviewSource} testID="exercise-picker-plan-source">
                          From {formatCurrentDateTime(preselection.suggestion.completedAt)}
                        </Text>
                        <ScrollView
                          nestedScrollEnabled
                          style={styles.exercisePickerPlanSetList}
                          contentContainerStyle={styles.exercisePickerPlanSetListContent}>
                          {preselection.suggestion.sets.map((set, index) => {
                            const quality = normalizeSessionSetType(set.setType);
                            return (
                              <View
                                key={set.setId}
                                style={styles.exercisePickerPlanSetRow}
                                testID={`exercise-picker-plan-set-row-${index + 1}`}>
                                <Text allowFontScaling={false} style={styles.exercisePickerPlanSetIndex}>Set {index + 1}</Text>
                                <Text allowFontScaling={false} style={styles.exercisePickerPlanSetValue}>
                                  {formatSetWeightLabel(set.weightValue)} · {formatSetRepsLabel(set.repsValue)}
                                </Text>
                                {quality ? (
                                  <Text allowFontScaling={false} style={styles.exercisePickerPlanSetQuality}>
                                    {getSetQualityDisplayLabel(quality)}
                                  </Text>
                                ) : null}
                              </View>
                            );
                          })}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityLabel="Dismiss exercise preselection"
                    style={styles.exercisePickerPreselectionDismissArea}
                    testID="exercise-picker-preselection-dismiss-area"
                    onPress={clearPreselection}
                  />
                </>
              ) : null}
              {!isCatalogLoading && !catalogLoadError && !preselection ? (
                groupsOnly ? (
                  groupSections.length > 0 ? (
                    <PickerGroupSectionList sections={groupSections} onPressRow={selectGroupRow} />
                  ) : (
                    <Text allowFontScaling={false} style={styles.emptyText} testID="exercise-picker-group-empty">
                      {groupEmptyText}
                    </Text>
                  )
                ) : (
                  <>
                    <ExerciseListContent
                      mode={listModel.mode}
                      items={listModel.items}
                      sections={listModel.sections}
                      expandedFamilies={expandedFamilies}
                      emptyText={
                        exerciseOptions.length === 0 ? 'No active exercises available.' : 'No exercises match that filter.'
                      }
                      onToggleFamily={toggleFamily}
                      onPressExercise={selectListItem}
                    />
                    {listModel.items.length === 0 && listModel.mode === 'grouped' ? (
                      <Text allowFontScaling={false} style={styles.emptyText}>
                        {exerciseOptions.length === 0 ? 'No active exercises available.' : 'No exercises match that filter.'}
                      </Text>
                    ) : null}
                    {/* After my own matches (E0.1); empty without search text. */}
                    <PickerGroupSectionList sections={groupSections} onPressRow={selectGroupRow} />
                  </>
                )
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ExerciseEditorModal
        visible={isCreateModalVisible}
        editingExercise={null}
        onRequestClose={() => setIsCreateModalVisible(false)}
        onSaved={handleInlineCreated}
      />

      <GroupExercisePickSheet
        target={groupPickTarget}
        exercises={exerciseOptions}
        links={groupLinking.links}
        onRequestClose={() => setGroupPickTarget(null)}
        onAddExercise={addFromGroupPickSheet}
        onLinkAndAdd={linkAndAddFromGroupPickSheet}
        onAddAsNew={openAddAsNewFromGroupPickSheet}
      />

      <ExerciseEditorModal
        visible={addAsNewTarget !== null}
        editingExercise={null}
        prefill={addAsNewPrefill}
        title="Add as new exercise"
        onSave={saveAddAsNewExercise}
        onRequestClose={() => setAddAsNewTarget(null)}
        onSaved={handleAddAsNewSaved}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: uiSpace.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalCard: {
    maxHeight: '90%',
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  exercisePickerModalCard: {
    height: '80%',
  },
  exercisePickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  modalTitle: {
    fontSize: uiTypography.size.xxl,
    fontWeight: '700',
  },
  exercisePickerHeaderActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exercisePickerIconButton: {
    width: 34,
    height: 34,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  exercisePickerIconButtonText: {
    fontSize: uiTypography.size.xl,
    lineHeight: 18,
    fontWeight: '700',
    color: uiColors.textMuted,
  },
  exercisePickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  exercisePickerSearchInput: {
    flex: 1,
  },
  exercisePickerOptionsPanel: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  modalList: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  emptyText: {
    fontSize: uiTypography.size.base,
    color: uiColors.textMuted,
  },
  exercisePickerPreselectionPanel: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfacePage,
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  exercisePickerPreselectionTitle: {
    fontSize: uiTypography.size.lg,
    lineHeight: 20,
    fontWeight: '800',
    color: uiColors.textPrimary,
  },
  exercisePickerPreselectionActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
  },
  secondaryActionButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
  },
  secondaryActionButtonText: {
    color: uiColors.textMuted,
    fontWeight: '600',
  },
  primaryActionButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  primaryActionButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  exercisePickerAppendPlanButtonDisabled: {
    backgroundColor: uiColors.actionPrimaryDisabled,
  },
  exercisePickerPlanPreview: {
    gap: uiSpace.sm,
  },
  exercisePickerPlanPreviewSource: {
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  exercisePickerPlanSetList: {
    maxHeight: 238,
  },
  exercisePickerPlanSetListContent: {
    gap: uiSpace.sm,
  },
  exercisePickerPlanSetRow: {
    minHeight: 34,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exercisePickerPlanSetIndex: {
    width: 48,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  exercisePickerPlanSetValue: {
    flex: 1,
    minWidth: 0,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  exercisePickerPlanSetQuality: {
    width: 48,
    fontSize: uiTypography.size.sm,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textAlign: 'right',
  },
  exercisePickerPreselectionDismissArea: {
    minHeight: 120,
  },
});
