import { useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ExerciseListContent, ExerciseListPreferenceControls, useFamilyExpansion } from '@/components/exercise-catalog/exercise-list-controls';
import { SearchField } from '@/components/ui/search-field';
import { Sheet } from '@/components/ui/sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { uiSpace } from '@/components/ui/tokens';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { buildExerciseListModel, type ExerciseListItem } from '@/src/exercise-catalog/list-model';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';

type ExerciseSwapSheetProps = {
  visible: boolean;
  currentExerciseDefinitionId: string;
  onSelect: (exercise: ExerciseListItem) => void;
  onDismiss: () => void;
};

// The same browser as Add and the catalogue, excluding the current exercise.
export function ExerciseSwapSheet({ visible, currentExerciseDefinitionId, onSelect, onDismiss }: ExerciseSwapSheetProps) {
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useExerciseListPreferences();
  const catalog = useExerciseCatalog();
  const history = useExerciseCatalogStats('all');
  const { reload } = history;
  useEffect(() => { if (visible) reload(); }, [visible, reload]);
  const options = useMemo(() => catalog.exercises.filter((exercise) => !exercise.deletedAt && exercise.id !== currentExerciseDefinitionId), [catalog.exercises, currentExerciseDefinitionId]);
  const model = useMemo(() => visible ? buildExerciseListModel({
    exercises: options, muscleGroups: catalog.muscleGroups, stats: history.stats,
    preferences, query, includeDeleted: false,
  }) : null, [catalog.muscleGroups, options, preferences, query, history.stats, visible]);
  const familyExpansion = useFamilyExpansion(model?.isSearching ?? false);
  const dismiss = () => { setQuery(''); onDismiss(); };

  return (
    <Sheet dismissLabel="Dismiss swap exercise" keyboardAvoiding onDismiss={dismiss} testID="exercise-swap-sheet" title="Swap exercise" visible={visible}>
      <View style={[styles.body, { height: height * 0.8 }]}>
        <View style={styles.controls}>
          <SearchField accessibilityLabel="Search exercises" onChangeText={setQuery} placeholder="Search exercises or muscles" testID="exercise-swap-search" value={query} />
          <ExerciseListPreferenceControls preferences={preferences} onChangePreferences={setPreferences} />
        </View>
        <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" style={styles.list} testID="exercise-swap-list">
          {catalog.status === 'error' ? (
            <StatePanel body={catalog.lastError ?? 'Unable to load exercises.'} fill={false} kind="error" action={{ label: 'Retry', onPress: () => { void ensureExerciseCatalogLoaded(); } }} />
          ) : catalog.status !== 'ready' || !model ? (
            <StatePanel body="Loading exercises…" fill={false} kind="loading" />
          ) : (
            <ExerciseListContent
              emptyText={options.length === 0 ? 'No other exercises available.' : 'No exercises match the current filters.'}
              familyExpansion={familyExpansion}
              items={model.items}
              historyStatus={history.status}
              onRetryHistory={reload}
              onPressExercise={(exercise) => { Keyboard.dismiss(); setQuery(''); onSelect(exercise); }}
              sections={model.sections}
            />
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1 },
  controls: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md, gap: uiSpace.sm },
  list: { flex: 1, paddingHorizontal: uiSpace.lg },
});
