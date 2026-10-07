import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, FormField, SegmentedControl, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
  initialBodyweightCalculationsEnabled?: boolean;
  positiveContributionCount?: number | null;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** The failed write's message (nothing changed), shown above the submit button. */
  errorMessage: string | null;
  onSubmit: (details: GroupDetailsInput & { bodyweightCalculationsEnabled?: boolean }) => void;
};

/**
 * The shared create / edit form: name (1–50 after trimming) and an optional
 * description (≤280), two `FormField`s with the description's counter in Plex
 * Mono under it. Validation errors sit under their field; the write's own
 * failure is a `danger` `Notice` above the submit, the screen's one `accent`.
 */
type DetailsDraft = { name: string;description: string;bodyweightCalculationsEnabled: boolean };
const emptyDetailsDraft: DetailsDraft={ name: '',description: '',bodyweightCalculationsEnabled: false };
/** The owning route retains typed fields while policy refresh hides the form. */
export function useGroupDetailsDraft(initial: DetailsDraft | null) {
  const [stored,setStored]=useState(initial);
  if(stored===null && initial!==null) setStored(initial);
  const values=stored ?? initial ?? emptyDetailsDraft;
  return { ...values,setName: (name: string)=>setStored(previous=>({ ...previous ?? emptyDetailsDraft,name })),
    setDescription: (description: string)=>setStored(previous=>({ ...previous ?? emptyDetailsDraft,description })),
    setBodyweightCalculationsEnabled: (bodyweightCalculationsEnabled: boolean)=>setStored(previous=>({ ...previous ?? emptyDetailsDraft,bodyweightCalculationsEnabled })) };
}
export function GroupDetailsForm(props: GroupDetailsFormProps) {
  const draft=useGroupDetailsDraft({ name: props.initialName ?? '',description: props.initialDescription ?? '',
    bodyweightCalculationsEnabled: props.initialBodyweightCalculationsEnabled ?? false });
  return <GroupDetailsFormFields {...props} draft={draft} />;
}
export function GroupDetailsFormFields({
  initialBodyweightCalculationsEnabled,positiveContributionCount=null,submitLabel,pendingLabel,pending,errorMessage,onSubmit,draft,
}: GroupDetailsFormProps & { draft: ReturnType<typeof useGroupDetailsDraft> }) {
  const { name,description,bodyweightCalculationsEnabled,setName,setDescription,setBodyweightCalculationsEnabled }=draft;
  const [showErrors, setShowErrors] = useState(false);
  const validation = validateGroupDetails(name, description);

  const switchChanged = initialBodyweightCalculationsEnabled !== undefined &&
    bodyweightCalculationsEnabled !== initialBodyweightCalculationsEnabled;
  const submit = () => {
    setShowErrors(true);
    if (pending || (switchChanged && positiveContributionCount === null)) return;
    if (validation.valid) onSubmit({ ...validation.value,
      ...(initialBodyweightCalculationsEnabled === undefined ? {} : { bodyweightCalculationsEnabled }) });
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
      {initialBodyweightCalculationsEnabled !== undefined ? (
        <View style={styles.field}>
          <Text allowFontScaling={false} style={styles.sectionLabel}>Bodyweight calculations</Text>
          <SegmentedControl
            accessibilityLabel="Bodyweight calculations"
            disabled={pending || positiveContributionCount === null}
            onChange={(value: 'off' | 'on') => setBodyweightCalculationsEnabled(value === 'on')}
            options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
            testIDPrefix="group-form-bodyweight-calculations"
            value={bodyweightCalculationsEnabled ? 'on' : 'off'}
          />
        </View>
      ) : null}
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-form-error" tone="error" /> : null}
      <ActionButton
        disabled={pending || (switchChanged && positiveContributionCount === null)}
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
  sectionLabel: {
    color: uiRoles.inkMuted,
    fontFamily: uiFonts.display.family,
    fontSize: uiTypography.size.xxs,
    fontWeight: '700',
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    lineHeight: uiTypography.lineHeight.xxs,
    textTransform: 'uppercase',
  },
});
