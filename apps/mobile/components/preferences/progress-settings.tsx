import { View, StyleSheet } from 'react-native';
import { FormSection, Information, SegmentRow, SwitchRow, uiGeometry, uiIconSize, uiSpace } from '@/components/ui';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES } from '@/src/preferences/model';
import { PreferenceNumberField } from './number-field';

const BREAKDOWN_OPTIONS = [{ value: 'muscle', label: 'Muscle' }, { value: 'exercise', label: 'Exercise' }] as const;
const MUSCLE_METRIC_OPTIONS = [{ value: 'workingSetCount', label: 'Sets' }, { value: 'totalVolume', label: 'Volume' }] as const;
const EXERCISE_METRIC_OPTIONS = [...MUSCLE_METRIC_OPTIONS, { value: 'estimatedOneRepMax', label: '1RM' }] as const;
const COUNTING_SECTIONS = [
  ['Sets', 'Each primary muscle gets 1 working set. With “Sets: Primary only” off, each secondary muscle also gets ½ set.'],
  ['Volume', 'Muscle Volume is load per side × reps. Primary muscles split this equally. With “Volume: Primary only” off, secondary muscles share an additional half of that amount.'],
] as const;
const MUSCLE_VIEW_OPTIONS = [{ value: 'list', label: 'List' }, { value: '3d', label: '3D' }] as const;

// The Progress page: what Progress opens on, how muscles show, the two periods
// and what counts, as four sections of the Settings row vocabulary. Counting
// opens the standard explainer without changing any preference.
export function ProgressSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  const current = { ...values, ...pending };
  return <View style={styles.page} testID="settings-section-progress">
    <OpensOn values={values} />
    <FormSection title="Display">
      <SegmentRow label="Muscle view" onChange={progressMuscleLayout => updatePreferences({ progressMuscleLayout })}
        options={MUSCLE_VIEW_OPTIONS} testIDPrefix="settings-muscle-view" value={current.progressMuscleLayout} />
    </FormSection>
    <FormSection title="Periods">
      <PreferenceNumberField defaultValue={DEFAULT_ACCOUNT_LOCAL_PREFERENCES.targetWindowWeeks}
        label="Progress period (weeks)" testID="settings-target-window" value={current.targetWindowWeeks}
        onCommit={targetWindowWeeks => updatePreferences({ targetWindowWeeks })} />
      <PreferenceNumberField defaultValue={DEFAULT_ACCOUNT_LOCAL_PREFERENCES.historyLookbackWeeks} divider
        label="History look-back (weeks)" testID="settings-history-lookback" value={current.historyLookbackWeeks}
        onCommit={historyLookbackWeeks => updatePreferences({ historyLookbackWeeks })} />
    </FormSection>
    <FormSection title="Counting" titleAccessory={
      <View style={styles.countingInfo}>
        <Information title="About counting" sections={COUNTING_SECTIONS} testIDPrefix="settings-counting" />
      </View>
    }>
      <SwitchRow density="list" label="Group by muscle family" testID="settings-progress-grouped" value={values.progressGrouped}
        onValueChange={progressGrouped => updatePreferences({ progressGrouped })} />
      <SwitchRow density="list" divider label="Sets: Primary only" testID="settings-progress-count-secondary"
        value={!values.progressCountSecondary} onValueChange={primaryOnly => updatePreferences({ progressCountSecondary: !primaryOnly })} />
      <SwitchRow density="list" divider label="Volume: Primary only" testID="settings-muscle-volume-primary-only"
        value={values.muscleVolumePrimaryOnly}
        onValueChange={muscleVolumePrimaryOnly => updatePreferences({ muscleVolumePrimaryOnly })} />
    </FormSection>
  </View>;
}

// What Progress opens on each visit; a choice made on Progress lasts only for that visit.
function OpensOn({ values }: { values: AccountLocalPreferenceState['values'] }) {
  const weeks = values.targetWindowWeeks;
  return <FormSection testID="settings-progress-defaults" title="Opens on">
    <SegmentRow label="Default view" onChange={progressBreakdown => updatePreferences({ progressBreakdown })}
      options={BREAKDOWN_OPTIONS} testIDPrefix="settings-progress-breakdown" value={values.progressBreakdown} />
    {/* With a one-week Progress period, This week is the only period there is. */}
    {weeks === 1 ? null : <SegmentRow divider label="Default period"
      onChange={progressPeriod => updatePreferences({ progressPeriod })}
      options={[{ value: 'window', label: `${weeks} weeks` }, { value: 'this-week', label: 'This week' }] as const}
      testIDPrefix="settings-progress-period" value={values.progressPeriod} />}
    <SegmentRow divider label="Default muscle metric" onChange={progressMetric => updatePreferences({ progressMetric })}
      options={MUSCLE_METRIC_OPTIONS} testIDPrefix="settings-progress-metric" value={values.progressMetric} />
    <SegmentRow divider label="Default exercise metric"
      onChange={progressExerciseMetric => updatePreferences({ progressExerciseMetric })}
      options={EXERCISE_METRIC_OPTIONS} testIDPrefix="settings-progress-exercise-metric" value={values.progressExerciseMetric} />
  </FormSection>;
}

const styles = StyleSheet.create({
  page: { gap: uiSpace.md },
  // Keep the glyph 4pt from the micro-label without shrinking its tap target.
  countingInfo: { marginLeft: uiSpace.xs - (uiGeometry.tapTarget - uiIconSize.sm) / 2 },
});
