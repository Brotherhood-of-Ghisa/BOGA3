import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  GroupExercisesPage,
  GroupInlineError,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupStateView,
  GroupStreamList,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { SegmentedChips, UiButton, UiText, uiColors, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  canManageGroup,
  formatMemberCount,
  formatMyRole,
  getGroup,
  groupCacheKeys,
  listGroupExercises,
  useGroupResource,
  useGroupStream,
  type GroupExerciseListResult,
  type GroupGetResult,
} from '@/src/groups';

type GroupScreenSegment = 'stream' | 'exercises' | 'leaderboards';

const SEGMENT_OPTIONS = [
  { value: 'stream', label: 'Stream' },
  { value: 'exercises', label: 'Exercises' },
  { value: 'leaderboards', label: 'Leaderboards' },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The group screen (groups contract §6.3; product D10, D14): header with the
 * role-gated Invite / Edit actions and the member count, which opens the
 * Members screen; then Stream · Exercises · Leaderboards.
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
      <GroupLostAccessState testID="group-screen-lost-access" />
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
  const exercisesFetcher = useCallback(() => listGroupExercises(groupId), [groupId]);
  // Read only while the Exercises segment is open; the cached list renders at once when it is reopened.
  const exercises = useGroupResource<GroupExerciseListResult>({
    userId,
    cacheKey: segment === 'exercises' ? groupCacheKeys.groupExercises(groupId) : null,
    fetcher: exercisesFetcher,
    evictGroupIdOnNotFound: groupId,
  });

  const refreshGroup = group.refresh;
  const refreshStream = stream.refresh;
  const refreshExercises = exercises.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshGroup(), refreshStream(), refreshExercises()]),
    [refreshGroup, refreshStream, refreshExercises],
  );
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

  // C3.6.8: after removal, hide everything cached (the hooks already evicted it).
  if (group.lostAccess || stream.lostAccess || exercises.lostAccess) {
    return <LostAccessState />;
  }

  const segmentResource = segment === 'stream' ? stream : segment === 'exercises' ? exercises : null;
  const offline = group.offline || (segmentResource?.offline ?? false);
  const inlineError = pickInlineError(group.error, segmentResource?.error ?? null);
  const lastUpdatedAtMs = (segment === 'exercises' ? exercises.lastUpdatedAtMs : null) ?? group.lastUpdatedAtMs;
  const refreshControl = <RefreshControl onRefresh={onRefresh} refreshing={pulling} />;
  const data = group.data;

  if (!data) {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRefresh} testIDPrefix="group-screen" />
      </ScrollView>
    );
  }

  const summary = data.group;
  const memberLine = `${formatMemberCount(summary.member_count)} · ${formatMyRole(summary.my_role)}`;

  const header = (
    <View style={groupScreenStyles.header}>
      <Stack.Screen options={{ title: summary.name }} />
      <View style={{ gap: uiSpace.xs }} testID="group-screen-header">
        <UiText testID="group-screen-name" variant="title">
          {summary.name}
        </UiText>
        {summary.description ? <UiText variant="bodyMuted">{summary.description}</UiText> : null}
        {/* D14: members live behind the member count. */}
        <Pressable
          accessibilityHint="Opens the member list"
          accessibilityLabel={`Members, ${memberLine}`}
          accessibilityRole="button"
          onPress={() => router.push(`/group/${groupId}/members`)}
          style={styles.membersLink}
          testID="group-screen-members-link">
          <UiText testID="group-screen-meta" variant="subtitle">
            {memberLine}
          </UiText>
          <UiText style={styles.chevron} variant="label">
            ›
          </UiText>
        </Pressable>
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
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={lastUpdatedAtMs} /> : null}
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

  if (segment === 'exercises') {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        {header}
        <GroupExercisesPage
          error={inlineError}
          exercises={exercises}
          groupId={groupId}
          myRole={summary.my_role}
          offline={offline}
          onRetry={onRefresh}
          refreshGroup={refreshGroup}
        />
      </ScrollView>
    );
  }

  if (segment === 'leaderboards') {
    return (
      <ScrollView contentContainerStyle={groupScreenStyles.content} refreshControl={refreshControl} style={groupScreenStyles.screen}>
        {header}
        <GroupStateView
          body="Each group exercise will get a podium and full boards for Weight and e1RM, on certified and on all sets."
          testID="group-screen-leaderboards-empty"
          title="Leaderboards are coming soon"
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

const styles = StyleSheet.create({
  membersLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    alignSelf: 'flex-start',
  },
  chevron: {
    color: uiColors.textSecondary,
  },
});
