import { useState } from 'react';
import { FormField, InputRow } from '@/components/ui';

export const parseIntegerDraft = (text: string): number => /^\d+$/.test(text.trim()) ? Number(text) : NaN;

/** Keep invalid or unsaved input intact; a new durable/pending value updates it. */
export function PreferenceNumberField({ value, label, testID, onCommit, row = false, divider = false }: {
  value: number;
  label: string;
  testID: string;
  onCommit: (value: number) => void;
  /** A form card's `InputRow` (`ux-rules.md` "Forms") rather than a standalone field. */
  row?: boolean;
  divider?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(String(value));
  }
  const commit = () => onCommit(parseIntegerDraft(draft));
  if (row) {
    return <InputRow divider={divider} label={label} onChangeText={setDraft} onEndEditing={commit} testID={testID} value={draft} />;
  }
  return <FormField label={label} accessibilityLabel={label} keyboardType="number-pad"
    onChangeText={setDraft} onEndEditing={commit}
    testID={testID} value={draft} />;
}
