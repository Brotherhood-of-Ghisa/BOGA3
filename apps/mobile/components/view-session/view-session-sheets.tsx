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
