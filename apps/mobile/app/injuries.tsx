import { Stack, useLocalSearchParams } from 'expo-router';

import { InjuriesScreen } from '@/components/injuries/injuries-screen';
import { TabOwnedPage } from '@/components/navigation/tab-owned-page';

const firstParam = (value: string | string[] | undefined): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Dedicated route for viewing, logging, and managing injuries and discomfort.
 */
export default function InjuriesRoute() {
  const params = useLocalSearchParams<{ muscleGroupId?: string | string[]; new?: string | string[] }>();
  const muscleGroupId = firstParam(params.muscleGroupId);
  const initialNew = firstParam(params.new) === '1' || firstParam(params.new) === 'true';

  return (
    <TabOwnedPage>
      <Stack.Screen options={{ title: 'Injuries' }} />
      <InjuriesScreen initialNew={initialNew} muscleGroupId={muscleGroupId} />
    </TabOwnedPage>
  );
}
