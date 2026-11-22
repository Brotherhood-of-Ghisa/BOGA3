import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Notice, Sheet, Stat } from '@/components/ui';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import type { BodyWeightMeasurement } from '@/src/data/schema';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { weightStyles as styles } from './styles';

/** Imported values are read-only; inclusion is the one reversible action. */
export function ImportedWeightSheet({ reading, displayValue, visible, onDismiss, onSetIgnored }: {
  reading: BodyWeightMeasurement; visible: boolean; onDismiss: () => void;
  displayValue: string;
  onSetIgnored: (ignored: boolean) => Promise<void>;
}) {
  const text = useUiText();
  const tone = useUiTextTone();
  const dateFormat = useDateFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const formKey = visible ? reading.id : null;
  const [shownForm, setShownForm] = useState<string | null>(null);
  if (formKey !== shownForm) {
    setShownForm(formKey);
    if (formKey !== null) setError(null);
  }
  const run = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { await onSetIgnored(!reading.ignored); onDismiss(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update this reading.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Sheet title="Weight reading" visible={visible} testID="imported-weight-sheet"
    dismissLabel="Dismiss weight reading" onDismiss={() => { if (!saving.current) onDismiss(); }}>
    <View style={styles.form}>
      <Stat label={formatLocalDateTime(reading.measuredAt.getTime(), dateFormat)}
        value={displayValue} />
      <Text allowFontScaling={false} style={[text.body, tone.muted]}>
        {reading.ignored ? 'Apple Health · Read-only · Ignored' : 'Apple Health · Read-only'}
      </Text>
      {error ? <Notice live tone="danger" message={error} testID="imported-weight-error" /> : null}
      <ActionButton label={reading.ignored ? 'Use reading' : 'Ignore'} variant="primary" disabled={busy}
        testID="imported-weight-toggle" onPress={() => void run()} />
    </View>
  </Sheet>;
}
