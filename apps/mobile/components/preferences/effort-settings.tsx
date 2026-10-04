import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, FormField, Icon, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { isNonNegativeSafeInteger } from '@/src/preferences/model';
import { reportPreferenceValidationError, updatePreferences } from '@/src/preferences/hooks';
import { getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import type { AccountLocalPreferences } from '@/src/preferences/model';
import { parseIntegerDraft } from './number-field';

function EffortCheckbox({ label, checked, disabled = false, testID, onPress }: {
  label: string; checked: boolean; disabled?: boolean; testID: string; onPress: () => void;
}) {
  return <Pressable accessibilityLabel={label} accessibilityRole="checkbox"
    accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress}
    style={styles.checkbox} testID={testID}>
    <View style={[styles.box, disabled ? styles.locked : null]}>
      {checked ? <Icon name="check" size="sm" color={disabled ? uiRoles.inkMuted : uiRoles.ink} /> : null}
    </View>
  </Pressable>;
}

function EffortRow({ name, id, visible, locked = false, onPress }: {
  name: string; id: string; visible: boolean; locked?: boolean; onPress: () => void;
}) {
  return <View style={styles.row}>
    <Text allowFontScaling={false} style={styles.name}>{name}</Text>
    <View style={styles.visibleColumn}><EffortCheckbox label={`${name}, Visible`} checked={visible}
      disabled={locked} onPress={onPress} testID={`settings-effort-${id}-visible`} /></View>
  </View>;
}

export function EffortSettings({ values, savedGrades }: { values: AccountLocalPreferences; savedGrades: number[] }) {
  const [newGrade, setNewGrade] = useState('');
  const [submittedGrade, setSubmittedGrade] = useState<number | null>(null);
  const [addedGrades, setAddedGrades] = useState<number[]>([]);
  // A successful Refresh publishes the durable grade; typing cancels this draft's submission.
  if (submittedGrade !== null && savedGrades.includes(submittedGrade)) {
    setNewGrade('');
    setSubmittedGrade(null);
  }
  const grades = [...new Set([0, 1, 2, 3, ...values.visibleEffortGrades, ...addedGrades])].sort((a, b) => a - b);
  const toggleVisible = (grade: number) => updatePreferences({ visibleEffortGrades:
    values.visibleEffortGrades.includes(grade) ? values.visibleEffortGrades.filter(value => value !== grade)
      : [...values.visibleEffortGrades, grade].sort((a, b) => a - b) });
  const addGrade = () => {
    if (!newGrade.trim()) return;
    const grade = parseIntegerDraft(newGrade);
    if (!isNonNegativeSafeInteger(grade)) {
      reportPreferenceValidationError('RIR value must be a non-negative whole number.');
      return;
    }
    setSubmittedGrade(grade);
    updatePreferences({ visibleEffortGrades: [...new Set([...values.visibleEffortGrades, grade])].sort((a, b) => a - b) });
    setAddedGrades(previous => [...new Set([...previous, grade])]);
    if (getAccountLocalPreferenceState().values.visibleEffortGrades.includes(grade)) Keyboard.dismiss();
  };
  return <View testID="settings-effort-selections">
    <Text allowFontScaling={false} style={styles.description}>Choose the effort labels offered when logging sets.</Text>
    <View style={styles.row}>
      <Text allowFontScaling={false} style={styles.name}>Effort</Text>
      <Text allowFontScaling={false} style={[styles.header, styles.visibleColumn]}>Visible</Text>
    </View>
    <EffortRow name="W-Up" id="warm-up" visible locked onPress={() => {}} />
    <EffortRow name="Unspecified" id="unspecified" visible locked onPress={() => {}} />
    {grades.map(grade => <EffortRow key={grade} name={`RIR ${grade}`} id={`rir-${grade}`}
      visible={values.visibleEffortGrades.includes(grade)} onPress={() => toggleVisible(grade)} />)}
    <View style={styles.addRow}>
      <FormField label="Add RIR value" accessibilityLabel="Add RIR value" keyboardType="number-pad"
        onChangeText={text => { setSubmittedGrade(null); setNewGrade(text); }}
        containerStyle={styles.addField} testID="settings-add-rir-input" value={newGrade} />
      <ActionButton label="Add" accessibilityLabel="Add RIR grade" onPress={addGrade} variant="outline"
        disabled={!newGrade.trim()} testID="settings-add-rir-button" />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: uiGeometry.tapTarget, borderBottomWidth: uiBorder.width, borderBottomColor: uiRoles.rule },
  name: { flex: 1, fontFamily: uiFonts.body.family, fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  header: { textAlign: 'center', fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
  visibleColumn: { width: uiGeometry.tapTarget * 1.6, alignItems: 'center' },
  checkbox: { width: uiGeometry.tapTarget, height: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
  box: { width: uiSpace.lg, height: uiSpace.lg, borderWidth: uiBorder.width, borderColor: uiRoles.ink, borderRadius: uiGeometry.radius.control, alignItems: 'center', justifyContent: 'center' },
  locked: { borderColor: uiRoles.rule },
  description: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted, marginBottom: uiSpace.sm },
  addRow: { flexDirection: 'row', gap: uiSpace.sm, alignItems: 'center', marginTop: uiSpace.md },
  addField: { flex: 1 },
});
