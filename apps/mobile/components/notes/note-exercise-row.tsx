import { useState } from 'react';

import { ExerciseSwapSheet } from '@/components/exercise-page/exercise-swap-sheet';
import { ChoiceRow } from '@/components/ui/form-section';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';

export type NoteExercise = { id: string; name: string };

type NoteExerciseRowProps = {
  // Null: a general note.
  value: NoteExercise | null;
  onChange: (value: NoteExercise | null) => void;
  disabled?: boolean;
};

/**
 * A new note's optional exercise, on the all-notes page: `General` until one is
 * chosen in the shared exercise browser, whose first row returns to `General`.
 */
export function NoteExerciseRow({ value, onChange, disabled }: NoteExerciseRowProps) {
  const [picking, setPicking] = useState(false);
  const choose = (next: NoteExercise | null) => {
    setPicking(false);
    onChange(next);
  };
  return (
    <>
      <ChoiceRow
        disabled={disabled}
        divider
        label="Exercise"
        onPress={() => setPicking(true)}
        testID="note-exercise-row"
        value={value?.name ?? 'General'}
      />
      <ExerciseSwapSheet
        currentExerciseDefinitionId=""
        notice={
          <ListRow
            label="General"
            onPress={() => choose(null)}
            selected={value === null}
            testID="note-exercise-general"
            trailing={value === null ? <Icon colorRole="accent" name="check" /> : undefined}
          />
        }
        onDismiss={() => setPicking(false)}
        onSelect={(exercise) => choose({ id: exercise.id, name: exercise.name })}
        testIDPrefix="note-exercise"
        title="Choose exercise"
        visible={picking}
      />
    </>
  );
}
