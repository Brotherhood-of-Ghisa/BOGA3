import { StyleSheet, Text, View } from 'react-native';
import { Card, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { EffortSettings } from './effort-settings';
import { PreferenceNumberField } from './number-field';

export function ProgressSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  return <View style={styles.section} testID="settings-section-progress">
    <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>Progress</Text>
    <Card style={styles.card}>
      <PreferenceNumberField label="Weekly working sets per muscle" testID="settings-weekly-working-set-target"
        value={pending.weeklyWorkingSetTarget ?? values.weeklyWorkingSetTarget}
        onCommit={weeklyWorkingSetTarget => updatePreferences({ weeklyWorkingSetTarget })} />
      <PreferenceNumberField label="Progress period (weeks)" testID="settings-target-window"
        value={pending.targetWindowWeeks ?? values.targetWindowWeeks}
        onCommit={targetWindowWeeks => updatePreferences({ targetWindowWeeks })} />
      <PreferenceNumberField label="History look-back (weeks)" testID="settings-history-lookback"
        value={pending.historyLookbackWeeks ?? values.historyLookbackWeeks}
        onCommit={historyLookbackWeeks => updatePreferences({ historyLookbackWeeks })} />
    </Card>
    <Card style={styles.card}><EffortSettings values={{ ...values, ...pending }} /></Card>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: uiSpace.sm },
  card: { padding: uiSpace.md, gap: uiSpace.md },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted, textTransform: 'uppercase' },
  label: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
});
