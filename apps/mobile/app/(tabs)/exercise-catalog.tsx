import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Keyboard, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ExerciseMerge } from '@/components/exercise-catalog/exercise-merge';
import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
  useFamilyExpansion,
} from '@/components/exercise-catalog/exercise-list-controls';
import { GymPicker } from '@/components/gyms/gym-picker';
import { ActionButton } from '@/components/ui/action-button';
import { ChipGroup } from '@/components/ui/chip-group';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { TitleBar } from '@/components/ui/page-header';
import { Screen } from '@/components/ui/screen';
import { SearchField } from '@/components/ui/search-field';
import { Sheet } from '@/components/ui/sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  deleteExerciseCatalogExercise,
  undeleteExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  buildDuplicateExercisePrefill,
  type ExerciseEditorPrefill,
} from '@/src/exercise-catalog/editor-model';
import {
  buildExerciseListModel,
  type ExerciseListItem,
} from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
import {
  buildExerciseShareLink,
  buildExerciseShareMessage,
  type ExerciseSharePayload,
} from '@/src/exercise-share';
import { listMyGroups, type GroupSummary } from '@/src/groups';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseHistoryHref, exerciseLinkHref } from '@/src/navigation/routes';

const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
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
  const isFromSession = routeSource === 'session';

  const [isEditorModalVisible, setIsEditorModalVisible] = useState(false);
  const [isCatalogOptionsMenuVisible, setIsCatalogOptionsMenuVisible] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [didHandleInitialIntent, setDidHandleInitialIntent] = useState(false);
  const [exerciseActionMenuTarget, setExerciseActionMenuTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [queuedMerge, setQueuedMerge] = useState<ExerciseCatalogExercise | null>(null);
  const [mergeSource, setMergeSource] = useState<ExerciseCatalogExercise | null>(null);
  const [editorExerciseTarget, setEditorExerciseTarget] = useState<ExerciseCatalogExercise | null>(null);
  const [editorPrefill, setEditorPrefill] = useState<ExerciseEditorPrefill | null>(null);
  const [editorModalTitle, setEditorModalTitle] = useState<string | undefined>(undefined);
  const [exerciseSearchValue, setExerciseSearchValue] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  const [shareTarget, setShareTarget] = useState<{ exercise: ExerciseCatalogExercise; groups: GroupSummary[] } | null>(null);
  // Signed in only: linking needs my groups' exercises.
  const groupLinkingUserId = useGroupLinkingUserId();

  const triggerShare = useCallback(async (group: GroupSummary, exercise: ExerciseCatalogExercise) => {
    const payload: ExerciseSharePayload = {
      v: 1,
      name: exercise.name,
      loadInputMode: exercise.loadInputMode ?? 'total_load',
      bodyweightContribution: exercise.bodyweightContribution,
      mappings: exercise.mappings.map((mapping) => ({
        muscleGroupId: mapping.muscleGroupId,
        weight: mapping.weight,
        role: mapping.role,
      })),
    };
    const link = buildExerciseShareLink(group.group_id, payload);
    const message = buildExerciseShareMessage(group.name, exercise.name, link);
    try {
      await Share.share({ message });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't open share sheet.");
    }
  }, []);

  const handleShareExercise = useCallback(async (exercise: ExerciseCatalogExercise) => {
    setExerciseActionMenuTarget(null);
    try {
      const mine = await listMyGroups();
      if (mine.groups.length === 0) {
        Alert.alert('No groups found', 'You must be a member of a group to share an exercise with a member.');
        return;
      }
      if (mine.groups.length === 1) {
        await triggerShare(mine.groups[0], exercise);
        return;
      }
      setShareTarget({ exercise, groups: mine.groups });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't load groups for sharing.");
    }
  }, [triggerShare]);

  const catalog = useExerciseCatalog();
  const isLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const loadError = catalog.status === 'error' ? catalog.lastError ?? 'Unable to load exercise catalog. Try again.' : null;
  const exercises = catalog.exercises;
  const muscleGroups = catalog.muscleGroups;
  const muscleSetup = catalog.muscleSetup;

  // The row stats' gym ([[gym.view-filter]]).
  const [gymId, setGymId] = useState<string | null | undefined>(undefined);
  const statsResult = useExerciseCatalogStats('all', gymId);
  const { stats, gymOptions, reload: reloadStats } = statsResult;

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
        muscleSetup,
        stats,
        preferences: listPreferences,
        query: debouncedExerciseSearchValue,
        includeDeleted: showDeleted,
      }),
    [
      exercises,
      muscleGroups,
      muscleSetup,
      stats,
      listPreferences,
      debouncedExerciseSearchValue,
      showDeleted,
    ]
  );
  const familyExpansion = useFamilyExpansion(exerciseListModel.isSearching);

  const openEditorForExercise = useCallback((exercise: ExerciseCatalogExercise) => {
    setEditorExerciseTarget(exercise);
    setEditorPrefill(null);
    setEditorModalTitle(undefined);
    setSaveFeedback(null);
    setIsEditorModalVisible(true);
  }, []);

  const duplicateExercise = useCallback((exercise: ExerciseCatalogExercise) => {
    setEditorExerciseTarget(null);
    setEditorPrefill(buildDuplicateExercisePrefill(exercise));
    setEditorModalTitle('Duplicate Exercise');
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

  // A sheet never opens under the filter's keyboard.
  const handlePressRowActions = useCallback((exercise: ExerciseCatalogExercise) => {
    Keyboard.dismiss();
    setExerciseActionMenuTarget(exercise);
  }, []);

  const openFilters = useCallback(() => {
    Keyboard.dismiss();
    setIsCatalogOptionsMenuVisible(true);
  }, []);

  const renderExerciseActions = useCallback(
    (exercise: ExerciseListItem) => (
      <IconButton
        accessibilityLabel={`Exercise actions ${exercise.name}`}
        name="more-vertical"
        onPress={() => handlePressRowActions(exercise)}
        size="sm"
        tone="muted"
      />
    ),
    [handlePressRowActions]
  );

  const startNewExercise = () => {
    setEditorExerciseTarget(null);
    setEditorPrefill(null);
    setEditorModalTitle(undefined);
    setSaveFeedback(null);
    setIsEditorModalVisible(true);
  };

  // The route's intent is handled once, in the first render after the catalog loads.
  if (!didHandleInitialIntent && !isLoading && !loadError) {
    if (routeIntent === 'add') {
      setEditorExerciseTarget(null);
      setEditorPrefill(null);
      setEditorModalTitle(undefined);
      setSaveFeedback(null);
      setIsEditorModalVisible(true);
    }

    setDidHandleInitialIntent(true);
  }

  const closeEditorModal = () => {
    setIsEditorModalVisible(false);
    setEditorExerciseTarget(null);
    setEditorPrefill(null);
    setEditorModalTitle(undefined);
    setExerciseActionMenuTarget(null);
  };

  const handleEditorSaved = () => {
    const wasEditing = editorExerciseTarget !== null;
    setSaveFeedback(wasEditing ? 'Exercise updated.' : 'Exercise created.');
    setIsEditorModalVisible(false);
    setEditorExerciseTarget(null);
    setEditorPrefill(null);
    setEditorModalTitle(undefined);
    setExerciseActionMenuTarget(null);

    if (isFromSession) {
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

  const toggleShowDeleted = () => {
    setShowDeleted((current) => !current);
    setSaveError(null);
    setSaveFeedback(null);
  };

  const emptyListText =
    exercises.length === 0
      ? 'No active exercises yet. Create one with the button above.'
      : 'No exercises match the current filters.';
  const actionTarget = exerciseActionMenuTarget;
  const isActionTargetDeleted = Boolean(actionTarget?.deletedAt);

  if (isLoading) {
    return (
      <Screen testID="exercise-catalog-screen">
        <StatePanel body="Loading exercise catalog…" kind="loading" />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen testID="exercise-catalog-screen">
        <StatePanel body={loadError} kind="error" />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen} testID="exercise-catalog-screen">
      <View style={styles.pinnedTopRegion}>
        <TitleBar
          actions={
            <IconButton
              accessibilityLabel="Exercise catalog options"
              name="more-vertical"
              onPress={openFilters}
              testID="exercise-catalog-options-button"
            />
          }
          back={<MoreHubBackButton />}
          testID="exercise-catalog-title"
          title="Exercises"
        />
        <View style={styles.topActionRow}>
          <View style={styles.search}>
            <SearchField
              accessibilityLabel="Exercise filter input"
              autoCapitalize="none"
              onChangeText={setExerciseSearchValue}
              placeholder="Search exercises or muscles"
              value={exerciseSearchValue}
            />
          </View>
          <ActionButton
            accessibilityLabel="Create new exercise"
            label="Add"
            onPress={startNewExercise}
            testID="create-new-exercise-button"
            variant="primary"
          />
        </View>
        <ExerciseListPreferenceControls preferences={listPreferences} onChangePreferences={setListPreferences}>
          <GymPicker onChange={setGymId} options={gymOptions} testID="exercise-catalog-gym" value={gymId} />
        </ExerciseListPreferenceControls>
        {saveFeedback ? <Notice icon="success" live message={saveFeedback} testID="exercise-catalog-feedback" /> : null}
        {mergeSource ? <ExerciseMerge key={mergeSource.id} source={mergeSource} onDismiss={() => setMergeSource(null)} /> : null}
        {saveError ? <Notice live message={saveError} testID="exercise-catalog-error" tone="danger" /> : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled">
        <ExerciseListContent
          historyStatus={statsResult.status}
          onRetryHistory={reloadStats}
          items={exerciseListModel.items}
          sections={exerciseListModel.sections}
          familyExpansion={familyExpansion}
          emptyText={emptyListText}
          onPressExercise={handlePressEditRow}
          getExerciseAccessibilityLabel={(exercise) => `Edit exercise definition ${exercise.name}`}
          renderActions={renderExerciseActions}
        />
      </ScrollView>

      <ExerciseEditorModal
        visible={isEditorModalVisible}
        editingExercise={editorExerciseTarget}
        prefill={editorPrefill}
        title={editorModalTitle}
        onRequestClose={closeEditorModal}
        onSaved={handleEditorSaved}
      />

      <Sheet
        dismissLabel="Close exercise management"
        onDismiss={() => setIsCatalogOptionsMenuVisible(false)}
        testID="exercise-catalog-management-sheet"
        title="Manage exercises"
        visible={isCatalogOptionsMenuVisible}>
        <View style={styles.management}>
          <ChipGroup
            mode="multi"
            onToggle={toggleShowDeleted}
            options={[{ value: 'deleted', label: 'Show deleted', accessibilityLabel: showDeleted ? 'Hide deleted exercises' : 'Show deleted exercises' }]}
            testIDPrefix="exercise-catalog-filter-visibility"
            values={showDeleted ? ['deleted'] : []}
          />
        </View>
      </Sheet>

      {/* A row's actions. Delete does not confirm: it is a soft delete,
          undone from this same sheet with Undelete once Show deleted is on. */}
      <Sheet
        dismissLabel="Dismiss exercise action menu overlay"
        onDismiss={() => setExerciseActionMenuTarget(null)}
        onDismissed={() => { if (queuedMerge) { setMergeSource(queuedMerge); setQueuedMerge(null); } }}
        testID="exercise-catalog-actions-sheet"
        title={actionTarget?.name}
        visible={actionTarget !== null}>
        <ListRow
          accessibilityLabel="View exercise history from actions"
          label="History"
          leading={<Icon color={uiRoles.ink} name="list" size="md" />}
          onPress={() => {
            setExerciseActionMenuTarget(null);
            if (actionTarget) router.push(exerciseHistoryHref(actionTarget.id));
          }}
          testID="exercise-action-history"
        />
        <ListRow
          accessibilityLabel="Edit exercise from actions"
          disabled={isActionTargetDeleted}
          label="Edit"
          leading={<Icon color={isActionTargetDeleted ? uiRoles.inkGhost : uiRoles.ink} name="pencil" size="md" />}
          onPress={() => {
            setExerciseActionMenuTarget(null);
            if (actionTarget && !actionTarget.deletedAt) {
              openEditorForExercise(actionTarget);
            }
          }}
          testID="exercise-action-edit"
        />
        <ListRow
          accessibilityLabel="Duplicate exercise from actions"
          disabled={isActionTargetDeleted}
          label="Duplicate"
          leading={<Icon color={isActionTargetDeleted ? uiRoles.inkGhost : uiRoles.ink} name="copy" size="md" />}
          onPress={() => {
            setExerciseActionMenuTarget(null);
            if (actionTarget && !actionTarget.deletedAt) {
              duplicateExercise(actionTarget);
            }
          }}
          testID="exercise-action-duplicate"
        />
        {groupLinkingUserId ? (
          <ListRow
            accessibilityLabel="Link to group exercise from actions"
            // A soft-deleted exercise is never linked from the UI.
            disabled={isActionTargetDeleted}
            label="Link to group exercise…"
            leading={<Icon color={isActionTargetDeleted ? uiRoles.inkGhost : uiRoles.ink} name="link" size="md" />}
            onPress={() => {
              setExerciseActionMenuTarget(null);
              if (actionTarget && !actionTarget.deletedAt) {
                router.push(exerciseLinkHref(actionTarget.id));
              }
            }}
            testID="exercise-action-link-group"
          />
        ) : null}
        {groupLinkingUserId ? (
          <ListRow
            accessibilityLabel="Share exercise with group member from actions"
            disabled={isActionTargetDeleted}
            label="Share with group member…"
            leading={<Icon color={isActionTargetDeleted ? uiRoles.inkGhost : uiRoles.ink} name="share" size="md" />}
            onPress={() => {
              if (actionTarget && !actionTarget.deletedAt) {
                void handleShareExercise(actionTarget);
              }
            }}
            testID="exercise-action-share"
          />
        ) : null}
        <ListRow accessibilityLabel="Merge exercise from actions" label="Merge into…"
          leading={<Icon color={isActionTargetDeleted ? uiRoles.inkGhost : uiRoles.danger} name="swap" size="md" />}
          disabled={isActionTargetDeleted} tone="danger" testID="exercise-action-merge"
          onPress={() => {
            if (actionTarget && !actionTarget.deletedAt) {
              setSaveError(null); setSaveFeedback(null);
              setQueuedMerge(actionTarget); setExerciseActionMenuTarget(null);
            }
          }} />
        {isActionTargetDeleted ? (
          <ListRow
            accessibilityLabel="Undelete exercise from actions"
            label="Undelete"
            leading={<Icon color={uiRoles.ink} name="swap" size="md" />}
            onPress={() => {
              if (actionTarget) {
                void undeleteExercise(actionTarget);
              }
            }}
            testID="exercise-action-undelete"
          />
        ) : (
          <ListRow
            accessibilityLabel="Delete exercise from actions"
            label="Delete"
            leading={<Icon color={uiRoles.danger} name="trash" size="md" />}
            onPress={() => {
              setExerciseActionMenuTarget(null);
              if (actionTarget) {
                void deleteExercise(actionTarget);
              }
            }}
            testID="exercise-action-delete"
            tone="danger"
          />
        )}
      </Sheet>

      <Sheet
        dismissLabel="Close group selection"
        onDismiss={() => setShareTarget(null)}
        testID="exercise-share-group-sheet"
        title="Share with group"
        visible={shareTarget !== null}>
        <View style={styles.management}>
          {shareTarget?.groups.map((group) => (
            <ListRow
              accessibilityLabel={`Share exercise with ${group.name}`}
              key={group.group_id}
              label={group.name}
              onPress={() => {
                const target = shareTarget;
                setShareTarget(null);
                if (target) {
                  void triggerShare(group, target.exercise);
                }
              }}
              testID={`exercise-share-group-${group.group_id}`}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
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
    gap: uiSpace.md,
    flexShrink: 0,
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  search: {
    flex: 1,
    minWidth: 0,
    marginRight: uiSpace.xs,
  },
  management: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
});
