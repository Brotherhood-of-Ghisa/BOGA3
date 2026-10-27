import { Text, View } from 'react-native';
import { ActionButton, Card, FigureText, uiText, uiTextTone } from '@/components/ui';
import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { RmCurveModel, RmCurveObservation } from '@/src/rm-curve/model';
import { NO_GYM_LABEL } from '@/src/utils/gym-scope-route';
import { formatShortDate } from '@/src/utils/local-time';
import { periodColour } from './chart';
import { curveStyles as styles } from './styles';

export function setDescription(point: RmCurveObservation, dateFormat: ExerciseDateFormat) {
  const unit = point.loadContext.loadInputMode === 'per_side_load' ? ' per side' : '';
  return `${formatShortDate(point.completedAt, dateFormat)} · block ${point.blockOrder + 1}, set ${point.setOrder + 1}. ` +
    `${point.reps} reps, RIR ${point.rir}, ${point.equivalentReps} equivalent reps. ` +
    `Load ${formatWeight(point.loadKg)}${unit}, Weight ${formatWeight(point.weightKg)}${unit}, 1RM ${formatOneRepMax(point.existingOneRepMax)}${unit}. ${point.gymName ?? NO_GYM_LABEL}.`;
}

export function RmCurveDetails({ model, point, dateFormat, onSelect, period, periodLabel }: {
  period?: 'all' | 'older' | 'newer'; periodLabel?: string;
  model: RmCurveModel; point: RmCurveObservation; dateFormat: ExerciseDateFormat; onSelect: (id: string) => void;
}) {
  const index = model.observations.findIndex(p => p.setId === point.setId);
  const perSide = model.definition.loadInputMode === 'per_side_load';
  return <Card style={styles.card} testID="rm-curve-details">
    <Text allowFontScaling={false} style={uiText.label}>SELECTED SET</Text>
    {period && periodLabel ? <Text testID="rm-selected-period" allowFontScaling={false} style={[uiText.body, { color: periodColour(period) }]}><FigureText>{periodLabel}</FigureText></Text> : null}
    <Text allowFontScaling={false} style={uiText.body}><FigureText>{`${formatShortDate(point.completedAt, dateFormat)} · block ${point.blockOrder + 1}, set ${point.setOrder + 1}`}</FigureText></Text>
    <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}>{point.gymName ?? NO_GYM_LABEL}</Text>
    <View style={styles.metrics}>
      <View style={styles.metric}><Text allowFontScaling={false} style={uiText.label}>REPS / RIR</Text><Text allowFontScaling={false} style={uiText.figure}>{point.reps} / {point.rir}</Text></View>
      <View style={styles.metric}><Text allowFontScaling={false} style={uiText.label}>{perSide ? 'WEIGHT / 1RM · PER SIDE' : 'WEIGHT / 1RM'}</Text>
        <Text allowFontScaling={false} style={uiText.figure}>{formatWeight(point.weightKg)} / {formatOneRepMax(point.existingOneRepMax)}</Text></View>
    </View>
    <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}><FigureText>{`Equivalent reps ${point.equivalentReps} · Load ${formatWeight(point.loadKg)}${perSide ? ' per side' : ''}`}</FigureText></Text>
    <View style={styles.actions}>
      <ActionButton label="Previous set" variant="outline" disabled={index === model.observations.length - 1}
        onPress={() => onSelect(model.observations[index + 1].setId)} />
      <ActionButton label="Next set" variant="outline" disabled={index === 0}
        onPress={() => onSelect(model.observations[index - 1].setId)} />
    </View>
  </Card>;
}
