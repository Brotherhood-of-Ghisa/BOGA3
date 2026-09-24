import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiRoles } from '@/components/ui/tokens';

type ViewSessionOptionsSheetProps = {
  visible: boolean;
  deleted: boolean;
  onDismiss: () => void;
  onToggleDeleted: () => void;
};

// The session ⋮: `Delete session` (a soft delete, hidden from history), or
// `Undelete session` while it is deleted. Neither confirms — each undoes the
// other, and the deleted band says which state the session is in.
export function ViewSessionOptionsSheet({ visible, deleted, onDismiss, onToggleDeleted }: ViewSessionOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss session options"
      onDismiss={onDismiss}
      testID="completed-session-detail-options-sheet"
      title="Session"
      visible={visible}>
      {deleted ? (
        <ListRow label="Undelete session" onPress={onToggleDeleted} testID="completed-session-detail-delete-button" />
      ) : (
        <ListRow
          label="Delete session"
          leading={<Icon color={uiRoles.danger} name="trash" size="md" />}
          onPress={onToggleDeleted}
          testID="completed-session-detail-delete-button"
          tone="danger"
        />
      )}
    </Sheet>
  );
}

type ViewSessionExerciseSheetProps = {
  // The exercise the sheet is open on; `null` hides it.
  exercise: { id: string; name: string } | null;
  onDismiss: () => void;
  onAppend: (sessionExerciseId: string) => void;
};

// An exercise's ⋮: `Append to current session` copies its sets into the
// active session as planned rows. An edge case, so it lives behind the ⋮.
export function ViewSessionExerciseSheet({ exercise, onDismiss, onAppend }: ViewSessionExerciseSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss exercise options"
      onDismiss={onDismiss}
      testID="completed-session-detail-exercise-sheet"
      title={exercise?.name}
      visible={exercise !== null}>
      {exercise ? (
        <ListRow
          accessibilityLabel={`Append ${exercise.name || 'exercise'} block to current session`}
          label="Append to current session"
          leading={<Icon color={uiRoles.ink} name="plus" size="md" />}
          onPress={() => onAppend(exercise.id)}
          testID={`completed-session-detail-append-exercise-button-${exercise.id}`}
        />
      ) : null}
    </Sheet>
  );
}
