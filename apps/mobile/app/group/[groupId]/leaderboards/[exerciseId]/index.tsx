import { useLocalSearchParams } from 'expo-router';
import { GroupComparisonBoundary } from '@/components/groups/group-comparison-boundary';
import { GroupMetricBoard } from '@/components/groups/group-metric-board';
import { GroupsSignInRequired } from '@/components/groups';
import { useAuth } from '@/src/auth';
import { parseBoardScopeParam } from '@/src/groups';
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export default function GroupBoardRoute() {
  const { isConfigured,user }=useAuth();
  const params=useLocalSearchParams<{ groupId?: string | string[];exerciseId?: string | string[];metric?: string | string[];scope?: string | string[] }>();
  const groupId=first(params.groupId),exerciseId=first(params.exerciseId);
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  if (!groupId || !exerciseId) return null;
  return <GroupComparisonBoundary userId={user.id} groupId={groupId} exerciseId={exerciseId}>
    {exercise => <GroupMetricBoard userId={user.id} groupId={groupId} exercise={exercise}
      initialMetric={first(params.metric)} initialScope={parseBoardScopeParam(params.scope)} />}
  </GroupComparisonBoundary>;
}
