import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';

type SessionOptionsSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onAbandon: () => void;
  onCompare: () => void;
};

// The session ⋮: Session vs history, then Abandon session.
export function SessionOptionsSheet({ visible, onDismiss, onAbandon, onCompare }: SessionOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss session options"
      onDismiss={onDismiss}
      testID="session-view-options-sheet"
      title="Session"
      visible={visible}>
      <ListRow
        label="Session vs history"
        leading={<Icon colorRole="inkMuted" name="list" size="md" />}
        onPress={onCompare}
        testID="session-view-compare"
        trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
      />
      <ListRow
        divider
        label="Abandon session"
        leading={<Icon colorRole="danger" name="trash" size="md" />}
        onPress={onAbandon}
        testID="session-view-abandon"
        tone="danger"
      />
    </Sheet>
  );
}
