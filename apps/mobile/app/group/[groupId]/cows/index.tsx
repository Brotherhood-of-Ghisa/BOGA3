import { Stack, useLocalSearchParams } from 'expo-router';
import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { GroupLostAccessState } from '@/components/groups/group-state-view';
import { GroupCoWsPage } from '@/components/groups/group-cows-page';
import { useAuth } from '@/src/auth';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Chronological browser: independent reads retain their safe loaded sections on a partial failure. */
export default function CoWsRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string; cowId?: string; metric?: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  const groupId = first(params.groupId);
  if (!groupId) return <GroupLostAccessState testID="cows-lost-access" />;
  return <><Stack.Screen options={{ title: 'CoWs' }} /><GroupCoWsPage key={`${user.id}:${groupId}`} userId={user.id} groupId={groupId} cowId={first(params.cowId)} metric={first(params.metric)} /></>;
}
