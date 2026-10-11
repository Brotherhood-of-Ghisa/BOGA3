import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';

export type GroupSwitchOption = { groupId: string; name: string };

export type GroupSwitchSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  groups: GroupSwitchOption[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
  title: string;
  /** `<prefix>-sheet` on the panel, `<prefix>-<groupId>` on each row. */
  testIDPrefix: string;
};

/**
 * Picks which group a screen shows: one row per group, a check on the current
 * one. No Cancel — the backdrop dismisses it (G5).
 */
export function GroupSwitchSheet({
  visible,
  onDismiss,
  groups,
  selectedGroupId,
  onSelect,
  title,
  testIDPrefix,
}: GroupSwitchSheetProps) {
  return (
    <Sheet dismissLabel="Dismiss group switch" onDismiss={onDismiss} testID={`${testIDPrefix}-sheet`} title={title} visible={visible}>
      {groups.map((group) => (
        <ListRow
          accessibilityLabel={`${group.name}${group.groupId === selectedGroupId ? ', shown' : ''}`}
          key={group.groupId}
          label={group.name}
          onPress={() => {
            onSelect(group.groupId);
            onDismiss();
          }}
          testID={`${testIDPrefix}-${group.groupId}`}
          trailing={group.groupId === selectedGroupId ? <Icon name="check" /> : undefined}
        />
      ))}
    </Sheet>
  );
}
