import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors } from '@/components/ui';
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  validateGroupDetails,
  type GroupDetailsInput,
} from '@/src/groups';

import { groupFormStyles } from './screen-styles';
import { GroupWriteNotice } from './write-notice';

type GroupDetailsFormProps = {
  initialName?: string;
  initialDescription?: string | null;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** The failed write's message (nothing changed), shown above the submit button. */
  errorMessage: string | null;
  onSubmit: (details: GroupDetailsInput) => void;
};

/**
 * The shared create / edit form: name (1–50 after trimming) and an optional
 * description (≤280). Validation errors sit next to their field; the write's
 * own failure shows above the submit button.
 */
export function GroupDetailsForm({
  initialName = '',
  initialDescription = null,
  submitLabel,
  pendingLabel,
  pending,
  errorMessage,
  onSubmit,
}: GroupDetailsFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const validation = validateGroupDetails(name, description);

  const submit = () => {
    setShowErrors(true);
    if (validation.valid) onSubmit(validation.value);
  };

  const nameError = showErrors ? validation.errors.name : undefined;
  const descriptionError = showErrors ? validation.errors.description : undefined;

  return (
    <UiSurface style={groupFormStyles.card} testID="group-form">
      <View style={groupFormStyles.field}>
        <UiText variant="subtitle">{`Name (up to ${GROUP_NAME_MAX_LENGTH} characters)`}</UiText>
        <TextInput
          accessibilityLabel="Group name"
          editable={!pending}
          onChangeText={setName}
          placeholder="e.g. Garage Gym"
          placeholderTextColor={uiColors.textDisabled}
          style={groupFormStyles.input}
          testID="group-form-name-input"
          value={name}
        />
        {nameError ? (
          <UiText style={groupFormStyles.fieldError} testID="group-form-name-error" variant="label">
            {nameError}
          </UiText>
        ) : null}
      </View>
      <View style={groupFormStyles.field}>
        <UiText variant="subtitle">Description (optional)</UiText>
        <TextInput
          accessibilityLabel="Group description"
          editable={!pending}
          multiline
          onChangeText={setDescription}
          placeholder="What the group is about"
          placeholderTextColor={uiColors.textDisabled}
          style={[groupFormStyles.input, groupFormStyles.multiline]}
          testID="group-form-description-input"
          value={description}
        />
        <UiText variant="subtitle">{`${description.trim().length}/${GROUP_DESCRIPTION_MAX_LENGTH}`}</UiText>
        {descriptionError ? (
          <UiText style={groupFormStyles.fieldError} testID="group-form-description-error" variant="label">
            {descriptionError}
          </UiText>
        ) : null}
      </View>
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-form-error" tone="error" /> : null}
      <UiButton
        disabled={pending}
        label={pending ? pendingLabel : submitLabel}
        onPress={submit}
        testID="group-form-submit"
      />
    </UiSurface>
  );
}
