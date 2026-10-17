import { Text, View } from 'react-native';
import { formatOneRepMax } from '@/src/exercise-calculations/format';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { RmCurveModel } from '@/src/rm-curve/model';
import type { RegimeAssessment } from '@/src/strength-regimes/assessment';
import type { useRegimeAssessment } from '@/src/strength-regimes/use-assessment';
import { formatShortDate } from '@/src/utils/local-time';
import { RmCurveChart, periodColour } from './chart';
import { curveStyles as styles } from './styles';

/** Fitted amplitudes only. Unsupported histories keep a plain exploratory state and no calibrated shading. */
export function RmRegimes({ model, result, selectedId, dateFormat, onPick }: {
  model: RmCurveModel; result: ReturnType<typeof useRegimeAssessment>; selectedId: string | null;
  dateFormat: ExerciseDateFormat; onPick: (ids: string[]) => void;
}) {
  const assessment = result?.data;
  const factor = model.definition.loadInputMode === 'per_side_load' ? 2 : 1;
  return <>
    <RmCurveChart model={model} selectedId={selectedId} onPick={onPick}
      curves={assessment?.curves ?? []} boundary={assessment?.boundary ?? null} />
    <Text testID="rm-fit-state" accessibilityLiveRegion="polite" allowFontScaling={false} style={styles.body}>
      {result === null ? 'Fitting curves' : result.limited ? 'Choose a shorter range' : result.error ? 'Fit unavailable' : assessment?.message}
    </Text>
    {assessment ? <Text allowFontScaling={false} style={styles.figure}>{assessment.sampledSessions} fitting sessions</Text> : null}
    {assessment?.curves.map(curve => <View key={curve.period} style={styles.legend}>
      <View style={[styles.dot, { borderColor: periodColour(curve.period), backgroundColor: 'transparent' }, curve.period === 'newer' ? { borderRadius: 0, transform: [{ rotate: '45deg' }] } : null]} />
      <Text allowFontScaling={false} style={[styles.figure, { color: periodColour(curve.period) }]}>
        {periodLabel(curve.period, assessment.boundary, dateFormat)}
        {' · 1RM '}{formatOneRepMax(curve.totalRm / factor)} kg{factor === 2 ? ' per side' : ''}
      </Text>
    </View>)}
  </>;
}

export function periodLabel(period: 'all' | 'older' | 'newer', boundary: number | null, dateFormat: ExerciseDateFormat) {
  return period === 'all' ? 'All dates' : `${period === 'older' ? 'Before' : 'From'} ${formatShortDate(new Date(boundary!), dateFormat)}`;
}

export function selectedPeriod(time: Date, assessment: RegimeAssessment | null | undefined) {
  if (!assessment?.curves.length) return undefined;
  return assessment.boundary === null ? 'all' as const : time.getTime() < assessment.boundary ? 'older' as const : 'newer' as const;
}
