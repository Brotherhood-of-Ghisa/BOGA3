import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { ActionButton } from '@/components/ui/action-button';
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
import { Tag } from '@/components/ui/tag';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
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
  const isFromSession = routeSource === 'session';

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
              placeholder="Filter by exercise or muscle group"
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
        {activeFilterChips.length > 0 ? (
          <View style={styles.activeFilterChipsRow}>
            {activeFilterChips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityLabel={`Open filters (${chip.label})`}
                accessibilityRole="button"
                hitSlop={uiSpace.xs}
                onPress={openFilters}>
                <Tag label={chip.label} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {saveFeedback ? <Notice icon="success" live message={saveFeedback} testID="exercise-catalog-feedback" /> : null}
        {saveError ? <Notice live message={saveError} testID="exercise-catalog-error" tone="danger" /> : null}
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
          emptyText={emptyListText}
          onToggleFamily={toggleExerciseFamily}
          onPressExercise={handlePressEditRow}
          getExerciseAccessibilityLabel={(exercise) => `Edit exercise definition ${exercise.name}`}
          renderActions={renderExerciseActions}
        />
        {/* Grouped, the shared list draws only the family cards (all empty), so
            the catalogue says why beneath them, as the flat list does. */}
        {exerciseListModel.items.length === 0 && exerciseListModel.mode === 'grouped' ? (
          <StatePanel body={emptyListText} fill={false} />
        ) : null}
      </ScrollView>

      <ExerciseEditorModal
        visible={isEditorModalVisible}
        editingExercise={editorExerciseTarget}
        onRequestClose={closeEditorModal}
        onSaved={handleEditorSaved}
      />

      <Sheet
        dismissLabel="Close filters"
        onDismiss={() => setIsCatalogOptionsMenuVisible(false)}
        testID="exercise-catalog-filters-sheet"
        title="Filters"
        visible={isCatalogOptionsMenuVisible}>
        <ScrollView
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersScrollContent}
          keyboardShouldPersistTaps="handled">
          <ExerciseListPreferenceControls
            preferences={listPreferences}
            onChangePreferences={setListPreferences}
          />

          <View style={styles.filtersGroup}>
            <View style={styles.filtersSectionHeaderRow}>
              <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
                Muscle groups
              </Text>
              {filters.muscleGroupIds.size > 0 ? (
                <View style={styles.clearAction}>
                  <ActionButton
                    accessibilityLabel="Clear muscle group selection"
                    label="Clear"
                    onPress={clearFilterMuscleGroups}
                    variant="text"
                  />
                </View>
              ) : null}
            </View>
            {muscleGroups.length === 0 ? (
              <Text allowFontScaling={false} style={styles.helperText}>No muscle groups defined.</Text>
            ) : (
              <ChipGroup
                mode="multi"
                onToggle={toggleFilterMuscleGroup}
                options={muscleGroups.map((group) => ({
                  value: group.id,
                  label: group.displayName,
                  accessibilityLabel: `Toggle muscle group ${group.displayName}`,
                }))}
                testIDPrefix="exercise-catalog-filter-muscle"
                values={[...filters.muscleGroupIds]}
              />
            )}
          </View>

          <View style={styles.filtersGroup}>
            <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
              Visibility
            </Text>
            <ChipGroup
              mode="multi"
              onToggle={(option) => (option === 'deleted' ? toggleFilterShowDeleted() : toggleFilterShowNeverDone())}
              options={[
                {
                  value: 'deleted',
                  label: 'Show deleted',
                  accessibilityLabel: filters.showDeleted ? 'Hide deleted exercises' : 'Show deleted exercises',
                },
                {
                  value: 'never-done',
                  label: 'Show never-done',
                  accessibilityLabel: filters.showNeverDone ? 'Hide exercises never done' : 'Show exercises never done',
                },
              ]}
              testIDPrefix="exercise-catalog-filter-visibility"
              values={[
                ...(filters.showDeleted ? (['deleted'] as const) : []),
                ...(filters.showNeverDone ? (['never-done'] as const) : []),
              ]}
            />
          </View>
        </ScrollView>
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
  activeFilterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  helperText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // Sized to its content; shrinks and scrolls when the sheet reaches the top.
  filtersScroll: {
    flexShrink: 1,
  },
  filtersScrollContent: {
    gap: uiSpace.lg,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  filtersGroup: {
    gap: uiSpace.sm,
  },
  filtersSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The text `Clear` keeps its 44pt target without making the label's row
  // taller than the label, so the row does not jump when it appears.
  clearAction: {
    marginVertical: -uiSpace.lg,
  },
});
