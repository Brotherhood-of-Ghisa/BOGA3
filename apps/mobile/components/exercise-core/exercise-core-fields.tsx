import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { uiColors } from '@/components/ui';
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

/**
 * The `ExerciseCore` fields (M25 design T1): the exercise name and the
 * `Total load` / `Per side` weight entry. The personal exercise editor and the
 * group exercise form render these same fields and validate them with
 * `validateExerciseCore` (`src/exercise-core`).
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
      <Text style={styles.fieldLabel}>Exercise name</Text>
      <TextInput
        accessibilityLabel="Exercise definition name"
        testID={`${testIDPrefix}-name-input`}
        autoFocus={autoFocus}
        autoCorrect={false}
        editable={editable}
        multiline={false}
        numberOfLines={1}
        placeholder="Exercise name"
        scrollEnabled
        style={[styles.input, styles.nameInput, nameError ? styles.inputError : null]}
        value={name}
        onChangeText={onChangeName}
      />
      {nameError ? (
        <Text selectable style={styles.errorText} testID={`${testIDPrefix}-name-error`}>
          {nameError}
        </Text>
      ) : null}

      <Text style={styles.fieldLabel}>Weight entry</Text>
      <View style={styles.loadModeRow}>
        {LOAD_INPUT_MODES.map((mode) => {
          const label = LOAD_INPUT_MODE_LABELS[mode];
          const selected = loadInputMode === mode;
          return (
            <Pressable
              key={mode}
              accessibilityLabel={`${label} weight entry`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={!editable}
              testID={`${testIDPrefix}-load-mode-${mode}`}
              style={[styles.loadModeButton, selected ? styles.loadModeButtonSelected : null]}
              onPress={() => onChangeLoadInputMode(mode)}>
              <Text style={[styles.loadModeButtonText, selected ? styles.loadModeButtonTextSelected : null]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.helperText}>
        Choose whether the weight you enter is shared across both sides or already represents one side.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  nameInput: {
    height: 42,
    overflow: 'hidden',
  },
  inputError: {
    borderColor: uiColors.actionDanger,
  },
  helperText: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  errorText: {
    fontSize: 13,
    color: uiColors.actionDanger,
    fontWeight: '500',
  },
  loadModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  loadModeButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
  },
  loadModeButtonSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  loadModeButtonText: {
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
  loadModeButtonTextSelected: {
    color: uiColors.actionPrimary,
  },
});
