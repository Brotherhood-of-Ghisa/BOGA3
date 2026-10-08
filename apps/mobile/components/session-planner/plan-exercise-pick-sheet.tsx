import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseListContent, useFamilyExpansion } from '@/components/exercise-catalog/exercise-list-controls';
import { SearchField, Sheet, uiSpace } from '@/components/ui';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { buildExerciseListModel } from '@/src/exercise-catalog/list-model';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import type { ExerciseCatalogStats } from '@/src/data/exercise-catalog-stats';

export type PlanExercisePick = {
  id: string;
  name: string;
  loadInputMode: 'total_load' | 'per_side_load';
};

export type PlanExercisePickSheetProps = {
  /** Open when a block awaits its exercise; null closes the sheet. */
  request: { blockId: string } | null;
  onPick: (blockId: string, pick: PlanExercisePick) => void;
  onDismiss: () => void;
};

// The pick sheet shows the catalogue without lifetime figures: no stats read.
const NO_STATS: ExerciseCatalogStats = {
  aggregatesById: new Map(),
  recencyScoresById: new Map(),
  everDoneIds: new Set(),
  lastCompletedAtById: new Map(),
};

/**
 * The plan form's exercise picker for one block: the catalogue list the
 * session picker shares, in a sheet. A pick names the block and carries the
 * exercise's load input mode, so the block's target weight field reads
 * `per side · kg` when the exercise is loaded that way.
 */
export function PlanExercisePickSheet({ request, onPick, onDismiss }: PlanExercisePickSheetProps) {
  const catalog = useExerciseCatalog();
  const [search, setSearch] = useState('');
  const [preferences] = useExerciseListPreferences();
  const familyExpansion = useFamilyExpansion(search.trim().length > 0);

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
        stats: NO_STATS,
        preferences,
        query: search,
        includeDeleted: false,
      }),
    [options, catalog.muscleGroups, preferences, search],
  );

  if (!request) {
    return null;
  }

  return (
    <Sheet
      dismissLabel="Dismiss exercise picker"
      keyboardAvoiding
      onDismiss={onDismiss}
      testID="plan-exercise-pick-sheet"
      title="Choose exercise"
      visible>
      <View style={styles.search}>
        <SearchField
          accessibilityLabel="Exercise filter input"
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search exercises or muscles"
          testID="plan-exercise-pick-search"
          value={search}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        <ExerciseListContent
          emptyText={isLoading ? 'Loading exercises...' : loadError ?? 'No exercises match that filter.'}
          familyExpansion={familyExpansion}
          historyStatus="ready"
          items={isLoading || loadError ? [] : listModel.items}
          onPressExercise={(exercise) => {
            onDismiss();
            onPick(request.blockId, {
              id: exercise.id,
              name: exercise.name,
              loadInputMode: exercise.loadInputMode ?? 'total_load',
            });
          }}
          sections={isLoading || loadError ? [] : listModel.sections}
        />
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
});
