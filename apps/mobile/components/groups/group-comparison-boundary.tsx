import { useCallback, type ReactNode } from 'react';
import { View } from 'react-native';

import { groupCacheKeys, listGroupExercises, useGroupResource, type GroupExerciseListResult } from '@/src/groups';
import { isGroupMetricExerciseWire } from '@/src/groups/metric-wire-guards';
import type { GroupMetricExerciseWire } from '@/src/groups/metric-wire';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView } from './group-state-view';
import { groupScreenStyles } from './screen-styles';

/** Resolve direct links from the same versioned catalogue as the group page. */
export function GroupComparisonBoundary({ userId, groupId, exerciseId, legacy, children, history = false }: {
  userId: string; groupId: string; exerciseId: string; legacy: ReactNode;
  children: (exercise: GroupMetricExerciseWire) => ReactNode; history?: boolean;
}) {
  const fetcher = useCallback(() => listGroupExercises(groupId), [groupId]);
  const resource = useGroupResource<GroupExerciseListResult>({ userId, cacheKey: groupCacheKeys.groupExercises(groupId),
    fetcher, evictGroupIdOnNotFound: groupId });
  const prefix = history ? 'group-board-history' : 'group-board';
  let state: ReactNode = null;
  if (resource.lostAccess) state = <GroupLostAccessState testID={`${prefix}-lost-access`} />;
  else if (!resource.data) state = <GroupMissingDataState error={resource.error} offline={resource.offline}
    onRetry={() => void resource.refresh()} testIDPrefix={prefix} />;
  else {
    const exercise = resource.data.exercises.find(row => row.group_exercise_id === exerciseId);
    if (exercise) return isGroupMetricExerciseWire(exercise) && !exercise.legacy ? children(exercise) : legacy;
    state = <GroupStateView title="This exercise isn't in this group" body="It may have been removed, or the link is wrong."
      testID={`${prefix}-exercise-missing`} />;
  }
  return <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>{state}</View>;
}
