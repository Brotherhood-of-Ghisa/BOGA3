import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ActionButton, Notice, Screen, uiSpace } from '@/components/ui';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { rmCurveWindow } from '@/src/rm-curve/model';
import { useRmCurve } from '@/src/rm-curve/use-rm-curve';
import { RmCurveContent, type CurveScope } from './content';

/** Exercise is fixed by the route; the host owns native header/back and focus time. */
export function RmCurveScreen({ exerciseDefinitionId, now }: { exerciseDefinitionId: string; now: Date }) {
  const preferences = useAccountLocalPreferenceState();
  return <Screen>
    {preferences.error ? <View style={{ margin: uiSpace.lg }}><Notice live tone="danger" message={preferences.error}
      action={<ActionButton label="Retry" onPress={() => void preferences.retry()} size="compact" variant="outline" />} /></View> : null}
    <CurvePage key={`${preferences.accountRevision}:${exerciseDefinitionId}`} exerciseDefinitionId={exerciseDefinitionId}
      preferences={preferences} now={now} />
  </Screen>;
}

function CurvePage({ exerciseDefinitionId, preferences, now }: {
  exerciseDefinitionId: string; preferences: ReturnType<typeof useAccountLocalPreferenceState>; now: Date;
}) {
  const [scope, setScope] = useState<CurveScope>({ range: 'history', gym: {}, rir: null });
  const { historyLookbackWeeks, targetWindowWeeks, dateFormat } = preferences.values;
  const instant = now.getTime();
  const window = useMemo(() => rmCurveWindow(historyLookbackWeeks, new Date(instant), scope.range, targetWindowWeeks), [historyLookbackWeeks, targetWindowWeeks, instant, scope.range]);
  const read = useRmCurve({ ...window, exerciseDefinitionId, gym: scope.gym,
    rir: scope.rir, accountRevision: preferences.accountRevision });
  return <RmCurveContent read={read} scope={scope} onScope={setScope} dateFormat={dateFormat} historyWeeks={historyLookbackWeeks} progressWeeks={targetWindowWeeks} />;
}
