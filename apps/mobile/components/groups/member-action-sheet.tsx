import {
  DESTRUCTIVE_GROUP_MEMBER_ACTIONS,
  GROUP_MEMBER_ACTION_LABELS,
  GROUP_ROLE_LABELS,
  formatMemberName,
  type GroupMember,
  type GroupMemberAction,
} from '@/src/groups';

import { GroupActionSheet } from './group-action-sheet';

type GroupMemberActionSheetProps = {
  /** The member the sheet acts on; null hides it. */
  member: GroupMember | null;
  /** Exactly `groupMemberActionsFor(myRole, me, member)` (contract §4.3). */
  actions: GroupMemberAction[];
  onSelect: (action: GroupMemberAction, member: GroupMember) => void;
  onClose: () => void;
};

/**
 * The per-member action sheet on the Members screen: only the actions my role
 * allows on this member. Destructive actions (Remove, Transfer) use danger
 * styling; the caller confirms them.
 */
export function GroupMemberActionSheet({ member, actions, onSelect, onClose }: GroupMemberActionSheetProps) {
  return (
    <GroupActionSheet
      actionTestIDPrefix="group-member-action"
      actions={actions.map((action) => ({
        key: action,
        label: GROUP_MEMBER_ACTION_LABELS[action],
        destructive: DESTRUCTIVE_GROUP_MEMBER_ACTIONS.has(action),
      }))}
      dismissLabel="Dismiss member actions"
      onClose={onClose}
      onSelect={(action) => {
        if (member) onSelect(action, member);
      }}
      subtitle={member ? GROUP_ROLE_LABELS[member.role] : undefined}
      testIDPrefix="group-member-actions"
      title={member ? formatMemberName(member.username) : ''}
      visible={member !== null}
    />
  );
}
