import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  GroupExercisesPage,
  GroupInlineError,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { Icon, UiButton, UiText, uiColors, uiSpace } from '@/components/ui';
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
 * group: header with the role-gated Invite / Edit actions and the member
 * count, which opens the Members screen; then the group's Exercises. The
 * stream and leaderboards live on the Groups screen.
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
          <Icon color={uiColors.textSecondary} name="chevron-right" />
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
      <UiText accessibilityRole="header" testID="group-screen-exercises-title" variant="title">
        Exercises
      </UiText>
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
  membersLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    alignSelf: 'flex-start',
  },
});
