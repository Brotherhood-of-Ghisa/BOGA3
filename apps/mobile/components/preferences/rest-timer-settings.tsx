import { StyleSheet, Text, View } from 'react-native';

import { SegmentedControl, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';

import { PreferenceNumberField } from './number-field';

type AutoStartOptionValue = 'on' | 'off';

const AUTO_START_OPTIONS: readonly {
  value: AutoStartOptionValue;
  label: string;
  accessibilityLabel: string;
}[] = [
  {
    value: 'on',
    label: 'On',
    accessibilityLabel: 'Set auto-start rest timer to On',
  },
  {
    value: 'off',
    label: 'Off',
    accessibilityLabel: 'Set auto-start rest timer to Off',
  },
];

export function RestTimerSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  const autoStart = pending.restTimerAutoStart ?? values.restTimerAutoStart;
  const durationSec = pending.restTimerDurationSec ?? values.restTimerDurationSec;

  return (
    <View style={styles.container} testID="settings-rest-timer">
      <View style={styles.preference}>
        <Text allowFontScaling={false} style={styles.fieldLabel}>
          Auto-start rest timer
        </Text>
        <SegmentedControl
          accessibilityLabel="Auto-start rest timer"
          onChange={(choice) => updatePreferences({ restTimerAutoStart: choice === 'on' })}
          options={AUTO_START_OPTIONS}
          testIDPrefix="settings-rest-timer-auto-start"
          value={autoStart ? 'on' : 'off'}
        />
      </View>
      <PreferenceNumberField
        label="Rest timer (seconds)"
        onCommit={(restTimerDurationSec) => updatePreferences({ restTimerDurationSec })}
        testID="settings-rest-timer-duration"
        value={durationSec}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.md,
  },
  preference: {
    gap: uiSpace.sm,
  },
  fieldLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
});
