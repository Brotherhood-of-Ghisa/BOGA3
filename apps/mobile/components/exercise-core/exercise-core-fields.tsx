import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { FormField } from '@/components/ui/form-field';
import { FormSection, InputRow } from '@/components/ui/form-section';
import { ListRow } from '@/components/ui/list-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SwitchRow } from '@/components/ui/switch-row';
import { LOAD_INPUT_MODES, LOAD_INPUT_MODE_LABELS, type LoadInputMode } from '@/src/exercise-core';

export type BodyweightContributionFieldValue = {
  percentage: string;
};

const LOAD_MODE_OPTIONS = LOAD_INPUT_MODES.map((mode) => ({
  value: mode,
  label: LOAD_INPUT_MODE_LABELS[mode],
  accessibilityLabel: `${LOAD_INPUT_MODE_LABELS[mode]} weight entry`,
}));

type ExerciseNameFieldProps = {
  name: string;
  onChangeName: (name: string) => void;
  /** The name's `validateExerciseCore` message, shown under the field. */
  nameError: string | null;
  /** testIDs: `<prefix>-name-input`, `<prefix>-name-error`. */
  testIDPrefix: string;
  editable?: boolean;
  autoFocus?: boolean;
};

/**
 * The `ExerciseCore` name: the one free-text field of an exercise form, so it
 * stands alone at the top (`ux-rules.md` "Forms"). The personal exercise
 * editor and the group exercise form both render it and validate it with
 * `validateExerciseCore` (`src/exercise-core`).
 */
export function ExerciseNameField({ name, onChangeName, nameError, testIDPrefix, editable = true, autoFocus = false }: ExerciseNameFieldProps) {
  return (
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
  );
}

type ExerciseWeightSectionProps = {
  loadInputMode: LoadInputMode;
  onChangeLoadInputMode: (mode: LoadInputMode) => void;
  /** Omitted while bodyweight calculations are off: the section is weight entry alone. */
  bodyweightContribution?: {
    value: BodyweightContributionFieldValue;
    onChange: (value: BodyweightContributionFieldValue) => void;
    error?: string | null;
  };
  /** testIDs: `<prefix>-load-mode-<mode>`, `<prefix>-uses-bodyweight`, `<prefix>-bodyweight-percentage`, `<prefix>-bodyweight-error`. */
  testIDPrefix: string;
  editable?: boolean;
};

const isPositivePercentage = (text: string) => Number.parseFloat(text.replace(',', '.')) > 0;

/**
 * What an entered Weight means: `Total load` / `Per side`, and how much of the
 * lifter's bodyweight it carries. Both change the exercise's figures, so they
 * share one section (`docs/specs/tech/bodyweight-load-contract.md` §6). The contribution sits behind
 * `Uses bodyweight`: off stores 0 (ordinary math); on starts at the stored
 * value (0 for a new exercise). A positive value always shows the switch on,
 * so a stored contribution is never hidden.
 */
export function ExerciseWeightSection({
  loadInputMode, onChangeLoadInputMode, bodyweightContribution, testIDPrefix, editable = true,
}: ExerciseWeightSectionProps) {
  // On from the start for a stored share; a positive value arriving later (a
  // form refill) turns it on too. Only the switch turns it off, so clearing
  // the share to type a new one keeps the field.
  const positive = bodyweightContribution ? isPositivePercentage(bodyweightContribution.value.percentage) : false;
  const [switchedOn, setSwitchedOn] = useState(positive);
  if (positive && !switchedOn) setSwitchedOn(true);
  const usesBodyweight = Boolean(bodyweightContribution) && switchedOn;
  const toggleBodyweight = (next: boolean) => {
    setSwitchedOn(next);
    if (!next) bodyweightContribution?.onChange({ percentage: '0' });
  };
  return (
    <FormSection
      error={bodyweightContribution?.error}
      errorTestID={`${testIDPrefix}-bodyweight-error`}
      title="Weight">
      <ListRow
        density="list"
        divider={false}
        label="Entered as"
        meta={
          <SegmentedControl
            disabled={!editable}
            layout="fit"
            onChange={onChangeLoadInputMode}
            options={LOAD_MODE_OPTIONS}
            style={styles.loadMode}
            testIDPrefix={`${testIDPrefix}-load-mode`}
            value={loadInputMode}
          />
        }
      />
      {bodyweightContribution ? (
        <SwitchRow
          density="list"
          disabled={!editable}
          divider
          label="Uses bodyweight"
          onValueChange={toggleBodyweight}
          testID={`${testIDPrefix}-uses-bodyweight`}
          value={usesBodyweight}
        />
      ) : null}
      {bodyweightContribution && usesBodyweight ? (
        <InputRow
          accessibilityLabel="Bodyweight contribution percent"
          divider
          editable={editable}
          invalid={Boolean(bodyweightContribution.error)}
          keyboardType="decimal-pad"
          label="Bodyweight share (%)"
          onChangeText={(percentage) => bodyweightContribution.onChange({ percentage })}
          testID={`${testIDPrefix}-bodyweight-percentage`}
          value={bodyweightContribution.value.percentage}
        />
      ) : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  loadMode: {
    flexShrink: 0,
  },
});
