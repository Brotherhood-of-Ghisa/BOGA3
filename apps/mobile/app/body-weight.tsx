import { Stack, useRouter } from 'expo-router';
import { BodyWeightScreen } from '@/components/bodyweight/body-weight-screen';
import { IconButton } from '@/components/ui';

export default function BodyWeightRoute() {
  const router = useRouter();
  return <>
    <Stack.Screen options={{
      headerBackVisible: false,
      // On iOS 26.4 the native back item can stop dispatching after revisiting
      // from an active session. Keep the shared arrow and dispatch explicitly.
      headerLeft: () => <IconButton name="chevron-left" accessibilityLabel="Back"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')}
        testID="body-weight-back" />,
    }} />
    <BodyWeightScreen />
  </>;
}
