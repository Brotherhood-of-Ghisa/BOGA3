import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { EFFORT_CHOICES, type EffortChoice } from '@/src/exercise-calculations/effort-policy';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferences } from '@/src/preferences/model';

const columns = [
  { field: 'displayEfforts', label: 'Display' },
  { field: 'workingSetEfforts', label: 'Working set' },
  { field: 'volumeEfforts', label: 'Volume' },
] as const;

export function EffortSettings({ values }: { values: AccountLocalPreferences }) {
  const toggle = (field: typeof columns[number]['field'], id: EffortChoice) => {
    const selected = values[field];
    updatePreferences({ [field]: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] });
  };
  return <View testID="settings-effort-selections">
    <Text allowFontScaling={false} style={styles.description}>Display chooses labels for logging. Working set controls counts and strength records. Volume controls volume totals and records.</Text>
    <View style={styles.row}>
      <Text allowFontScaling={false} style={styles.name}>Effort</Text>
      {columns.map(column => <Text key={column.field} allowFontScaling={false} style={[styles.header, styles.column]}>{column.label}</Text>)}
    </View>
    {EFFORT_CHOICES.map(choice => <View key={choice.id} style={styles.row}>
      <Text allowFontScaling={false} style={styles.name}>{choice.label}</Text>
      {columns.map(column => <View key={column.field} style={styles.column}>
        <Pressable accessibilityLabel={`${choice.label}, ${column.label}`} accessibilityRole="checkbox"
          accessibilityState={{ checked: values[column.field].includes(choice.id) }}
          onPress={() => toggle(column.field, choice.id)} style={styles.checkbox}
          testID={`settings-effort-${choice.id}-${column.field}`}>
          <View style={styles.box}>{values[column.field].includes(choice.id)
            ? <Icon name="check" size="sm" color={uiRoles.ink} /> : null}</View>
        </Pressable>
      </View>)}
    </View>)}
    <Text allowFontScaling={false} style={[styles.description, styles.note]}>These choices apply to personal progress on this device. Groups keep their shared rules.</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: uiGeometry.tapTarget, borderBottomWidth: uiBorder.width, borderBottomColor: uiRoles.rule },
  name: { flex: 1, fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.ink },
  header: { textAlign: 'center', fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted },
  column: { width: uiGeometry.tapTarget * 1.4, alignItems: 'center' },
  checkbox: { width: uiGeometry.tapTarget, height: uiGeometry.tapTarget, alignItems: 'center', justifyContent: 'center' },
  box: { width: uiSpace.lg, height: uiSpace.lg, borderWidth: uiBorder.width, borderColor: uiRoles.ink, borderRadius: uiGeometry.radius.control, alignItems: 'center', justifyContent: 'center' },
  description: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted, marginBottom: uiSpace.sm },
  note: { marginTop: uiSpace.md, marginBottom: 0 },
});
