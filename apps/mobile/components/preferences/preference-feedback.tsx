import { ActionButton, Notice } from '@/components/ui';
import { useExerciseListPreferenceState } from '@/src/exercise-catalog/list-preferences';

export function PreferenceFeedback() {
  const { error, retry } = useExerciseListPreferenceState();
  return error ? <Notice
    action={<ActionButton accessibilityLabel="Retry preferences" label="Retry" onPress={() => { void retry(); }} variant="outline" />}
    live message={error} testID="preferences-error" tone="danger"
  /> : null;
}
