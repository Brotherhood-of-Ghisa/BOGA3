import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, FormField, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  validateGroupDetails,
  type GroupDetailsInput,
} from '@/src/groups';

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
 * description (≤280), two `FormField`s with the description's counter in Plex
 * Mono under it. Validation errors sit under their field; the write's own
 * failure is a `danger` `Notice` above the submit, the screen's one `accent`.
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
    <View style={styles.form} testID="group-form">
      <FormField
        accessibilityLabel="Group name"
        editable={!pending}
        error={nameError}
        errorTestID="group-form-name-error"
        face="text"
        hint={`Up to ${GROUP_NAME_MAX_LENGTH} characters`}
        label="Name"
        onChangeText={setName}
        placeholder="e.g. Garage Gym"
        testID="group-form-name-input"
        value={name}
      />
      <View style={styles.field}>
        <FormField
          accessibilityLabel="Group description"
          editable={!pending}
          error={descriptionError}
          errorTestID="group-form-description-error"
          face="text"
          label="Description (optional)"
          multiline
          onChangeText={setDescription}
          placeholder="What the group is about"
          testID="group-form-description-input"
          value={description}
        />
        <Text allowFontScaling={false} style={styles.counter} testID="group-form-description-counter">
          {`${description.trim().length}/${GROUP_DESCRIPTION_MAX_LENGTH}`}
        </Text>
      </View>
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-form-error" tone="error" /> : null}
      <ActionButton
        disabled={pending}
        label={pending ? pendingLabel : submitLabel}
        onPress={submit}
        testID="group-form-submit"
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: uiSpace.md,
  },
  field: {
    gap: uiSpace.xs,
  },
  // A figure, so Plex Mono; right-aligned under the field it counts.
  counter: {
    alignSelf: 'flex-end',
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
