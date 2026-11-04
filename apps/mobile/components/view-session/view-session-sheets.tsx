import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiRoles } from '@/components/ui/tokens';

type ViewSessionOptionsSheetProps = {
  visible: boolean;
  deleted: boolean;
  onDismiss: () => void;
  onToggleDeleted: () => void;
  onResume?: () => void;
  busy?: boolean;
  isResuming?: boolean;
};

// Resume opens the saved workout on Train. Delete/undelete remain reversible;
// deleted sessions offer only Undelete, and a pending write disables all rows.
export function ViewSessionOptionsSheet({ visible, deleted, onDismiss, onToggleDeleted, onResume, busy = false, isResuming = false }: ViewSessionOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss session options"
      onDismiss={onDismiss}
      testID="completed-session-detail-options-sheet"
      title="Session"
      visible={visible}>
      {!deleted && onResume ? (
        <ListRow
          disabled={busy}
          label={isResuming ? 'Resuming session…' : 'Resume session'}
          leading={<Icon color={uiRoles.inkMuted} name="play" size="md" />}
          onPress={onResume}
          testID="completed-session-detail-resume-button"
        />
      ) : null}
      {deleted ? (
        <ListRow disabled={busy} label="Undelete session" onPress={onToggleDeleted} testID="completed-session-detail-delete-button" />
      ) : (
        <ListRow
          disabled={busy}
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
