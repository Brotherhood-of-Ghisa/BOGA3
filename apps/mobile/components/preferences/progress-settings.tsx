import { StyleSheet, Text, View } from 'react-native';
import { Card, SegmentedControl, SwitchRow, uiSpace, uiText } from '@/components/ui';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { PreferenceNumberField } from './number-field';

const BREAKDOWN_OPTIONS = [{ value: 'muscle', label: 'Muscle' }, { value: 'exercise', label: 'Exercise' }] as const;
const MUSCLE_METRIC_OPTIONS = [{ value: 'workingSetCount', label: 'Sets' }, { value: 'totalVolume', label: 'Volume' }] as const;
const EXERCISE_METRIC_OPTIONS = [...MUSCLE_METRIC_OPTIONS, { value: 'estimatedOneRepMax', label: '1RM' }] as const;

export function ProgressSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  const current = { ...values, ...pending };
  return <View style={styles.section} testID="settings-section-progress">
    <ProgressDefaults values={current} />
    <Card style={styles.card}>
      <View style={styles.preference}>
        <Text allowFontScaling={false} style={uiText.label}>Progress view</Text>
        <SegmentedControl accessibilityLabel="Progress view"
          options={[{ value: 'list', label: 'List' }, { value: '3d', label: '3D' }]}
          value={pending.progressMuscleLayout ?? values.progressMuscleLayout}
          onChange={progressMuscleLayout => updatePreferences({ progressMuscleLayout })}
          testIDPrefix="settings-muscle-view" />
      </View>
      <PreferenceNumberField label="Progress period (weeks)" testID="settings-target-window"
        value={pending.targetWindowWeeks ?? values.targetWindowWeeks}
        onCommit={targetWindowWeeks => updatePreferences({ targetWindowWeeks })} />
      <PreferenceNumberField label="History look-back (weeks)" testID="settings-history-lookback"
        value={pending.historyLookbackWeeks ?? values.historyLookbackWeeks}
        onCommit={historyLookbackWeeks => updatePreferences({ historyLookbackWeeks })} />
    </Card>
  </View>;
}

// What Progress opens on each visit; a choice made on Progress lasts only for that visit.
function ProgressDefaults({ values }: { values: AccountLocalPreferenceState['values'] }) {
  const weeks = values.targetWindowWeeks;
  return <>
    <Card style={styles.card} testID="settings-progress-defaults">
      <View style={styles.preference}>
        <Text allowFontScaling={false} style={uiText.label}>Default view</Text>
        <SegmentedControl accessibilityLabel="Default view" options={BREAKDOWN_OPTIONS} value={values.progressBreakdown}
          onChange={progressBreakdown => updatePreferences({ progressBreakdown })} testIDPrefix="settings-progress-breakdown" />
      </View>
      {/* With a one-week Progress period, This week is the only period there is. */}
      {weeks === 1 ? null : <View style={styles.preference}>
        <Text allowFontScaling={false} style={uiText.label}>Default period</Text>
        <SegmentedControl accessibilityLabel="Default period"
          options={[{ value: 'window', label: `${weeks} weeks` }, { value: 'this-week', label: 'This week' }] as const}
          value={values.progressPeriod}
          onChange={progressPeriod => updatePreferences({ progressPeriod })} testIDPrefix="settings-progress-period" />
      </View>}
      <View style={styles.preference}>
        <Text allowFontScaling={false} style={uiText.label}>Default muscle metric</Text>
        <SegmentedControl accessibilityLabel="Default muscle metric" options={MUSCLE_METRIC_OPTIONS} value={values.progressMetric}
          onChange={progressMetric => updatePreferences({ progressMetric })} testIDPrefix="settings-progress-metric" />
      </View>
      <View style={styles.preference}>
        <Text allowFontScaling={false} style={uiText.label}>Default exercise metric</Text>
        <SegmentedControl accessibilityLabel="Default exercise metric" options={EXERCISE_METRIC_OPTIONS}
          value={values.progressExerciseMetric}
          onChange={progressExerciseMetric => updatePreferences({ progressExerciseMetric })}
          testIDPrefix="settings-progress-exercise-metric" />
      </View>
    </Card>
    <Card>
      <SwitchRow label="Group by muscle family" testID="settings-progress-grouped" value={values.progressGrouped}
        onValueChange={progressGrouped => updatePreferences({ progressGrouped })} />
      <SwitchRow label="Count secondary sets" testID="settings-progress-count-secondary" value={values.progressCountSecondary}
        onValueChange={progressCountSecondary => updatePreferences({ progressCountSecondary })} />
    </Card>
  </>;
}

const styles = StyleSheet.create({
  section: { gap: uiSpace.md },
  preference: { gap: uiSpace.sm },
  card: { padding: uiSpace.md, gap: uiSpace.md },
});
