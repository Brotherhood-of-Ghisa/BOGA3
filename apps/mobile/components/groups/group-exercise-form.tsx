import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton, Card, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { validateExerciseCore, type ExerciseCore, type LoadInputMode } from '@/src/exercise-core';

import { GroupWriteNotice } from './write-notice';

type GroupExerciseFormProps = {
  /** Prefill (a standard copy or the exercise being renamed); followed until the user edits. Remount with a new `key` to reset. */
  initialCore?: ExerciseCore;
  /** A line above the fields, e.g. which standard exercise this copies. */
  note?: string | null;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** The failed write's message (nothing changed), shown above the submit button. */
  errorMessage: string | null;
  onSubmit: (core: ExerciseCore) => void;
};

const EMPTY_CORE: ExerciseCore = { name: '', loadInputMode: 'total_load' };

/**
 * The owner/admin group exercise form: a `Card` holding the shared
 * `ExerciseCoreFields`, validated with `validateExerciseCore` before any request
 * (the same rules as the personal editor and the server). Its submit is the
 * screen's one `accent`.
 */
export function GroupExerciseForm({
  initialCore = EMPTY_CORE,
  note = null,
  submitLabel,
  pendingLabel,
  pending,
  errorMessage,
  onSubmit,
}: GroupExerciseFormProps) {
  const [name, setName] = useState(initialCore.name);
  const [loadInputMode, setLoadInputMode] = useState<LoadInputMode>(initialCore.loadInputMode);
  const [showErrors, setShowErrors] = useState(false);
  // Until the user edits, follow the prefill: a fresher server read that lands
  // after the cached render replaces it, so Save never sends stale fields.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setName(initialCore.name);
      setLoadInputMode(initialCore.loadInputMode);
    }
  }, [dirty, initialCore.name, initialCore.loadInputMode]);
  const validation = validateExerciseCore({ name, loadInputMode });
  const nameError = showErrors && !validation.ok && validation.issue === 'name_required' ? validation.message : null;

  const submit = () => {
    setShowErrors(true);
    if (validation.ok) onSubmit(validation.value);
  };

  return (
    <Card style={styles.card} testID="group-exercise-form">
      {note ? (
        <Text allowFontScaling={false} style={styles.note} testID="group-exercise-form-note">
          {note}
        </Text>
      ) : null}
      <ExerciseCoreFields
        editable={!pending}
        loadInputMode={loadInputMode}
        name={name}
        nameError={nameError}
        onChangeLoadInputMode={(mode) => {
          setDirty(true);
          setLoadInputMode(mode);
        }}
        onChangeName={(next) => {
          setDirty(true);
          setName(next);
        }}
        testIDPrefix="group-exercise-form"
      />
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-exercise-form-error" tone="error" /> : null}
      <ActionButton
        disabled={pending}
        label={pending ? pendingLabel : submitLabel}
        onPress={submit}
        testID="group-exercise-form-submit"
        variant="primary"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  note: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
