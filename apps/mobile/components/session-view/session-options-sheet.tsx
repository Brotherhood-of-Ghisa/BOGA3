import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiRoles } from '@/components/ui/tokens';

type SessionOptionsSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onAbandon: () => void;
};

// The session ⋮: a menu even while Abandon session is its only item, like the
// exercise ⋮ (build spec, decided 2026-09-22).
export function SessionOptionsSheet({ visible, onDismiss, onAbandon }: SessionOptionsSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss session options"
      onDismiss={onDismiss}
      testID="session-view-options-sheet"
      title="Session"
      visible={visible}>
      <ListRow
        label="Abandon session"
        leading={<Icon color={uiRoles.danger} name="trash" size="md" />}
        onPress={onAbandon}
        testID="session-view-abandon"
        tone="danger"
      />
    </Sheet>
  );
}
