import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  GroupExercisesPage,
  GroupHeaderCard,
  GroupInlineError,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import {
  ActionButton,
  Icon,
  ListRow,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  canManageGroup,
  formatMemberCount,
  formatMyRole,
  getGroup,
  groupCacheKeys,
  listGroupExercises,
  useGroupResource,
  type GroupExerciseListResult,
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The group screen (groups contract §6.3; product D10, D14), for managing the
 * group: the header card with the member count, which opens the Members
 * screen; the role-gated Invite (the screen's one `accent`, T13-D1) and Edit;
 * then the group's Exercises. The stream and leaderboards live on the Groups
 * screen.
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
  const exercisesFetcher = useCallback(() => listGroupExercises(groupId), [groupId]);
  const exercises = useGroupResource<GroupExerciseListResult>({
    userId,
    cacheKey: groupCacheKeys.groupExercises(groupId),
    fetcher: exercisesFetcher,
    evictGroupIdOnNotFound: groupId,
  });

  const refreshGroup = group.refresh;
  const refreshExercises = exercises.refresh;
  const refreshAll = useCallback(
    () => Promise.all([refreshGroup(), refreshExercises()]),
    [refreshGroup, refreshExercises],
  );
  const { pulling, onRefresh } = usePullToRefresh(refreshAll);

  // C3.6.8: after removal, hide everything cached (the hooks already evicted it).
  if (group.lostAccess || exercises.lostAccess) {
    return <LostAccessState />;
  }

  const offline = group.offline || exercises.offline;
  const inlineError = pickInlineError(group.error, exercises.error);
  const lastUpdatedAtMs = exercises.lastUpdatedAtMs ?? group.lastUpdatedAtMs;
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
      <GroupHeaderCard description={summary.description} name={summary.name} nameTestID="group-screen-name" testID="group-screen-header">
        {/* D14: members live behind the member count. */}
        <ListRow
          accessibilityHint="Opens the member list"
          accessibilityLabel={`Members, ${memberLine}`}
          density="list"
          label="Members"
          meta={
            <Text allowFontScaling={false} numberOfLines={1} style={styles.memberLine} testID="group-screen-meta">
              {memberLine}
            </Text>
          }
          onPress={() => router.push(`/group/${groupId}/members`)}
          testID="group-screen-members-link"
          trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}
        />
      </GroupHeaderCard>
      {canManageGroup(summary.my_role) ? (
        <View style={groupScreenStyles.actionRow}>
          {/* Invite is the prominent action for owners and admins (C3.3.2); members never see it (C7.4). */}
          <View style={groupScreenStyles.actionRowItem}>
            <ActionButton
              label="Invite"
              onPress={() => router.push(`/group/${groupId}/invite`)}
              testID="group-screen-invite-button"
              variant="primary"
            />
          </View>
          <View style={groupScreenStyles.actionRowItem}>
            <ActionButton
              label="Edit"
              onPress={() => router.push(`/group/${groupId}/edit`)}
              testID="group-screen-edit-button"
              variant="outline"
            />
          </View>
        </View>
      ) : null}
      {offline ? <GroupOfflineBanner lastUpdatedAtMs={lastUpdatedAtMs} /> : null}
      {inlineError ? <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-screen-inline-error" /> : null}
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={groupScreenStyles.content}
      refreshControl={refreshControl}
      style={groupScreenStyles.screen}
      testID="group-screen">
      {header}
      <GroupExercisesPage
        error={inlineError}
        exercises={exercises}
        groupId={groupId}
        groupName={summary.name}
        myRole={summary.my_role}
        offline={offline}
        onRetry={onRefresh}
        refreshGroup={refreshGroup}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  memberLine: {
    flexShrink: 1,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
