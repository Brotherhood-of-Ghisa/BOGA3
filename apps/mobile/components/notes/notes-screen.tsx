import { useState } from 'react';
import { Alert } from 'react-native';

import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { removeTrainingNote, type TrainingNoteView } from '@/src/data/training-notes';
import { TRAINING_NOTES_LOAD_ERROR, useTrainingNotes, type TrainingNotesState } from '@/src/notes/use-training-notes';
import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { NoteForm } from './note-form';
import { NoteRow, noteDateLabels } from './note-row';

export const NOTE_REMOVE_ERROR = 'Couldn’t remove the note. Try again.';

type NotesScreenProps = {
  // One exercise's notes; absent, every note.
  exerciseId?: string;
};

/**
 * Training notes: the add form over the list, newest applies-from date first.
 * All notes name their exercise or `General`; one exercise's page lists and
 * adds only its own. Remove asks first, then soft-deletes.
 */
export function NotesScreen({ exerciseId }: NotesScreenProps) {
  const { state, reload } = useTrainingNotes(exerciseId);
  const dateFormat = useDateFormat();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = async (note: TrainingNoteView) => {
    setRemovingId(note.id);
    setRemoveError(null);
    try {
      await removeTrainingNote(note.id);
    } catch {
      setRemoveError(NOTE_REMOVE_ERROR);
    } finally {
      setRemovingId(null);
    }
    await reload();
  };

  const confirmRemove = (note: TrainingNoteView) => {
    Alert.alert('Remove note?', `The note from ${noteDateLabels(note.notedOn, dateFormat).spoken} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(note) },
    ]);
  };

  return (
    <ScreenScroll
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      testID="notes-screen">
      <NoteForm exerciseId={exerciseId} onSaved={() => void reload()} />
      {removeError ? <Notice live message={removeError} testID="notes-remove-error" tone="danger" /> : null}
      <NotesList
        dateFormat={dateFormat}
        onRemove={confirmRemove}
        onRetry={() => void reload()}
        removingId={removingId}
        showExercise={exerciseId === undefined}
        state={state}
      />
    </ScreenScroll>
  );
}

type NotesListProps = {
  state: TrainingNotesState;
  dateFormat: ExerciseDateFormat;
  showExercise: boolean;
  removingId: string | null;
  onRemove: (note: TrainingNoteView) => void;
  onRetry: () => void;
};

function NotesList({ state, dateFormat, showExercise, removingId, onRemove, onRetry }: NotesListProps) {
  if (state.status === 'error') {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Retry', accessibilityLabel: 'Retry loading notes', onPress: onRetry }}
          body={TRAINING_NOTES_LOAD_ERROR}
          fill={false}
          kind="error"
          testID="notes-error"
        />
      </Card>
    );
  }
  if (state.status === 'loading') {
    return (
      <Card>
        <StatePanel body="Loading notes…" fill={false} kind="loading" testID="notes-loading" />
      </Card>
    );
  }
  if (state.notes.length === 0) {
    return (
      <Card>
        <StatePanel fill={false} testID="notes-empty" title="No notes yet" />
      </Card>
    );
  }
  return (
    <Card testID="notes-list">
      {state.notes.map((note, index) => (
        <NoteRow
          dateFormat={dateFormat}
          divider={index > 0}
          key={note.id}
          note={note}
          onRemove={onRemove}
          removing={removingId === note.id}
          showExercise={showExercise}
        />
      ))}
    </Card>
  );
}
