import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { FormField } from '@/components/ui/form-field';
import { FormError, FormSection } from '@/components/ui/form-section';
import { uiSpace } from '@/components/ui/tokens';
import {
  addTrainingNote,
  toLocalDateKey,
  TRAINING_NOTE_MAX_LENGTH,
  TrainingNoteInputError,
} from '@/src/data/training-notes';
import { NoteDateRow } from './note-date-row';
import { NoteExerciseRow, type NoteExercise } from './note-exercise-row';

export const NOTE_SAVE_ERROR = 'Couldn’t save the note. Try again.';

type NoteFormProps = {
  // One exercise's page attaches every note to it; absent, the note is general
  // unless an exercise is chosen.
  exerciseId?: string;
  onSaved: () => void;
};

const saveErrorMessage = (error: unknown): string =>
  error instanceof TrainingNoteInputError ? error.message : NOTE_SAVE_ERROR;

/**
 * Add a note: its date (today by default, never later), the exercise on the
 * all-notes page, the text, Save. The repository's validation message shows
 * under the form; a saved note clears it for the next one.
 */
export function NoteForm({ exerciseId, onSaved }: NoteFormProps) {
  const [notedOn, setNotedOn] = useState(() => toLocalDateKey(new Date()));
  const [exercise, setExercise] = useState<NoteExercise | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await addTrainingNote({ body, notedOn, exerciseId: exerciseId ?? exercise?.id ?? null });
      Keyboard.dismiss();
      setBody('');
      setExercise(null);
      setNotedOn(toLocalDateKey(new Date()));
      onSaved();
    } catch (saveError) {
      setError(saveErrorMessage(saveError));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.form} testID="note-form">
      <FormSection title="New note">
        <NoteDateRow disabled={saving} onChange={setNotedOn} value={notedOn} />
        {exerciseId === undefined ? (
          <NoteExerciseRow disabled={saving} onChange={setExercise} value={exercise} />
        ) : null}
      </FormSection>
      <FormField
        accessibilityLabel="Note"
        editable={!saving}
        face="text"
        label="Note"
        maxLength={TRAINING_NOTE_MAX_LENGTH}
        multiline
        onChangeText={setBody}
        testID="note-form-body"
        value={body}
      />
      <FormError message={error} testID="note-form-error" />
      <ActionButton
        disabled={saving}
        label={saving ? 'Saving…' : 'Save note'}
        onPress={() => {
          void save();
        }}
        testID="note-form-save"
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: uiSpace.md,
  },
});
