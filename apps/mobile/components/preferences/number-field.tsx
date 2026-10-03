import { useState } from 'react';
import { FormField } from '@/components/ui';

export const parseIntegerDraft = (text: string): number => /^\d+$/.test(text.trim()) ? Number(text) : NaN;

/** Keep invalid or unsaved input intact; a new durable/pending value updates it. */
export function PreferenceNumberField({ value, label, testID, onCommit }: {
  value: number;
  label: string;
  testID: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(String(value));
  }
  return <FormField label={label} accessibilityLabel={label} keyboardType="number-pad"
    onChangeText={setDraft} onEndEditing={() => onCommit(parseIntegerDraft(draft))}
    testID={testID} value={draft} />;
}
