import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { listTrainingNotes, type TrainingNoteView } from '@/src/data/training-notes';

export type TrainingNotesState =
  | { status: 'loading'; notes: readonly TrainingNoteView[] }
  | { status: 'ready'; notes: readonly TrainingNoteView[] }
  | { status: 'error'; notes: readonly TrainingNoteView[] };

export const TRAINING_NOTES_LOAD_ERROR = 'Couldn’t load notes.';

/**
 * Live notes, all of them or one exercise's. Read on every focus, so notes
 * sync pulled while the page was covered appear on return; a list already
 * shown stays up while it refreshes. The newest read wins.
 */
export function useTrainingNotes(exerciseId?: string) {
  const [state, setState] = useState<TrainingNotesState>({ status: 'loading', notes: [] });
  const latest = useRef(0);

  const reload = useCallback(() => {
    const request = ++latest.current;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading', notes: current.notes }));
    return listTrainingNotes(exerciseId === undefined ? {} : { exerciseId }).then(
      (notes) => {
        if (latest.current === request) setState({ status: 'ready', notes });
      },
      () => {
        if (latest.current === request) setState((current) => ({ status: 'error', notes: current.notes }));
      },
    );
  }, [exerciseId]);

  useFocusEffect(useCallback(() => {
    void reload();
  }, [reload]));

  return { state, reload };
}
