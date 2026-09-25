import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { LOAD_INPUT_MODES, LOAD_INPUT_MODE_LABELS, type LoadInputMode } from '@/src/exercise-core';

type ExerciseCoreFieldsProps = {
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
 * The `ExerciseCore` fields (M25 design T1): the exercise name and the
 * `Total load` / `Per side` weight entry. The personal exercise editor and the
 * group exercise form render these same fields and validate them with
 * `validateExerciseCore` (`src/exercise-core`). A `FormField` for the name and
 * a `SegmentedControl` for the weight entry (DLM-T07).
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
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
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
        <Text allowFontScaling={false} style={styles.helperText}>
          Choose whether the weight you enter is shared across both sides or already represents one side.
        </Text>
      </View>
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
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // The segments carry micro-labels, so the frame sets a field-like height.
  loadMode: {
    minHeight: uiGeometry.tapTarget,
  },
  helperText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
