import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ExerciseEditorModal, type ExerciseEditorSaveInput } from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { GroupExercisePickSheet, type GroupExercisePickTarget } from '@/components/groups/group-exercise-pick-sheet';
import { pickInlineError } from '@/components/groups/group-state-view';
import { PickerGroupSectionList, PickerGroupsToggle } from '@/components/groups/picker-group-section';
import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { Sheet } from '@/components/ui/sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { loadSuggestedExercisePlan, type ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { type ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
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
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

// The picker is a tall sheet, so opening the options or a preselection does not
// resize it; with the keyboard up it shrinks to what is left.
const PICKER_SHARE_OF_SCREEN = 0.8;


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
 * The session view's exercise picker, a tall `Sheet`: a filtered
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
  const { height } = useWindowDimensions();
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


  const appendDisabled = !preselection || preselection.status !== 'ready' || !preselection.suggestion;
  const noExercisesText = exerciseOptions.length === 0 ? 'No active exercises available.' : 'No exercises match that filter.';

  return (
    <>
      <Sheet
        dismissLabel="Dismiss exercise modal overlay"
        headerActions={
          <>
            <IconButton
              accessibilityLabel="Exercise picker options"
              name="more-vertical"
              onPress={() => {
                clearPreselection();
                setIsOptionsVisible((current) => !current);
              }}
              testID="exercise-picker-options-button"
            />
            <IconButton
              accessibilityLabel="Open exercise catalog manage flow"
              name="list"
              onPress={openManage}
              testID="exercise-picker-manage-button"
            />
            <IconButton
              accessibilityLabel="Open inline exercise create"
              name="plus"
              onPress={openInlineCreate}
              testID="exercise-picker-create-button"
            />
          </>
        }
        keyboardAvoiding
        onDismiss={dismiss}
        testID="exercise-picker"
        title="Select Exercise"
        visible={visible && !isChildOpen}>
        <View style={[styles.body, { height: height * PICKER_SHARE_OF_SCREEN }]}>
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <SearchField
                accessibilityLabel="Exercise filter input"
                autoCapitalize="none"
                onChangeText={updateSearchValue}
                placeholder="Filter by exercise or muscle group"
                testID="exercise-picker-search"
                value={searchValue}
              />
            </View>
            {groupLinkingUserId ? <PickerGroupsToggle active={groupsOnly} onToggle={toggleGroupsOnly} /> : null}
          </View>
          {isOptionsVisible ? (
            <View style={styles.optionsPanel} testID="exercise-picker-options-panel">
              <ExerciseListPreferenceControls preferences={listPreferences} onChangePreferences={setListPreferences} />
            </View>
          ) : null}
          {/*
            The filter input above keeps focus while the user picks a result.
            With the ScrollView's default `keyboardShouldPersistTaps="never"`,
            the first tap on a result row is consumed to dismiss the keyboard
            instead of firing the row's `onPress`, so the exercise is never
            selected and the sheet stays open. `"handled"` lets the tap reach
            the row Pressables while still dismissing the keyboard on taps that
            hit empty list space.
          */}
          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            testID="exercise-picker-list">
            {isCatalogLoading ? <StatePanel body="Loading exercises..." fill={false} kind="loading" /> : null}
            {!isCatalogLoading && catalogLoadError ? (
              <StatePanel body={catalogLoadError} fill={false} kind="error" testID="exercise-picker-error" />
            ) : null}
            {!isCatalogLoading && !catalogLoadError && preselection ? (
              <>
                <Card testID="exercise-picker-preselection-panel">
                  <Text allowFontScaling={false} style={styles.preselectionTitle}>{preselection.exercise.name}</Text>
                  {preselection.suggestion ? (
                    <View style={styles.plan}>
                      <Text allowFontScaling={false} style={styles.planSource} testID="exercise-picker-plan-source">
                        From {formatCurrentDateTime(preselection.suggestion.completedAt)}
                      </Text>
                      <ScrollView
                        contentContainerStyle={styles.planRows}
                        nestedScrollEnabled
                        style={styles.planRowList}>
                        {preselection.suggestion.sets.map((set, index) => (
                          <SetSummaryRow
                            key={set.setId}
                            row={formatSetRow({
                              id: set.setId,
                              weight: parseSetWeight(set.weightValue),
                              reps: parseSetReps(set.repsValue),
                              setType: set.setType,
                              done: false,
                            })}
                            testID={`exercise-picker-plan-set-row-${index + 1}`}
                          />
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                  {/* The sheet's one `accent`: Append plan. */}
                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <ActionButton
                        accessibilityLabel={`Add empty set for ${preselection.exercise.name}`}
                        label="Add empty set"
                        onPress={() => selectExercise(preselection.exercise.id, preselection.exercise.name)}
                        testID="exercise-picker-add-empty-set-button"
                        variant="outline"
                      />
                    </View>
                    <View style={styles.action}>
                      <ActionButton
                        accessibilityLabel={`Append historical plan for ${preselection.exercise.name}`}
                        disabled={appendDisabled}
                        label="Append plan"
                        onPress={() => appendPlan(preselection)}
                        testID="exercise-picker-append-plan-button"
                        variant="primary"
                      />
                    </View>
                  </View>
                </Card>
                <Pressable
                  accessibilityLabel="Dismiss exercise preselection"
                  style={styles.preselectionDismissArea}
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
                  <StatePanel body={groupEmptyText} fill={false} testID="exercise-picker-group-empty" />
                )
              ) : (
                <>
                  <ExerciseListContent
                    mode={listModel.mode}
                    items={listModel.items}
                    sections={listModel.sections}
                    expandedFamilies={expandedFamilies}
                    emptyText={noExercisesText}
                    onToggleFamily={toggleFamily}
                    onPressExercise={selectListItem}
                  />
                  {listModel.items.length === 0 && listModel.mode === 'grouped' ? (
                    <StatePanel body={noExercisesText} fill={false} />
                  ) : null}
                  {/* After my own matches (E0.1); empty without search text. */}
                  <PickerGroupSectionList sections={groupSections} onPressRow={selectGroupRow} />
                </>
              )
            ) : null}
          </ScrollView>
        </View>
      </Sheet>

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
  // A tall body that shrinks with the sheet when the keyboard is up.
  body: {
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  search: {
    flex: 1,
  },
  optionsPanel: {
    marginBottom: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
    backgroundColor: uiRoles.surfaceSubtle,
    borderTopWidth: uiBorder.width,
    borderBottomWidth: uiBorder.width,
    borderColor: uiRoles.ruleSoft,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  preselectionTitle: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  plan: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  planSource: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // Long plans scroll inside the card; the actions stay in view.
  planRowList: {
    maxHeight: 238,
  },
  planRows: {
    gap: uiSpace.xs,
  },
  // The card's action strip.
  actions: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    padding: uiSpace.md,
    backgroundColor: uiRoles.surfaceSubtle,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  action: {
    flex: 1,
  },
  preselectionDismissArea: {
    minHeight: 120,
  },
});
