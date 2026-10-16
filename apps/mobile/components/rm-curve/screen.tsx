import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ActionButton, Notice, Screen, uiSpace } from '@/components/ui';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { rmCurveWindow } from '@/src/rm-curve/model';
import { useRmCurve } from '@/src/rm-curve/use-rm-curve';
import { RmCurveContent, type CurveScope } from './content';

/** Native header/back belongs to the host. Supply a stable focus-time instant. */
export function RmCurveScreen({ exerciseDefinitionId, now }: { exerciseDefinitionId: string; now: Date }) {
  const preferences = useAccountLocalPreferenceState();
  return <Screen>
    {preferences.error ? <View style={{ margin: uiSpace.lg }}><Notice live tone="danger" message={preferences.error}
      action={<ActionButton label="Retry" onPress={() => void preferences.retry()} size="compact" variant="outline" />} /></View> : null}
    <CurvePage key={`${preferences.accountRevision}:${exerciseDefinitionId}`} initialExerciseId={exerciseDefinitionId}
      preferences={preferences} now={now} />
  </Screen>;
}

function CurvePage({ initialExerciseId, preferences, now }: {
  initialExerciseId: string; preferences: ReturnType<typeof useAccountLocalPreferenceState>; now: Date;
}) {
  const [scope, setScope] = useState<CurveScope>({ exerciseId: initialExerciseId, range: 12, rir: null });
  const catalog = useExerciseCatalog();
  const { historyLookbackWeeks, dateFormat } = preferences.values;
  const instant = now.getTime();
  const window = useMemo(() => rmCurveWindow(historyLookbackWeeks, new Date(instant), scope.range), [historyLookbackWeeks, instant, scope.range]);
  const read = useRmCurve({ ...window, exerciseDefinitionId: scope.exerciseId, gymId: scope.gymId,
    rir: scope.rir, accountRevision: preferences.accountRevision });
  return <RmCurveContent read={read} scope={scope} onScope={setScope} dateFormat={dateFormat} historyWeeks={historyLookbackWeeks}
    exercises={catalog.exercises.filter(e => !e.deletedAt)} catalogStatus={catalog.status} retryCatalog={() => { void ensureExerciseCatalogLoaded(); }} />;
}
