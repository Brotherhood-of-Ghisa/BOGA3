import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';
import { LOAD_INPUT_MODES, LOAD_INPUT_MODE_LABELS, type LoadInputMode } from '@/src/exercise-core';

export type BodyweightContributionFieldValue = {
  percentage: string;
};

type ExerciseCoreFieldsProps = {
  bodyweightContribution?: {
    value: BodyweightContributionFieldValue;
    onChange: (value: BodyweightContributionFieldValue) => void;
    error?: string | null;
  };
  name: string;
  onChangeName: (name: string) => void;
  loadInputMode: LoadInputMode;
  onChangeLoadInputMode: (mode: LoadInputMode) => void;
  /** The name's `validateExerciseCore` message, shown under the field. */
  nameError: string | null;
  /** testIDs: `<prefix>-name-input`, `<prefix>-name-error`, `<prefix>-load-mode-<mode>`. */
  testIDPrefix: string;
  editable?: boolean;
  autoFocus?: boolean;
};

const LOAD_MODE_OPTIONS = LOAD_INPUT_MODES.map((mode) => ({
  value: mode,
  label: LOAD_INPUT_MODE_LABELS[mode],
  accessibilityLabel: `${LOAD_INPUT_MODE_LABELS[mode]} weight entry`,
}));

/**
 * The `ExerciseCore` fields (T1): the exercise name and the
 * `Total load` / `Per side` weight entry. The personal exercise editor and the
 * group exercise form render these same fields and validate them with
 * `validateExerciseCore` (`src/exercise-core`). A `FormField` for the name and
 * a `SegmentedControl` for the weight entry.
 */
export function ExerciseCoreFields({
  name,
  onChangeName,
  loadInputMode,
  onChangeLoadInputMode,
  nameError,
  testIDPrefix,
  editable = true,
  autoFocus = false,
  bodyweightContribution,
}: ExerciseCoreFieldsProps) {
  return (
    <View style={styles.root}>
      <FormField
        accessibilityLabel="Exercise definition name"
        autoCorrect={false}
        autoFocus={autoFocus}
        editable={editable}
        error={nameError}
        errorTestID={`${testIDPrefix}-name-error`}
        face="text"
        label="Exercise name"
        onChangeText={onChangeName}
        placeholder="Exercise name"
        testID={`${testIDPrefix}-name-input`}
        value={name}
      />

      <View style={styles.group}>
        <Text allowFontScaling={false} accessibilityRole="header" style={uiText.label}>
          Weight entry
        </Text>
        <SegmentedControl
          disabled={!editable}
          onChange={onChangeLoadInputMode}
          options={LOAD_MODE_OPTIONS}
          style={styles.loadMode}
          testIDPrefix={`${testIDPrefix}-load-mode`}
          value={loadInputMode}
        />
      </View>
      {bodyweightContribution ? (
        <View style={styles.group}>
          <FormField
            accessibilityLabel="Bodyweight contribution percent"
            editable={editable}
            face="figure"
            keyboardType="decimal-pad"
            label="Bodyweight contribution (%)"
            onChangeText={(percentage) => bodyweightContribution.onChange({ percentage })}
            testID={`${testIDPrefix}-bodyweight-percentage`}
            value={bodyweightContribution.value.percentage}
          />
          {bodyweightContribution.error ? <Text allowFontScaling={false} accessibilityLiveRegion="polite"
            style={[uiText.meta, uiTextTone.danger]} testID={`${testIDPrefix}-bodyweight-error`}>{bodyweightContribution.error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: uiSpace.lg,
  },
  group: {
    gap: uiSpace.sm,
  },
  // The segments carry micro-labels, so the frame sets a field-like height.
  loadMode: {
    minHeight: uiGeometry.tapTarget,
  },
});
