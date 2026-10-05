import { useCallback, type ReactNode } from 'react';
import { View } from 'react-native';

import { groupCacheKeys, listCompetitionExercises, useGroupResource } from '@/src/groups';

import type { CompetitionExerciseWire, CompetitionExerciseListWire } from '@/src/groups/competition-wire';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView } from './group-state-view';
import { groupScreenStyles } from './screen-styles';

/** Resolve direct links from the same versioned catalogue as the group page. */
export function GroupComparisonBoundary({ userId, groupId, exerciseId, children, history = false }: {
  userId: string; groupId: string; exerciseId: string; children: (exercise: CompetitionExerciseWire) => ReactNode; history?: boolean;
}) {
  const fetcher = useCallback(() => listCompetitionExercises(groupId), [groupId]);
  const resource = useGroupResource<CompetitionExerciseListWire>({ userId, cacheKey: groupCacheKeys.groupExercises(groupId),
    fetcher, evictGroupIdOnNotFound: groupId });
  const prefix = history ? 'group-board-history' : 'group-board';
  let state: ReactNode = null;
  if (resource.lostAccess) state = <GroupLostAccessState testID={`${prefix}-lost-access`} />;
  else if (!resource.data) state = <GroupMissingDataState error={resource.error} offline={resource.offline}
    onRetry={() => void resource.refresh()} testIDPrefix={prefix} />;
  else {
    const exercise = resource.data.exercises.find(row => row.group_exercise_id === exerciseId);
    if (exercise) return children(exercise);
    state = <GroupStateView title="This exercise isn't in this group" body="It may have been removed, or the link is wrong."
      testID={`${prefix}-exercise-missing`} />;
  }
  return <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>{state}</View>;
}
