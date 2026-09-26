import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { LOAD_INPUT_MODES, LOAD_INPUT_MODE_LABELS, type LoadInputMode } from '@/src/exercise-core';

export type ExerciseLoadFieldsValue = {
  percentage: string;
  movementStandard: string;
  loadingMethod: string;
};

type ExerciseCoreFieldsProps = {
  loadRules?: {
    value: ExerciseLoadFieldsValue;
    onChange: (value: ExerciseLoadFieldsValue) => void;
    error?: string | null;
    metadataKnown?: boolean;
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
  loadRules,
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
      {loadRules ? (
        <View style={styles.group}>
          <FormField
            accessibilityLabel="Bodyweight contribution percent"
            editable={editable}
            face="figure"
            keyboardType="decimal-pad"
            label="Bodyweight contribution (%)"
            onChangeText={(percentage) => loadRules.onChange({ ...loadRules.value, percentage })}
            testID={`${testIDPrefix}-bodyweight-percentage`}
            value={loadRules.value.percentage}
          />
          {loadRules.metadataKnown === false ? (
            <Text allowFontScaling={false} style={styles.helperText}>
              Saved load settings have not synced yet. Leave these fields unchanged to preserve them, or configure them explicitly.
            </Text>
          ) : null}
          <Text allowFontScaling={false} style={styles.helperText}>
            0% uses external weight only. A bodyweight exercise uses this share of the weight saved on each session, plus added weight or minus assistance.
          </Text>
          {(Number(loadRules.value.percentage) > 0 || loadRules.value.movementStandard || loadRules.value.loadingMethod) ? (
            <>
              <FormField accessibilityLabel="Movement standard" editable={editable} face="text"
                label="Movement standard" placeholder="e.g. Standard floor push-up"
                onChangeText={(movementStandard) => loadRules.onChange({ ...loadRules.value, movementStandard })}
                testID={`${testIDPrefix}-movement-standard`} value={loadRules.value.movementStandard} />
              <FormField accessibilityLabel="Loading method" editable={editable} face="text"
                label="Loading method" placeholder="e.g. Vest"
                onChangeText={(loadingMethod) => loadRules.onChange({ ...loadRules.value, loadingMethod })}
                testID={`${testIDPrefix}-loading-method`} value={loadRules.value.loadingMethod} />
              <Text allowFontScaling={false} style={styles.helperText}>
                Percentages and added mass are accounting approximations. Per side applies only to equal external loads on both sides. Use a separate exercise for a different movement.
              </Text>
            </>
          ) : null}
          <Text allowFontScaling={false} style={styles.helperText}>
            Changes recalculate personal history using each session’s saved weight. Group rules stay unchanged. Old loads require review before bodyweight calculations can use them.
          </Text>
          {loadRules.error ? <Text allowFontScaling={false} accessibilityLiveRegion="polite"
            style={styles.errorText} testID={`${testIDPrefix}-bodyweight-error`}>{loadRules.error}</Text> : null}
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
  errorText: {
    color: uiRoles.danger,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
  helperText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
