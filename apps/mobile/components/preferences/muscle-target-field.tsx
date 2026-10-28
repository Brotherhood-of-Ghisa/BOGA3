import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { IconButton, uiBorder, uiGeometry, uiRoles, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { parseIntegerDraft } from './number-field';

/** Draft/validation boundary for [[muscle.weekly-targets]]. */
export function MuscleTargetField({ label, value, defaultTarget, testID, onCommit }: {
  label: string; value: number | undefined; defaultTarget?: number; testID: string;
  onCommit: (value: number | undefined) => void;
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
    const target = draft.trim() === '' && defaultTarget !== undefined ? undefined : parseIntegerDraft(draft);
    if (target !== undefined && (!Number.isSafeInteger(target) || target <= 0)) {
      setError('Enter a positive whole number.');
      return;
    }
    setError(null);
    onCommit(target);
  };
  const reset = () => { setDraft(''); setError(null); onCommit(undefined); };
  return <View style={styles.container} testID={`${testID}-row`}>
    <View style={styles.row}>
      <View style={styles.name}>
        <Text allowFontScaling={false} style={uiText.bodyStrong}>{label}</Text>
        {defaultTarget !== undefined && value === undefined && draft.trim() === '' ?
          <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-default`}>Default</Text> : null}
      </View>
      <TextInput accessibilityLabel={label} accessibilityHint={defaultTarget !== undefined ? `Default ${defaultTarget} sets per week` : undefined}
        allowFontScaling={false} keyboardType="number-pad" returnKeyType="done"
        onChangeText={text => { setDraft(text); setError(null); }} onEndEditing={commit}
        placeholder={defaultTarget === undefined ? undefined : String(defaultTarget)} placeholderTextColor={uiRoles.inkMuted}
        style={[uiText.input, uiText.inlineFigure, styles.input, error ? styles.invalid : null]} testID={testID} value={draft} />
      {defaultTarget !== undefined ? <View style={styles.reset}>
        {value !== undefined || draft.trim() !== '' ? <IconButton accessibilityLabel={`Reset ${label} to default`}
          name="refresh" onPress={reset} testID={`${testID}-reset`} tone="muted" /> : null}
      </View> : null}
    </View>
    {error ? <Text accessibilityLiveRegion="polite" allowFontScaling={false} style={[uiText.meta, uiTextTone.danger, styles.error]} testID={`${testID}-error`}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs, padding: uiSpace.md },
  name: { flex: 1, minWidth: 0, gap: uiSpace.xs },
  input: { width: uiGeometry.tapTarget + uiSpace.lg, minHeight: uiGeometry.tapTarget,
    padding: uiSpace.sm, borderWidth: uiBorder.width, borderColor: uiRoles.rule, borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.surface, textAlign: 'center' },
  invalid: { borderColor: uiRoles.danger },
  reset: { width: uiGeometry.tapTarget },
  error: { paddingHorizontal: uiSpace.md, paddingBottom: uiSpace.md },
});
