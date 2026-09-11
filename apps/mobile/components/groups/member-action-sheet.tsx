import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { UiButton, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import {
  DESTRUCTIVE_GROUP_MEMBER_ACTIONS,
  GROUP_MEMBER_ACTION_LABELS,
  GROUP_ROLE_LABELS,
  formatMemberName,
  type GroupMember,
  type GroupMemberAction,
} from '@/src/groups';

type GroupMemberActionSheetProps = {
  /** The member the sheet acts on; null hides it. */
  member: GroupMember | null;
  /** Exactly `groupMemberActionsFor(myRole, me, member)` (contract §4.3). */
  actions: GroupMemberAction[];
  onSelect: (action: GroupMemberAction, member: GroupMember) => void;
  onClose: () => void;
};

/**
 * The per-member action sheet on the group screen: an in-route bottom panel
 * offering only the actions my role allows on this member. Destructive
 * actions (Remove, Transfer) use danger styling; the caller confirms them.
 */
export function GroupMemberActionSheet({ member, actions, onSelect, onClose }: GroupMemberActionSheetProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={member !== null}>
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Dismiss member actions"
          onPress={onClose}
          style={styles.scrim}
          testID="group-member-actions-overlay"
        />
        {member ? (
          <View style={styles.panel} testID="group-member-actions-sheet">
            <UiText numberOfLines={1} variant="title">
              {formatMemberName(member.username)}
            </UiText>
            <UiText variant="subtitle">{GROUP_ROLE_LABELS[member.role]}</UiText>
            {actions.map((action) => (
              <UiButton
                key={action}
                label={GROUP_MEMBER_ACTION_LABELS[action]}
                onPress={() => onSelect(action, member)}
                testID={`group-member-action-${action}`}
                variant={DESTRUCTIVE_GROUP_MEMBER_ACTIONS.has(action) ? 'danger' : 'secondary'}
              />
            ))}
            <UiButton label="Cancel" onPress={onClose} testID="group-member-actions-cancel" variant="secondary" />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  panel: {
    gap: uiSpace.sm,
    padding: uiSpace.screen,
    paddingBottom: uiSpace.screen * 2,
    borderTopLeftRadius: uiRadius.xl,
    borderTopRightRadius: uiRadius.xl,
    backgroundColor: uiColors.surfaceDefault,
  },
});
