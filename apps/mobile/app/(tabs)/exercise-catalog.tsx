import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { ChipGroup } from '@/components/ui/chip-group';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
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
  buildExerciseListModel,
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

  const statsResult = useExerciseCatalogStats('all');
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
        includeDeleted: showDeleted,
      }),
    [
      exercises,
      muscleGroups,
      stats,
      listPreferences,
      debouncedExerciseSearchValue,
      showDeleted,
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
        <MoreHubBackButton />
        <View testID="exercise-catalog-title">
          <PageHeader title="Exercises" />
        </View>
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
          <IconButton
            accessibilityLabel="Create new exercise"
            name="plus"
            onPress={startNewExercise}
            testID="create-new-exercise-button"
            tone="accent"
          />
          <IconButton
            accessibilityLabel="Exercise catalog options"
            name="more-vertical"
            onPress={openFilters}
            testID="exercise-catalog-options-button"
          />
        </View>
        <ExerciseListPreferenceControls preferences={listPreferences} onChangePreferences={setListPreferences} />
        {saveFeedback ? <Notice icon="success" live message={saveFeedback} testID="exercise-catalog-feedback" /> : null}
        {saveError ? <Notice live message={saveError} testID="exercise-catalog-error" tone="danger" /> : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <ExerciseListContent
          isSearching={exerciseListModel.isSearching}
          historyStatus={statsResult.status}
          onRetryHistory={reloadStats}
          items={exerciseListModel.items}
          sections={exerciseListModel.sections}
          expandedFamilies={expandedExerciseFamilies}
          emptyText={emptyListText}
          onToggleFamily={toggleExerciseFamily}
          onPressExercise={handlePressEditRow}
          getExerciseAccessibilityLabel={(exercise) => `Edit exercise definition ${exercise.name}`}
          renderActions={renderExerciseActions}
        />
      </ScrollView>

      <ExerciseEditorModal
        visible={isEditorModalVisible}
        editingExercise={editorExerciseTarget}
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

      {/* A row's actions. Delete does not confirm (T07-D4): it is a soft delete,
          undone from this same sheet with Undelete once Show deleted is on. */}
      <Sheet
        dismissLabel="Dismiss exercise action menu overlay"
        onDismiss={() => setExerciseActionMenuTarget(null)}
        testID="exercise-catalog-actions-sheet"
        title={actionTarget?.name}
        visible={actionTarget !== null}>
        <ListRow
          accessibilityLabel="Edit exercise from actions"
          disabled={isActionTargetDeleted}
          label="Edit"
          leading={<Icon color={isActionTargetDeleted ? uiRoles.disabled : uiRoles.ink} name="pencil" size="md" />}
          onPress={() => {
            setExerciseActionMenuTarget(null);
            if (actionTarget && !actionTarget.deletedAt) {
              openEditorForExercise(actionTarget);
            }
          }}
          testID="exercise-action-edit"
        />
        {groupLinkingUserId ? (
          <ListRow
            accessibilityLabel="Link to group exercise from actions"
            // A soft-deleted exercise is never linked from the UI (M25-T07 (b)).
            disabled={isActionTargetDeleted}
            label="Link to group exercise…"
            leading={<Icon color={isActionTargetDeleted ? uiRoles.disabled : uiRoles.ink} name="link" size="md" />}
            onPress={() => {
              setExerciseActionMenuTarget(null);
              if (actionTarget && !actionTarget.deletedAt) {
                router.push(exerciseLinkHref(actionTarget.id));
              }
            }}
            testID="exercise-action-link-group"
          />
        ) : null}
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
