import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  GroupInlineError,
  GroupMemberRow,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupStreamList,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { SegmentedChips, UiSurface, UiText, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  formatMemberCount,
  formatMyRole,
  getGroup,
  groupCacheKeys,
  useGroupResource,
  useGroupStream,
  type GroupGetResult,
} from '@/src/groups';

type GroupScreenSegment = 'stream' | 'members';

const SEGMENT_OPTIONS = [
  { value: 'stream', label: 'Stream' },
  { value: 'members', label: 'Members' },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** The group screen (groups contract §6.3): header, then Stream and Members. Read-only in M22-T04. */
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

  const refreshGroup = group.refresh;
  const refreshStream = stream.refresh;
  const refreshAll = useCallback(() => Promise.all([refreshGroup(), refreshStream()]), [refreshGroup, refreshStream]);
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

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
        {/* M22-T05 adds the role-gated Edit / Invite / Leave actions here. */}
      </View>
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
            <GroupMemberRow isMe={member.user_id === userId} key={member.user_id} member={member} />
          ))}
        </UiSurface>
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
