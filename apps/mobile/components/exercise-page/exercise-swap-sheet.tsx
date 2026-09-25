import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ExerciseListContent } from '@/components/exercise-catalog/exercise-list-controls';
import { SearchField } from '@/components/ui/search-field';
import { Sheet } from '@/components/ui/sheet';
import { uiSpace } from '@/components/ui/tokens';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { buildExerciseListModel, type ExerciseListItem } from '@/src/exercise-catalog/list-model';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

import { pageText } from './text-styles';

type ExerciseSwapSheetProps = {
  visible: boolean;
  currentExerciseDefinitionId: string;
  onSelect: (exercise: ExerciseListItem) => void;
  onDismiss: () => void;
};

// The list may take most of the screen; the sheet's handle and title stay.
const LIST_SHARE_OF_SCREEN = 0.6;

/**
 * Swap exercise: the same exercise list the session's exercise picker and the catalog
 * render (`ExerciseListContent` over `buildExerciseListModel`, with the shared
 * list preferences), in a sheet. Picking one replaces the exercise and keeps
 * its sets.
 */
export function ExerciseSwapSheet({
  visible,
  currentExerciseDefinitionId,
  onSelect,
  onDismiss,
}: ExerciseSwapSheetProps) {
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set());
  const [preferences] = useExerciseListPreferences();
  const catalog = useExerciseCatalog();
  const { stats } = useExerciseCatalogStats(preferences.dateRange);

  const options = useMemo(
    () =>
      catalog.exercises.filter(
        (exercise) => !exercise.deletedAt && exercise.id !== currentExerciseDefinitionId
      ),
    [catalog.exercises, currentExerciseDefinitionId]
  );
  // Built only while the sheet is open: the page renders it hidden.
  const model = useMemo(
    () =>
      visible
        ? buildExerciseListModel({
            exercises: options,
            muscleGroups: catalog.muscleGroups,
            stats,
            preferences,
            query,
            includeDeleted: false,
            showNeverDone: true,
          })
        : null,
    [catalog.muscleGroups, options, preferences, query, stats, visible]
  );

  const dismiss = () => {
    setQuery('');
    onDismiss();
  };

  const loading = catalog.status === 'idle' || catalog.status === 'loading';

  return (
    <Sheet
      dismissLabel="Dismiss swap exercise"
      onDismiss={dismiss}
      testID="exercise-swap-sheet"
      title="Swap exercise"
      visible={visible}>
      <View style={styles.search}>
        <SearchField
          accessibilityLabel="Search exercises"
          onChangeText={setQuery}
          placeholder="Search exercises"
          testID="exercise-swap-search"
          value={query}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={[styles.list, { maxHeight: height * LIST_SHARE_OF_SCREEN }]}
        testID="exercise-swap-list">
        {loading || !model ? (
          <Text allowFontScaling={false} style={[pageText.body, styles.message]}>Loading exercises…</Text>
        ) : (
          <ExerciseListContent
            emptyText={
              options.length === 0 ? 'No other exercises available.' : 'No exercises match that search.'
            }
            expandedFamilies={expandedFamilies}
            items={model.items}
            mode={model.mode}
            onPressExercise={(exercise) => {
              setQuery('');
              onSelect(exercise);
            }}
            onToggleFamily={(familyName) =>
              setExpandedFamilies((current) => {
                const next = new Set(current);
                if (next.has(familyName)) next.delete(familyName);
                else next.add(familyName);
                return next;
              })
            }
            sections={model.sections}
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
    paddingHorizontal: uiSpace.lg,
  },
  message: {
    paddingVertical: uiSpace.md,
  },
});
