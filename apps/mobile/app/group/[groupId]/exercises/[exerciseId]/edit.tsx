import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView } from 'react-native';

import {
  GroupExerciseForm,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  groupScreenStyles,
  pickInlineError,
} from '@/components/groups';
import { useAuth } from '@/src/auth';
import type { ExerciseCore } from '@/src/exercise-core';
import {
  canManageGroup,
  describeGroupExerciseWriteError,
  getGroup,
  groupCacheKeys,
  groupExerciseCore,
  listGroupExercises,
  updateGroupExercise,
  useGroupAction,
  useGroupResource,
  useMountedRef,
  type GroupExerciseListResult,
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
  const exercisesFetcher = useCallback(() => listGroupExercises(groupId), [groupId]);
  const exercises = useGroupResource<GroupExerciseListResult>({
    userId,
    cacheKey: groupCacheKeys.groupExercises(groupId),
    fetcher: exercisesFetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const update = useGroupAction((core: ExerciseCore) => updateGroupExercise(groupId, exerciseId, core));
  const mounted = useMountedRef();

  const onSubmit = async (core: ExerciseCore) => {
    const result = await update.run(core);
    // Back during a slow save already left this screen: going back again would pop the group screen.
    if (!mounted.current) return;
    if (result.ok) {
      // The group screen's Exercises segment refreshes on focus.
      router.back();
      return;
    }
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND' || result.error.code === 'VALIDATION') {
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
      <GroupExerciseForm
        errorMessage={update.error ? describeGroupExerciseWriteError(update.error) : null}
        initialCore={groupExerciseCore(exercise)}
        onSubmit={(core) => void onSubmit(core)}
        pending={update.pending}
        pendingLabel="Saving…"
        submitLabel="Save changes"
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={groupScreenStyles.content}
      keyboardShouldPersistTaps="handled"
      style={groupScreenStyles.screen}
      testID="group-exercise-edit-screen">
      {body}
    </ScrollView>
  );
}
