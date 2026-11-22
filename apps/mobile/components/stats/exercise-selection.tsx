import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ListRow, Notice, Sheet, uiSpace, useUiText } from '@/components/ui';
import { MAX_SELECTED_EXERCISES } from '@/src/utils/exercise-selection';

export type SelectedExercise = { id: string; name: string };

/** Selection exists only for this mounted Progress visit, including Back from charts. */
export function useExerciseSelection() {
  const [selected, setSelected] = useState<SelectedExercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = (exercise: SelectedExercise) => {
    if (selected?.some(item => item.id === exercise.id)) return;
    if (selected?.length === MAX_SELECTED_EXERCISES) { setError('Choose up to 5 exercises.'); return; }
    setError(null);
    setSelected([...(selected ?? []), { id: exercise.id, name: exercise.name }]);
  };
  return {
    selected, error, add,
    toggle: (exercise: SelectedExercise) => {
      if (selected?.some(item => item.id === exercise.id)) {
        setSelected(selected.filter(item => item.id !== exercise.id)); setError(null);
      } else add(exercise);
    },
    cancel: () => { setSelected(null); setError(null); },
  };
}

/** Full names stay readable; this sheet describes the scope, never changes it. */
export function ExerciseSelectionSheet({ exercises, visible, onDismiss }: {
  exercises: readonly SelectedExercise[]; visible: boolean; onDismiss: () => void;
}) {
  const text = useUiText();
  return <Sheet dismissLabel="Dismiss selected exercises" onDismiss={onDismiss}
    title={`${exercises.length} exercises`} testID="selected-exercises-sheet" visible={visible}>
    <ScrollView contentContainerStyle={styles.names}>
      {exercises.map(exercise => <ListRow accessible accessibilityLabel={exercise.name} key={exercise.id}
        testID={`selected-exercise-${exercise.id}`}><Text allowFontScaling={false} style={text.body}>{exercise.name}</Text></ListRow>)}
    </ScrollView>
  </Sheet>;
}

/** Occupies the existing search/filter row only while multi-selection is active. */
export function ExerciseSelectionControls({ exercises, error, onCancel, onShow }: {
  exercises: readonly SelectedExercise[]; error: string | null; onCancel: () => void; onShow: () => void;
}) {
  const [namesVisible, setNamesVisible] = useState(false);
  return <>
    <View style={styles.controls} testID="stats-exercise-selection-controls">
      <ActionButton label="Cancel" onPress={onCancel} size="compact" variant="text" testID="stats-exercise-selection-cancel" />
      <ActionButton label={`${exercises.length} selected`} onPress={() => setNamesVisible(true)} size="compact" variant="link"
        accessibilityLabel={`${exercises.length} exercises selected, show names`} testID="stats-exercise-selection-count" />
      <ActionButton disabled={exercises.length < 2} label="Show progress" onPress={onShow} size="compact" variant="primary"
        testID="stats-exercise-selection-show" />
    </View>
    {error ? <Notice live message={error} tone="danger" testID="stats-exercise-selection-limit" /> : null}
    <ExerciseSelectionSheet exercises={exercises} visible={namesVisible} onDismiss={() => setNamesVisible(false)} />
  </>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: uiSpace.xs },
  names: { paddingBottom: uiSpace.lg },
});
