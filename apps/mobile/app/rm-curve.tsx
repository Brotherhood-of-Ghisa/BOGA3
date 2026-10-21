import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RmCurveScreen } from '@/components/rm-curve/screen';
import { IconButton, Screen, StatePanel } from '@/components/ui';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { mainTabHref } from '@/src/navigation/main-tabs';

/** Exercise name is the native title; History stays mounted with its context intact. */
export default function RmCurveRoute() {
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const params = useLocalSearchParams<{ exerciseDefinitionId?: string | string[] }>();
  const raw = params.exerciseDefinitionId;
  const exerciseId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const exercise = catalog.exercises.find(candidate => candidate.id === exerciseId && !candidate.deletedAt);
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  return <>
    <Stack.Screen options={{ title: exercise?.name ?? 'RM curve', headerLeft: () => <IconButton nativeHeader name="chevron-left" accessibilityLabel="Back"
      testID="rm-curve-back" onPress={() => router.canGoBack() ? router.back() : router.replace(mainTabHref('progress'))} /> }} />
    {exerciseId ? <RmCurveScreen key={exerciseId} exerciseDefinitionId={exerciseId} now={now} />
      : <Screen><StatePanel title="This exercise isn’t available" body="Return to History and choose an exercise." /></Screen>}
  </>;
}
