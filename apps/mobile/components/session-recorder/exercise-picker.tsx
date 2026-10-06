import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExerciseEditorModal, type ExerciseEditorSaveInput } from '@/components/exercise-catalog/exercise-editor-modal';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
  useFamilyExpansion,
} from '@/components/exercise-catalog/exercise-list-controls';
import { GroupExercisePickSheet, type GroupExercisePickTarget } from '@/components/groups/group-exercise-pick-sheet';
import { pickInlineError } from '@/components/groups/group-state-view';
import { PickerGroupSectionList, PickerGroupsToggle } from '@/components/groups/picker-group-section';
import { PickerPlannerToggle, PlannerBlockSection } from '@/components/session-recorder/planner-block-section';
import { PickerPreselectionCard } from '@/components/session-recorder/picker-preselection-card';
import { IconButton } from '@/components/ui';
import { Notice } from '@/components/ui/notice';
import { SearchField } from '@/components/ui/search-field';
import { StatePanel } from '@/components/ui/state-panel';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { loadSuggestedExercisePlan, type ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { type ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { buildExerciseListModel, type ExerciseListItem } from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
import { buildAddAsNewPrefill, requireAddAsNewCompatibility } from '@/src/groups/add-as-new';
import {
  buildPickerGroupSections,
  groupExercisesLoaded,
  resolvePickerGroupSelection,
  type LinkableExercise,
  type PickerGroupRow,
  type PickerGroupSection,
} from '@/src/groups/link-view-model';
import { useGroupExerciseLinking, useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';

export type ExercisePickerPreselectionState = {
  exercise: ExerciseListItem;
  status: 'loading' | 'ready' | 'error';
  suggestion: ExerciseBlockHistorySuggestedPlan | null;
};

export type ExercisePickerProps = {
  onClose: () => void;
  onSelectExercise: (exerciseDefinitionId: string, exerciseName: string) => void;
  onAppendPlan: (
    exercise: { id: string; name: string },
    suggestion: ExerciseBlockHistorySuggestedPlan
  ) => void;
  // The host attaches the picked authored plan block to the active session.
  onAddPlanBlock: (planExerciseId: string) => void;
  // The host navigates to the catalogue; its back returns to the picker as left.
  onOpenManage: () => void;
  // The host's failed add, shown above the list.
  notice?: string | null;
};

function GroupsOnlyBody({
  sections,
  emptyText,
  onPressRow,
}: {
  sections: PickerGroupSection[];
  emptyText: string;
  onPressRow: (row: PickerGroupRow) => void;
}) {
  if (sections.length === 0) {
    return <StatePanel body={emptyText} fill={false} testID="exercise-picker-group-empty" />;
  }
  return <PickerGroupSectionList sections={sections} onPressRow={onPressRow} />;
}

/**
 * The session's exercise picker, the body of its own route
 * (`app/session/[sessionId]/add-exercise.tsx`, an iOS page sheet: swipe down
 * or Close to leave): a filtered catalogue list with the shared one-row
 * filters, the add preselection (Add empty set / Repeat last), the `From
 * planner` toggle with its authored one-off blocks, `From your groups` with
 * its pick sheet, inline create, and a Manage exit. A pick closes the
 * keyboard, and scrolling the list does too.
 */
export function ExercisePicker({
  onClose,
  onSelectExercise,
  onAppendPlan,
  onAddPlanBlock,
  onOpenManage,
  notice = null,
}: ExercisePickerProps) {
  const groupLinkingUserId = useGroupLinkingUserId();
  const groupLinking = useGroupExerciseLinking({ userId: groupLinkingUserId });
  const [searchValue, setSearchValue] = useState('');
  const [preselection, setPreselection] = useState<ExercisePickerPreselectionState | null>(null);
  const [groupsOnly, setGroupsOnly] = useState(false);
  const [plannerOnly, setPlannerOnly] = useState(false);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [groupPickTarget, setGroupPickTarget] = useState<GroupExercisePickTarget | null>(null);
  const [addAsNewTarget, setAddAsNewTarget] = useState<GroupExercisePickTarget | null>(null);
  const preselectionRequestKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  const exerciseCatalog = useExerciseCatalog();
  const insets = useSafeAreaInsets();
  const history = useExerciseCatalogStats('all');
  const { stats: exerciseCatalogStats, reload: reloadHistory } = history;
  useEffect(() => { reloadHistory(); }, [reloadHistory]);

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
      }),
    [exerciseOptions, exerciseCatalog.muscleGroups, exerciseCatalogStats, listPreferences, searchValue]
  );
  const familyExpansion = useFamilyExpansion(listModel.isSearching);
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

  const clearPreselection = () => {
    setPreselection(null);
    preselectionRequestKeyRef.current = null;
  };

  const selectExercise = (exerciseDefinitionId: string, exerciseName: string) => {
    clearPreselection();
    onSelectExercise(exerciseDefinitionId, exerciseName);
  };

  const updateSearchValue = (value: string) => {
    clearPreselection();
    setSearchValue(value);
  };

  // A pick ends the search: the keyboard closes and the field loses focus, so
  // the preselection's actions are in view.
  const selectListItem = (exercise: ExerciseListItem) => {
    Keyboard.dismiss();
    const requestKey = `${exercise.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    preselectionRequestKeyRef.current = requestKey;
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

  const openManage = () => {
    Keyboard.dismiss();
    clearPreselection();
    onOpenManage();
  };

  const openInlineCreate = () => {
    Keyboard.dismiss();
    clearPreselection();
    setIsCreateModalVisible(true);
  };

  const handleInlineCreated = (exercise: ExerciseCatalogExercise) => {
    setIsCreateModalVisible(false);
    selectExercise(exercise.id, exercise.name);
  };

  // ---- Group exercises in the picker (E0.1) and the pick sheet (E0.2).

  const toggleGroupsOnly = () => {
    clearPreselection();
    setGroupsOnly((current) => !current);
  };

  const togglePlannerOnly = () => {
    clearPreselection();
    setPlannerOnly((current) => !current);
  };

  const pickPlannerBlock = (planExerciseId: string) => {
    Keyboard.dismiss();
    clearPreselection();
    onAddPlanBlock(planExerciseId);
  };

  const selectGroupRow = (row: PickerGroupRow) => {
    Keyboard.dismiss();
    const selection = resolvePickerGroupSelection(row);
    if (selection.kind === 'add') {
      selectExercise(selection.exercise.id, selection.exercise.name);
      return;
    }
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
    requireAddAsNewCompatibility(input, target.groupExercise);
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

  const appendDisabled = !preselection || preselection.status !== 'ready' || !preselection.suggestion;
  const noExercisesText = exerciseOptions.length === 0 ? 'No active exercises available.' : 'No exercises match that filter.';

  return (
    <>
      <View style={[styles.screen, { paddingBottom: insets.bottom }]} testID="exercise-picker">
        {/* The page sheet's own grabber: swiping down closes it. */}
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        <View style={styles.header} testID="exercise-picker-header">
          <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title}>
            Select Exercise
          </Text>
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
          <IconButton
            accessibilityLabel="Close exercise picker"
            name="x"
            onPress={onClose}
            testID="exercise-picker-close"
          />
        </View>
        <View style={styles.controls}>
          <SearchField
            accessibilityLabel="Exercise filter input"
            autoCapitalize="none"
            onChangeText={updateSearchValue}
            placeholder="Search exercises or muscles"
            testID="exercise-picker-search"
            value={searchValue}
          />
          <ExerciseListPreferenceControls preferences={listPreferences} onChangePreferences={setListPreferences}>
            <PickerPlannerToggle active={plannerOnly} onToggle={togglePlannerOnly} />
            {groupLinkingUserId ? <PickerGroupsToggle active={groupsOnly} onToggle={toggleGroupsOnly} /> : null}
          </ExerciseListPreferenceControls>
          {notice ? <Notice live message={notice} testID="exercise-picker-notice" tone="danger" /> : null}
        </View>
        {/*
          The filter input keeps focus while the user picks a result. With the
          ScrollView's default `keyboardShouldPersistTaps="never"`, the first
          tap on a result row is consumed to dismiss the keyboard instead of
          firing the row's `onPress`. `"handled"` lets the tap reach the row,
          which closes the keyboard itself; a drag of the list closes it too.
        */}
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          testID="exercise-picker-list">
            {isCatalogLoading ? <StatePanel body="Loading exercises..." fill={false} kind="loading" /> : null}
            {!isCatalogLoading && catalogLoadError ? (
              <StatePanel body={catalogLoadError} fill={false} kind="error" testID="exercise-picker-error" />
            ) : null}
            {!isCatalogLoading && !catalogLoadError && preselection ? (
              <>
                <PickerPreselectionCard
                  onAddEmptySet={() => selectExercise(preselection.exercise.id, preselection.exercise.name)}
                  onRepeat={() => appendPlan(preselection)}
                  repeatDisabled={appendDisabled}
                  state={preselection}
                />
                <Pressable
                  accessibilityLabel="Dismiss exercise preselection"
                  style={styles.preselectionDismissArea}
                  testID="exercise-picker-preselection-dismiss-area"
                  onPress={clearPreselection}
                />
              </>
            ) : null}
            {!isCatalogLoading && !catalogLoadError && !preselection ? (
              plannerOnly ? (
                <PlannerBlockSection onPickBlock={pickPlannerBlock} />
              ) : groupsOnly ? (
                <GroupsOnlyBody
                  emptyText={groupEmptyText}
                  onPressRow={selectGroupRow}
                  sections={groupSections}
                />
              ) : (
                <>
                  <ExerciseListContent
                    historyStatus={history.status}
                    onRetryHistory={history.reload}
                    items={listModel.items}
                    sections={listModel.sections}
                    familyExpansion={familyExpansion}
                    emptyText={noExercisesText}
                    onPressExercise={selectListItem}
                  />
                  {/* After my own matches (E0.1); empty without search text. */}
                  <PickerGroupSectionList sections={groupSections} onPressRow={selectGroupRow} />
                </>
              )
            ) : null}
        </ScrollView>
      </View>

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
  screen: {
    flex: 1,
    backgroundColor: uiRoles.surface,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  handle: {
    width: uiGeometry.sheetHandle.width,
    height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.rule,
  },
  // As the Sheet's title row: the controls bring their own 44pt targets.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: uiSpace.lg,
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  title: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  controls: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  // Long plans scroll inside the card; the actions stay in view.
  // The card's action strip.
  preselectionDismissArea: {
    minHeight: 120,
  },
});
