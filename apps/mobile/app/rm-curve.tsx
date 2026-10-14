import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RmCurveScreen } from '@/components/rm-curve/screen';
import { IconButton, Screen, StatePanel } from '@/components/ui';
import { mainTabHref } from '@/src/navigation/main-tabs';

/** History stays mounted below this page; chart scope never writes to its context. */
export default function RmCurveRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ exerciseDefinitionId?: string | string[] }>();
  const raw = params.exerciseDefinitionId;
  const exerciseId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  return <>
    <Stack.Screen options={{ headerLeft: () => <IconButton name="chevron-left" accessibilityLabel="Back"
      testID="rm-curve-back" onPress={() => router.canGoBack() ? router.back() : router.replace(mainTabHref('progress'))} /> }} />
    {exerciseId ? <RmCurveScreen key={exerciseId} exerciseDefinitionId={exerciseId} now={now} />
      : <Screen><StatePanel title="This exercise isn’t available" body="Return to History and choose an exercise." /></Screen>}
  </>;
}
