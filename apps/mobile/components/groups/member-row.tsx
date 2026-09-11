import { StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { GROUP_ROLE_LABELS, formatMemberName, type GroupMember } from '@/src/groups';

/** One Members-segment row: name (+ "you") and a role badge. Read-only in M22-T04. */
export function GroupMemberRow({ member, isMe }: { member: GroupMember; isMe: boolean }) {
  return (
    <View style={styles.row} testID={`group-member-row-${member.user_id}`}>
      <UiText numberOfLines={1} style={styles.name} variant="label">
        {isMe ? `${formatMemberName(member.username)} (you)` : formatMemberName(member.username)}
      </UiText>
      <View style={styles.badge}>
        <UiText testID={`group-member-role-${member.user_id}`} variant="subtitle">
          {GROUP_ROLE_LABELS[member.role]}
        </UiText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  badge: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xxs,
  },
});
