import { Stack, useLocalSearchParams } from 'expo-router';
import { GroupMeetsPage } from '@/components/groups/group-meets-page';
import { GroupLostAccessState } from '@/components/groups/group-state-view';
import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { useAuth } from '@/src/auth';
export default function MeetsRoute() {
  const { isConfigured, user } = useAuth(); const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  if (!groupId) return <GroupLostAccessState testID="meet-lost-access" />;
  return <><Stack.Screen options={{ title: 'Meets' }} /><GroupMeetsPage key={`${user.id}:${groupId}`} userId={user.id} groupId={groupId} /></>;
}
