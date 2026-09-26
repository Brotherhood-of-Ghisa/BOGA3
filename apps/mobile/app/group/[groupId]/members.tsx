import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  GroupHeaderCard,
  GroupInlineError,
  GroupLostAccessState,
  GroupMemberActionSheet,
  GroupMemberRow,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupWriteNotice,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { ActionButton, Card, uiFonts, uiRoles, uiTypography } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  OWNER_LEAVE_NOTICE,
  canLeaveGroup,
  describeGroupWriteError,
  evictGroupFromDevice,
  formatMemberCount,
  formatMyRole,
  getGroup,
  groupCacheKeys,
  groupMemberActionConfirmation,
  groupMemberActionSuccessMessage,
  groupMemberActionsFor,
  leaveGroup,
  removeGroupMember,
  setGroupMemberRole,
  transferGroupOwnership,
  useGroupAction,
  useGroupResource,
  type GroupGetResult,
  type GroupMember,
  type GroupMemberAction,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

type Feedback = { tone: 'error' | 'success'; message: string };

/** One §4.3 member write. Each resolves the post-write `group_get` payload. */
const runMemberWrite = (groupId: string, action: GroupMemberAction, userId: string) => {
  switch (action) {
    case 'make-admin':
      return setGroupMemberRole(groupId, userId, 'admin');
    case 'remove-admin':
      return setGroupMemberRole(groupId, userId, 'member');
    case 'transfer-ownership':
      return transferGroupOwnership(groupId, userId);
    case 'remove':
      return removeGroupMember(groupId, userId);
  }
};

/**
 * The Members screen (product D14; groups contract §6.3), opened from the
 * group header's member count: the header card, members in server order as
 * one `Card` of rows, the per-member action sheet (§4.3 role matrix), and Leave
 * (an outline in `danger`) or the owner's transfer notice.
 */
export default function GroupMembersRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return <LostAccessState />;
  }
  return <GroupMembersContent groupId={groupId} userId={user.id} />;
}

function LostAccessState() {
  return (
    <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
      <GroupLostAccessState testID="group-members-lost-access" />
    </View>
  );
}

function GroupMembersContent({ userId, groupId }: { userId: string; groupId: string }) {
  const router = useRouter();
  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const [sheetMember, setSheetMember] = useState<GroupMember | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const memberWrite = useGroupAction(runMemberWrite);
  const leave = useGroupAction(leaveGroup);
  const refreshGroup = group.refresh;
  const { pulling, onRefresh } = usePullToRefresh(refreshGroup);

  const performMemberAction = async (action: GroupMemberAction, member: GroupMember) => {
    setFeedback(null);
    const result = await memberWrite.run(groupId, action, member.user_id);
    if (result.ok) {
      setFeedback({ tone: 'success', message: groupMemberActionSuccessMessage(action, member) });
      void refreshGroup();
      return;
    }
    setFeedback({ tone: 'error', message: describeGroupWriteError(result.error) });
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
      void refreshGroup();
    }
  };

  const onSelectMemberAction = (action: GroupMemberAction, member: GroupMember) => {
    setSheetMember(null);
    const confirmation = groupMemberActionConfirmation(action, member);
    if (!confirmation) {
      void performMemberAction(action, member);
      return;
    }
    Alert.alert(confirmation.title, confirmation.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmation.confirmLabel, style: 'destructive', onPress: () => void performMemberAction(action, member) },
    ]);
  };

  const performLeave = async () => {
    setFeedback(null);
    const result = await leave.run(groupId);
    if (result.ok) {
      await evictGroupFromDevice(groupId);
      // Back to the Groups tab, whose focus refresh drops this group from the chips and My groups.
      router.dismissTo('/groups');
      return;
    }
    setFeedback({ tone: 'error', message: describeGroupWriteError(result.error) });
  };

  if (group.lostAccess) {
    return <LostAccessState />;
  }

  const data = group.data;
  const inlineError = pickInlineError(group.error);
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;

  if (!data) {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        <GroupMissingDataState error={inlineError} offline={group.offline} onRetry={onRefresh} testIDPrefix="group-members" />
      </ScrollView>
    );
  }

  const summary = data.group;
  const confirmLeave = () => {
    Alert.alert(`Leave ${summary.name}?`, "You'll stop seeing its stream. Sessions you already shared stay in the group.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => void performLeave() },
    ]);
  };
  const sheetActions = sheetMember ? groupMemberActionsFor(summary.my_role, userId, sheetMember) : [];

  return (
    <ScrollView
      contentContainerStyle={groupScreenStyles.content}
      refreshControl={refreshControl}
      style={groupScreenStyles.screen}
      testID="group-members-screen">
      <GroupHeaderCard
        meta={`${formatMemberCount(summary.member_count)} · ${formatMyRole(summary.my_role)}`}
        metaTestID="group-members-meta"
        name={summary.name}
      />
      {feedback ? <GroupWriteNotice message={feedback.message} testID="group-members-action-feedback" tone={feedback.tone} /> : null}
      {group.offline ? <GroupOfflineBanner lastUpdatedAtMs={group.lastUpdatedAtMs} /> : null}
      {inlineError ? <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-members-inline-error" /> : null}
      <Card testID="group-members-list">
        {/* Server order: owner, admins, members, then username (contract §4.2). */}
        {data.members.map((member, index) => (
          <GroupMemberRow
            divider={index > 0}
            isMe={member.user_id === userId}
            key={member.user_id}
            member={member}
            onPress={
              !memberWrite.pending && groupMemberActionsFor(summary.my_role, userId, member).length > 0
                ? setSheetMember
                : undefined
            }
          />
        ))}
      </Card>
      {canLeaveGroup(summary.my_role) ? (
        <ActionButton
          disabled={leave.pending}
          label={leave.pending ? 'Leaving…' : 'Leave group'}
          onPress={confirmLeave}
          testID="group-members-leave-button"
          tone="danger"
          variant="outline"
        />
      ) : (
        <Text allowFontScaling={false} style={styles.note} testID="group-members-owner-leave-notice">
          {`${OWNER_LEAVE_NOTICE}. Open a member to make them the owner.`}
        </Text>
      )}
      <GroupMemberActionSheet
        actions={sheetActions}
        member={sheetMember}
        onClose={() => setSheetMember(null)}
        onSelect={onSelectMemberAction}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
