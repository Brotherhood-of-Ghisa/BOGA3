import { useRef, useState } from 'react';
import { Alert, Keyboard, ScrollView, Text } from 'react-native';
import { ActionButton, FormField, Notice, Sheet } from '@/components/ui';
import { resolveMeasurementDate, validateBodyWeight, type WeightEntry } from '@/src/bodyweight/weight-entry';
import { formatCurrentDateTime } from '@/src/utils/local-time';
import { weightStyles as styles } from './styles';

// Keep the native Modal mounted through its visible=false dismissal, matching
// the shared exercise editor. Reset fields on each new opening;
// failed writes retain input and duplicate submissions are blocked.
export function WeightEntrySheet({ visible = true, autoFocus = true, title, initial, measuredAt, explanation, onSave, onDelete, onDismiss }: {
  visible?: boolean;
  autoFocus?: boolean;
  title: string;
  initial: WeightEntry;
  measuredAt: Date;
  explanation?: string;
  onSave: (input: WeightEntry & { measuredAt: Date }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState(initial.weightValue);
  const [dateText, setDateText] = useState(formatCurrentDateTime(measuredAt));
  const [valueError, setValueError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const measuredAtMs = measuredAt.getTime();
  // Opening (or a new reading while open) shows it, reset in the render that opens.
  const formKey = visible ? JSON.stringify([initial.weightValue, measuredAtMs]) : null;
  const [shownFormKey, setShownFormKey] = useState<string | null>(null);
  if (formKey !== shownFormKey) {
    setShownFormKey(formKey);
    if (formKey !== null) {
      setValue(initial.weightValue);
      setDateText(formatCurrentDateTime(new Date(measuredAtMs)));
      setValueError(null); setDateError(null); setSaveError(null);
    }
  }
  const run = async (action: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setSaveError(null);
    Keyboard.dismiss();
    try { await action(); onDismiss(); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const save = () => {
    setValueError(null); setDateError(null);
    const input = { weightValue: value };
    try { validateBodyWeight(input); }
    catch (error) { setValueError((error as Error).message); return; }
    let date: Date;
    {
      try { date = resolveMeasurementDate(dateText, measuredAt); }
      catch (error) { setDateError((error as Error).message); return; }
    }
    void run(() => onSave({ ...input, measuredAt: date }));
  };
  return (
    <Sheet visible={visible} title={title} keyboardAvoiding dismissLabel="Dismiss weight editor"
      onDismiss={() => { if (!saving.current) onDismiss(); }} testID="weight-entry-sheet">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
        {explanation ? <Text allowFontScaling={false} style={styles.body}>{explanation}</Text> : null}
        <FormField label="Body weight (kg)" accessibilityLabel="Body weight in kilograms"
          value={value} onChangeText={setValue} keyboardType="decimal-pad" autoFocus={autoFocus}
          editable={!busy} error={valueError} testID="weight-entry-value" />
        <FormField label="Measured at" accessibilityLabel="Measurement date and time"
          value={dateText} onChangeText={setDateText} autoCapitalize="none" autoCorrect={false}
          editable={!busy} error={dateError} hint="Local time · YYYY-MM-DD HH:mm"
          testID="weight-entry-date" />
        {saveError ? <Notice live tone="danger" message={saveError} testID="weight-entry-save-error" /> : null}
        <ActionButton label={busy ? 'Saving…' : 'Save weight'} onPress={save} disabled={busy}
          variant="primary" testID="weight-entry-save" />
        {onDelete ? <ActionButton label="Delete reading" variant="text" tone="danger" disabled={busy}
          testID="weight-entry-delete" onPress={() => Alert.alert('Delete reading?',
            'Delete this weight reading?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void run(onDelete) },
            ])} /> : null}
      </ScrollView>
    </Sheet>
  );
}
