import { useEffect, useState } from 'react';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { UiButton, UiSurface, UiText } from '@/components/ui';
import { validateExerciseCore, type ExerciseCore, type LoadInputMode } from '@/src/exercise-core';

import { groupFormStyles } from './screen-styles';
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
 * The owner/admin group exercise form: the shared `ExerciseCoreFields`,
 * validated with `validateExerciseCore` before any request (the same rules as
 * the personal editor and the server).
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
    <UiSurface style={groupFormStyles.card} testID="group-exercise-form">
      {note ? (
        <UiText testID="group-exercise-form-note" variant="bodyMuted">
          {note}
        </UiText>
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
      <UiButton
        disabled={pending}
        label={pending ? pendingLabel : submitLabel}
        onPress={submit}
        testID="group-exercise-form-submit"
      />
    </UiSurface>
  );
}
