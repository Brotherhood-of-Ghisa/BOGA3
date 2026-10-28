import { StyleSheet, View } from 'react-native';

import { FormSection, SwitchRow, uiSpace } from '@/components/ui';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';

import { PreferenceNumberField } from './number-field';

// The rest timer page: one form section of the auto-start switch and the two
// durations, each typed in place and saved when editing ends.
export function RestTimerSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  const autoStart = pending.restTimerAutoStart ?? values.restTimerAutoStart;
  const durationSec = pending.restTimerDurationSec ?? values.restTimerDurationSec;
  const intervalSec = pending.repeatingTimerIntervalSec ?? values.repeatingTimerIntervalSec;

  return (
    <View style={styles.container} testID="settings-rest-timer">
      <FormSection title="Rest timer">
        <SwitchRow
          density="list"
          label="Auto-start rest timer"
          onValueChange={(restTimerAutoStart) => updatePreferences({ restTimerAutoStart })}
          testID="settings-rest-timer-auto-start"
          value={autoStart}
        />
        <PreferenceNumberField
          divider
          label="Rest timer (s)"
          onCommit={(restTimerDurationSec) => updatePreferences({ restTimerDurationSec })}
          row
          testID="settings-rest-timer-duration"
          value={durationSec}
        />
        <PreferenceNumberField
          divider
          label="Repeating interval (s)"
          onCommit={(repeatingTimerIntervalSec) => updatePreferences({ repeatingTimerIntervalSec })}
          row
          testID="settings-repeating-timer-interval"
          value={intervalSec}
        />
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.md,
  },
});
