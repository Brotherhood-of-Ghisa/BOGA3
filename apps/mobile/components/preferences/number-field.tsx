import { useState } from 'react';
import { InputRow } from '@/components/ui';

export const parseIntegerDraft = (text: string): number => /^\d+$/.test(text.trim()) ? Number(text) : NaN;

/**
 * A number setting as a form card's `InputRow` (`ux-rules.md` "Forms"). Clearing
 * it commits `defaultValue`, which the blank field shows; invalid or unsaved
 * input stays in the field, and a new durable/pending value replaces it.
 */
export function PreferenceNumberField({ value, defaultValue, label, testID, onCommit, divider = false }: {
  value: number;
  defaultValue: number;
  label: string;
  testID: string;
  onCommit: (value: number) => void;
  divider?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(String(value));
  }
  const commit = () => onCommit(draft.trim() === '' ? defaultValue : parseIntegerDraft(draft));
  return <InputRow divider={divider} label={label} onChangeText={setDraft} onEndEditing={commit}
    placeholder={String(defaultValue)} testID={testID} value={draft} />;
}
