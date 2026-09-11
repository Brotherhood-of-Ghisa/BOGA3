import { Pressable, StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { GROUP_ROLE_LABELS, formatMemberName, type GroupMember } from '@/src/groups';

type GroupMemberRowProps = {
  member: GroupMember;
  isMe: boolean;
  /** Set only when my role offers actions on this member: the row then opens the action sheet. */
  onPress?: (member: GroupMember) => void;
};

/** One Members-segment row: name (+ "you") and a role badge; pressable when it has actions. */
export function GroupMemberRow({ member, isMe, onPress }: GroupMemberRowProps) {
  const name = isMe ? `${formatMemberName(member.username)} (you)` : formatMemberName(member.username);
  const content = (
    <>
      <UiText numberOfLines={1} style={styles.name} variant="label">
        {name}
      </UiText>
      <View style={styles.badge}>
        <UiText testID={`group-member-role-${member.user_id}`} variant="subtitle">
          {GROUP_ROLE_LABELS[member.role]}
        </UiText>
      </View>
      {onPress ? (
        <UiText style={styles.chevron} variant="label">
          ›
        </UiText>
      ) : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} testID={`group-member-row-${member.user_id}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Opens member actions"
      accessibilityLabel={`${name}, ${GROUP_ROLE_LABELS[member.role]}`}
      accessibilityRole="button"
      onPress={() => onPress(member)}
      style={styles.row}
      testID={`group-member-row-${member.user_id}`}>
      {content}
    </Pressable>
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
  chevron: {
    color: uiColors.textSecondary,
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
