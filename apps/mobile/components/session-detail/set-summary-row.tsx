import { StyleSheet, Text, View } from 'react-native';

import { Stat } from '@/components/ui/stat';
import { FigureText } from '@/components/ui/figure-text';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

// One read-only set: type · weight × reps · 1RM · VOL. No control column — a
// card of these rows is read, not edited (spec 08, "Read-only link card pattern"). Every
// figure in a row shares the row's colour and weight; only the record set's
// 1RM and Weight records stand out, in `record`, as on the exercise page
// (decided on device 2026-09-23: per-column bests read as noise).
export function SetSummaryRow({ row, testID, hideDerivedMetrics = false, percentageMetrics = false }:
  { row: SessionViewSetRow; testID: string; hideDerivedMetrics?: boolean; percentageMetrics?: boolean }) {
  const text = useUiText();
  const tone = useUiTextTone();
  const state = row.done ? 'realised' : 'planned';
  return (
    <View style={[styles.setRow, percentageMetrics && styles.percentageRow]} testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.label, row.done ? tone.ink : tone.faint, styles.effortColumn]}>
        <FigureText>{row.typeLabel}</FigureText>
      </Text>
      <Text
        allowFontScaling={false}
        accessibilityLabel={percentageMetrics ? row.weightReps : undefined}
        numberOfLines={1}
        style={[text.figure, row.done ? (row.weightRecord ? tone.record : null) : tone.faint, styles.weightReps,
          percentageMetrics && styles.percentageWeightReps]}
        testID={`${testID}-values`}>
        {percentageMetrics ? <FigureText figureStyle={row.done && row.weightRecord ? tone.record : undefined}>{row.weightReps}</FigureText> : row.weightReps}
      </Text>
      {!hideDerivedMetrics ? percentageMetrics ? <View style={styles.percentageMetrics}>
        <Stat label="1RM" value={row.oneRepMax} layout="inline" state={state}
          emphasis={row.done && row.oneRepMaxRecord ? 'record' : 'none'} valueWidth="hug" testID={`${testID}-1rm`} />
        <Stat label="Vol" value={row.volume} layout="inline" state={state}
          valueWidth="hug" testID={`${testID}-vol`} />
      </View> : <>
      <View style={[styles.metricColumn, styles.oneRepMaxColumn]} testID={`${testID}-1rm-column`}>
        <Stat
          emphasis={row.done && row.oneRepMaxRecord ? 'record' : 'none'}
          label="1RM"
          layout="inline"
          state={state}
          testID={`${testID}-1rm`}
          value={row.oneRepMax}
          valueWidth="hug"
        />
      </View>
      <View style={[styles.metricColumn, styles.volumeColumn]} testID={`${testID}-vol-column`}>
        <Stat
          label="Vol"
          layout="inline"
          state={state}
          testID={`${testID}-vol`}
          value={row.volume}
          valueWidth="hug"
        />
      </View>
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  percentageRow: {
    gap: uiSpace.xs,
    paddingVertical: uiSpace.xs,
    flexWrap: 'wrap',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  effortColumn: {
    width: uiGeometry.tapTarget,
  },
  percentageMetrics: { alignItems: 'flex-end', marginLeft: 'auto', maxWidth: '100%' },
  percentageWeightReps: { minWidth: uiGeometry.tapTarget * 2 + uiSpace.lg },
  // 1RM and VOL as two fixed columns: each value right-aligned
  // in its column, its legend a fixed gap to its left, so a legend reads with
  // its own value and not the next column's.
  metricColumn: {
    alignItems: 'flex-end',
  },
  // As wide as the old legend-plus-value pair, so weight × reps keeps its room.
  oneRepMaxColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl + uiSpace.sm },
  volumeColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  weightReps: {
    flex: 1,
    minWidth: 0,
  },
});
