import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';

import {
  GroupInlineError,
  GroupMemberActionSheet,
  GroupMemberRow,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupStreamList,
  GroupWriteNotice,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { SegmentedChips, UiButton, UiSurface, UiText, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  OWNER_LEAVE_NOTICE,
  canLeaveGroup,
  canManageGroup,
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
  useGroupStream,
  type GroupGetResult,
  type GroupMember,
  type GroupMemberAction,
} from '@/src/groups';

type GroupScreenSegment = 'stream' | 'members';

const SEGMENT_OPTIONS = [
  { value: 'stream', label: 'Stream' },
  { value: 'members', label: 'Members' },
] as const;

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
 * The group screen (groups contract §6.3): header with the role-gated Invite /
 * Edit actions, then Stream and Members. Member rows open the per-member
 * action sheet (§4.3 role matrix); Leave sits under the member list.
 */
export default function GroupScreenRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return <LostAccessState />;
  }
  return <GroupScreenContent groupId={groupId} userId={user.id} />;
}

function LostAccessState() {
  return (
    <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
      <GroupStateView
        body="Its stream and members are no longer available to you."
        testID="group-screen-lost-access"
        title="You're no longer a member of this group"
      />
    </View>
  );
}

function GroupScreenContent({ userId, groupId }: { userId: string; groupId: string }) {
  const router = useRouter();
  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const stream = useGroupStream({ userId, groupId });
  const [segment, setSegment] = useState<GroupScreenSegment>('stream');
  const [sheetMember, setSheetMember] = useState<GroupMember | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const memberWrite = useGroupAction(runMemberWrite);
  const leave = useGroupAction(leaveGroup);

  const refreshGroup = group.refresh;
  const refreshStream = stream.refresh;
  const refreshAll = useCallback(() => Promise.all([refreshGroup(), refreshStream()]), [refreshGroup, refreshStream]);
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

  const performMemberAction = async (action: GroupMemberAction, member: GroupMember) => {
    setFeedback(null);
    const result = await memberWrite.run(groupId, action, member.user_id);
    if (result.ok) {
      setFeedback({ tone: 'success', message: groupMemberActionSuccessMessage(action, member) });
      // The list updates in place; the stream picks up "X was removed".
      void refreshAll();
      return;
    }
    setFeedback({ tone: 'error', message: describeGroupWriteError(result.error) });
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
      void refreshAll();
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

  // C3.6.8: after removal, hide everything cached (the hook already evicted it).
  if (group.lostAccess || stream.lostAccess) {
    return <LostAccessState />;
  }

  const data = group.data;
  const offline = group.offline || stream.offline;
  const inlineError = pickInlineError(group.error, stream.error);
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;

  if (!data) {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRefresh} testIDPrefix="group-screen" />
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

  const header = (
    <View style={groupScreenStyles.header}>
      <Stack.Screen options={{ title: summary.name }} />
      <View style={{ gap: uiSpace.xs }} testID="group-screen-header">
        <UiText testID="group-screen-name" variant="title">
          {summary.name}
        </UiText>
        {summary.description ? <UiText variant="bodyMuted">{summary.description}</UiText> : null}
        <UiText testID="group-screen-meta" variant="subtitle">
          {`${formatMemberCount(summary.member_count)} · ${formatMyRole(summary.my_role)}`}
        </UiText>
        {canManageGroup(summary.my_role) ? (
          <View style={[groupScreenStyles.actionRow, { marginTop: uiSpace.sm }]}>
            {/* Invite is the prominent action for owners and admins (C3.3.2); members never see it (C7.4). */}
            <UiButton
              label="Invite"
              onPress={() => router.push(`/group/${groupId}/invite`)}
              style={groupScreenStyles.actionRowItem}
              testID="group-screen-invite-button"
            />
            <UiButton
              label="Edit"
              onPress={() => router.push(`/group/${groupId}/edit`)}
              style={groupScreenStyles.actionRowItem}
              testID="group-screen-edit-button"
              variant="secondary"
            />
          </View>
        ) : null}
      </View>
      {feedback ? <GroupWriteNotice message={feedback.message} testID="group-screen-action-feedback" tone={feedback.tone} /> : null}
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={group.lastUpdatedAtMs} /> : null}
      {inlineError ? <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-screen-inline-error" /> : null}
      <SegmentedChips
        onChange={setSegment}
        options={SEGMENT_OPTIONS}
        testIDPrefix="group-screen-segment"
        value={segment}
        variant="joined"
      />
    </View>
  );

  if (segment === 'members') {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        {header}
        <UiSurface style={{ paddingHorizontal: uiSpace.lg }} testID="group-screen-members">
          {/* Server order: owner, admins, members, then username (contract §4.2). */}
          {data.members.map((member) => (
            <GroupMemberRow
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
        </UiSurface>
        {canLeaveGroup(summary.my_role) ? (
          <UiButton
            disabled={leave.pending}
            label={leave.pending ? 'Leaving…' : 'Leave group'}
            onPress={confirmLeave}
            testID="group-screen-leave-button"
            variant="danger"
          />
        ) : (
          <UiText testID="group-screen-owner-leave-notice" variant="bodyMuted">
            {`${OWNER_LEAVE_NOTICE}. Open a member to make them the owner.`}
          </UiText>
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

  return (
    <GroupStreamList
      emptyState={
        stream.data ? (
          <GroupStateView testID="group-screen-stream-empty" title="Nothing here yet" />
        ) : (
          <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRefresh} testIDPrefix="group-screen-stream" />
        )
      }
      header={header}
      onPressSession={(card) => router.push(`/group-session/${card.memberUserId}/${card.sessionId}`)}
      onRefresh={onRefresh}
      pulling={pulling}
      showGroupNames={false}
      stream={stream}
      testID="group-screen-stream-list"
    />
  );
}
