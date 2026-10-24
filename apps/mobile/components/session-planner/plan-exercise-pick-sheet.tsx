import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseListContent, useFamilyExpansion } from '@/components/exercise-catalog/exercise-list-controls';
import { PickerPreselectionCard } from '@/components/session-recorder/picker-preselection-card';
import type { ExercisePickerPreselectionState } from '@/components/session-recorder/types';
import { SearchField, Sheet, uiSpace } from '@/components/ui';
import { loadSuggestedExercisePlan, type ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import type { ExerciseListItem } from '@/src/exercise-catalog/list-model';
import { buildExerciseListModel } from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

export type PlanExercisePick = {
  id: string;
  name: string;
  loadInputMode: 'total_load' | 'per_side_load';
};

export type PlanExercisePickResult = {
  exercise: PlanExercisePick;
  suggestion: ExerciseBlockHistorySuggestedPlan | null;
};

export type PlanExercisePickSheetProps = {
  /** Open when a block awaits its exercise or when adding a new block; null closes the sheet. */
  request: { blockId: string | null } | null;
  onPick: (blockId: string | null, result: PlanExercisePickResult) => void;
  onDismiss: () => void;
  /** The plan's gym: on a split exercise, repeating prefers that gym's newest session ([[gym.split]]). */
  gymId?: string | null;
};

/**
 * The plan form's exercise picker: the catalogue list the session picker
 * shares, in a sheet. A pick allows adding an empty set or repeating sets
 * from the last execution, and carries the exercise's load input mode.
 */
export function PlanExercisePickSheet({ request, onPick, onDismiss, gymId = null }: PlanExercisePickSheetProps) {
  const catalog = useExerciseCatalog();
  const [search, setSearch] = useState('');
  const [preselection, setPreselection] = useState<ExercisePickerPreselectionState | null>(null);
  const preselectionRequestKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [preferences] = useExerciseListPreferences();
  const history = useExerciseCatalogStats('all');
  const { reload: reloadHistory } = history;
  const familyExpansion = useFamilyExpansion(search.trim().length > 0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (request) {
      reloadHistory();
    }
  }, [request, reloadHistory]);

  const clearPreselection = () => {
    setPreselection(null);
    preselectionRequestKeyRef.current = null;
  };

  const handleDismiss = () => {
    clearPreselection();
    setSearch('');
    onDismiss();
  };

  const isLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const loadError =
    catalog.status === 'error' ? catalog.lastError ?? 'Unable to load exercises right now.' : null;
  const options = useMemo(
    () => catalog.exercises.filter((exercise) => !exercise.deletedAt),
    [catalog.exercises],
  );
  const listModel = useMemo(
    () =>
      buildExerciseListModel({
        exercises: options,
        muscleGroups: catalog.muscleGroups,
        muscleSetup: catalog.muscleSetup,
        stats: history.stats,
        preferences,
        query: search,
        includeDeleted: false,
      }),
    [options, catalog.muscleGroups, catalog.muscleSetup, history.stats, preferences, search],
  );

  const selectListItem = (exercise: ExerciseListItem) => {
    Keyboard.dismiss();
    const requestKey = `${exercise.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    preselectionRequestKeyRef.current = requestKey;
    setPreselection({ exercise, status: 'loading', suggestion: null });

    void loadSuggestedExercisePlan({ exerciseDefinitionId: exercise.id, gymId })
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

  const confirmPick = (suggestion: ExerciseBlockHistorySuggestedPlan | null) => {
    if (!preselection || !request) return;
    const exercise = preselection.exercise;
    clearPreselection();
    setSearch('');
    onDismiss();
    onPick(request.blockId, {
      exercise: {
        id: exercise.id,
        name: exercise.name,
        loadInputMode: exercise.loadInputMode ?? 'total_load',
      },
      suggestion,
    });
  };

  if (!request) {
    return null;
  }

  const repeatDisabled =
    !preselection || preselection.status !== 'ready' || !preselection.suggestion || preselection.suggestion.sets.length === 0;

  return (
    <Sheet
      dismissLabel="Dismiss exercise picker"
      keyboardAvoiding
      onDismiss={handleDismiss}
      testID="plan-exercise-pick-sheet"
      title="Choose exercise"
      visible>
      <View style={styles.search}>
        <SearchField
          accessibilityLabel="Exercise filter input"
          autoCapitalize="none"
          onChangeText={(text) => {
            clearPreselection();
            setSearch(text);
          }}
          placeholder="Search exercises or muscles"
          testID="plan-exercise-pick-search"
          value={search}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {preselection ? (
          <>
            <PickerPreselectionCard
              onAddEmptySet={() => confirmPick(null)}
              onRepeat={() => confirmPick(preselection.suggestion)}
              repeatDisabled={repeatDisabled}
              state={preselection}
            />
            <Pressable
              accessibilityLabel="Dismiss exercise preselection"
              onPress={clearPreselection}
              style={styles.preselectionDismissArea}
              testID="plan-exercise-picker-preselection-dismiss-area"
            />
          </>
        ) : (
          <ExerciseListContent
            emptyText={isLoading ? 'Loading exercises...' : loadError ?? 'No exercises match that filter.'}
            familyExpansion={familyExpansion}
            historyStatus={history.status}
            onRetryHistory={reloadHistory}
            items={isLoading || loadError ? [] : listModel.items}
            onPressExercise={selectListItem}
            sections={isLoading || loadError ? [] : listModel.sections}
          />
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  list: {
    flexShrink: 1,
  },
  preselectionDismissArea: {
    minHeight: 120,
  },
});

