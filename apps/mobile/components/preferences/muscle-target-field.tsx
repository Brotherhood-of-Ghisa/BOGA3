import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FormError, InputRow, uiSpace } from '@/components/ui';
import { parseIntegerDraft } from './number-field';

/**
 * Draft/validation boundary for [[muscle.weekly-targets]]: an `InputRow` whose
 * blank shows `placeholder` (the default it falls back to) and commits `blank`
 * (nothing, for a muscle that follows the default; the default itself, for the
 * default target). An invalid draft stays in the field with its error under it.
 */
export function MuscleTargetField({ label, value, placeholder, blank, divider = false, testID, onCommit }: {
  label: string; value: number | undefined; placeholder: number; blank: number | undefined;
  divider?: boolean; testID: string; onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [previous, setPrevious] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (previous !== value) {
    setPrevious(value);
    setDraft(value === undefined ? '' : String(value));
    setError(null);
  }
  const commit = () => {
    const target = draft.trim() === '' ? blank : parseIntegerDraft(draft);
    if (target !== undefined && (!Number.isSafeInteger(target) || target <= 0)) {
      setError('Enter a positive whole number.');
      return;
    }
    setError(null);
    onCommit(target);
  };
  return <>
    <InputRow divider={divider} invalid={error !== null} label={label}
      onChangeText={text => { setDraft(text); setError(null); }} onEndEditing={commit}
      placeholder={String(placeholder)} testID={testID} value={draft} />
    {error ? <View style={styles.error}><FormError message={error} testID={`${testID}-error`} /></View> : null}
  </>;
}

const styles = StyleSheet.create({
  error: { paddingBottom: uiSpace.sm, paddingHorizontal: uiSpace.md },
});
