import { View } from 'react-native';

import { Icon, ListRow, Tag, uiRoles } from '@/components/ui';
import { GROUP_ROLE_LABELS, formatMemberName, type GroupMember } from '@/src/groups';

type GroupMemberRowProps = {
  member: GroupMember;
  isMe: boolean;
  /** Set only when my role offers actions on this member: the row then opens the action sheet. */
  onPress?: (member: GroupMember) => void;
  /** A hairline above the row: every row but the card's first. */
  divider: boolean;
};

/**
 * One Members-screen row, a dense `ListRow` in the members `Card`: the name (+
 * "(you)") and the role as a `Tag`; a chevron only when it opens actions. The
 * control column is kept empty otherwise, so the tags stay on one axis.
 */
export function GroupMemberRow({ member, isMe, onPress, divider }: GroupMemberRowProps) {
  const name = isMe ? `${formatMemberName(member.username)} (you)` : formatMemberName(member.username);
  const role = GROUP_ROLE_LABELS[member.role];
  return (
    <ListRow
      accessibilityHint={onPress ? 'Opens member actions' : undefined}
      accessibilityLabel={onPress ? `${name}, ${role}` : undefined}
      density="list"
      divider={divider}
      label={name}
      meta={
        // The Tag sets its own `alignSelf: flex-start`; the wrapper centres it in the row.
        <View>
          <Tag label={role} testID={`group-member-role-${member.user_id}`} />
        </View>
      }
      onPress={onPress ? () => onPress(member) : undefined}
      testID={`group-member-row-${member.user_id}`}
      trailing={onPress ? <Icon color={uiRoles.inkMuted} name="chevron-right" /> : null}
    />
  );
}
