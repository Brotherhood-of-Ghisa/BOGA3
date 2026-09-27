import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  GroupLostAccessState,
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  pickInlineError,
} from '@/components/groups';
import { ScreenScroll } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { GroupComparisonForm } from '@/components/groups/group-comparison-form';
import type { GroupExerciseRules } from '@/src/groups/metric-contract';
import type { GroupMetricExerciseListWire } from '@/src/groups/metric-wire';
import { listGroupComparisons, updateGroupComparison } from '@/src/groups/api';
import {
  canManageGroup,
  describeGroupExerciseWriteError,
  getGroup,
  groupCacheKeys,
  useGroupAction,
  useGroupResource,
  useMountedRef,
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Rename a group exercise or change its weight entry (owner, admin; contract
 * §4.4 `group_exercise_update` replaces both), prefilled from the cached list.
 * Archived exercises are read-only.
 */
export default function EditGroupExerciseRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string | string[]; exerciseId?: string | string[] }>();
  const groupId = firstParam(params.groupId);
  const exerciseId = firstParam(params.exerciseId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId || !exerciseId) {
    return null;
  }
  return <EditGroupExerciseContent exerciseId={exerciseId} groupId={groupId} userId={user.id} />;
}

function EditGroupExerciseContent({ userId, groupId, exerciseId }: { userId: string; groupId: string; exerciseId: string }) {
  const router = useRouter();
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher: groupFetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const exercisesFetcher = useCallback(() => listGroupComparisons(groupId), [groupId]);
  const exercises = useGroupResource<GroupMetricExerciseListWire>({
    userId,
    cacheKey: groupCacheKeys.groupExercises(groupId),
    fetcher: exercisesFetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const update = useGroupAction((core: GroupExerciseRules, revision: number) => updateGroupComparison(groupId, exerciseId, revision, core));
  const mounted = useMountedRef();

  const onSubmit = async (core: GroupExerciseRules, revision: number | null) => {
    if (revision === null) return;
    const result = await update.run(core, revision);
    // Back during a slow save already left this screen: going back again would pop the group screen.
    if (!mounted.current) return;
    if (result.ok) {
      // The group screen's Exercises segment refreshes on focus.
      router.back();
      return;
    }
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND' || result.error.code === 'VALIDATION' || result.error.code === 'CONFLICT') {
      void group.refresh();
      void exercises.refresh();
    }
  };

  const exercise = exercises.data?.exercises.find((candidate) => candidate.group_exercise_id === exerciseId) ?? null;

  let body;
  if (group.lostAccess || exercises.lostAccess) {
    body = <GroupLostAccessState testID="group-exercise-edit-lost-access" />;
  } else if (!group.data || !exercises.data) {
    body = (
      <GroupMissingDataState
        error={pickInlineError(group.error, exercises.error)}
        offline={group.offline || exercises.offline}
        onRetry={() => {
          void group.refresh();
          void exercises.refresh();
        }}
        testIDPrefix="group-exercise-edit"
      />
    );
  } else if (!canManageGroup(group.data.group.my_role)) {
    body = (
      <GroupStateView
        body="Only the owner and admins can change group exercises."
        testID="group-exercise-edit-forbidden"
        title="You can't edit this exercise"
      />
    );
  } else if (!exercise) {
    body = <GroupStateView testID="group-exercise-edit-missing" title="This exercise is no longer available" />;
  } else if (exercise.archived_at_ms !== null) {
    body = (
      <GroupStateView
        body="Unarchive it on the group's Exercises page first."
        testID="group-exercise-edit-archived"
        title="Archived exercises can't be edited"
      />
    );
  } else {
    body = (
      <GroupComparisonForm
        errorMessage={update.error ? describeGroupExerciseWriteError(update.error) : null}
        existing={exercise}
        onSubmit={(core, revision) => void onSubmit(core, revision)}
        pending={update.pending}
        pendingLabel="Saving…"
        submitLabel="Save changes"
      />
    );
  }

  return (
    <ScreenScroll automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" testID="group-exercise-edit-screen">
      {body}
    </ScreenScroll>
  );
}
