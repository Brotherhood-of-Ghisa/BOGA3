import { StyleSheet, Text, View } from 'react-native';

import { Stat } from '@/components/ui/stat';
import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

// One read-only set: type · weight × reps · 1RM · VOL. No control column — a
// card of these rows is read, not edited (spec 08, "Read-only link card pattern"). Every
// figure in a row shares the row's colour and weight; only the record set's
// 1RM and Weight records stand out, in `record`, as on the exercise page
// (decided on device 2026-09-23: per-column bests read as noise).
export function SetSummaryRow({ row, testID, hideDerivedMetrics = false, percentageMetrics = false }:
  { row: SessionViewSetRow; testID: string; hideDerivedMetrics?: boolean; percentageMetrics?: boolean }) {
  const state = row.done ? 'realised' : 'planned';
  return (
    <View style={[styles.setRow, percentageMetrics && styles.percentageRow]} testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.label, row.done ? uiTextTone.ink : uiTextTone.faint, styles.effortColumn]}>
        <FigureText>{row.typeLabel}</FigureText>
      </Text>
      <Text
        allowFontScaling={false}
        accessibilityLabel={percentageMetrics ? row.weightReps : undefined}
        numberOfLines={1}
        style={[uiText.figure, row.done ? (row.weightRecord ? uiTextTone.record : null) : uiTextTone.faint, styles.weightReps]}
        testID={`${testID}-values`}>
        {percentageMetrics ? row.weightReps.replace(' %BW', '') : row.weightReps}
      </Text>
      {!hideDerivedMetrics ? percentageMetrics ? <>
        <Text allowFontScaling={false} numberOfLines={1}
          accessibilityLabel={`1RM ${row.oneRepMax}`}
          style={[uiText.figureSmall, row.done ? (row.oneRepMaxRecord ? uiTextTone.record : uiTextTone.ink) : uiTextTone.faint, styles.metric, styles.oneRepMax]}
          testID={`${testID}-1rm`}>{row.oneRepMax.replace(' %BW', '')}</Text>
        <Text allowFontScaling={false} numberOfLines={1}
          accessibilityLabel={`Vol ${row.volume}`}
          style={[uiText.figureSmall, row.done ? uiTextTone.ink : uiTextTone.faint, styles.metric, styles.volume]}
          testID={`${testID}-vol`}>{row.volume.replace(' %BW·reps', '')}</Text>
      </> : <>
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
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  effortColumn: {
    width: uiGeometry.tapTarget,
  },
  metric: {
    textAlign: 'right',
  },
  // 1RM and VOL as two fixed columns: each value right-aligned
  // in its column, its legend a fixed gap to its left, so a legend reads with
  // its own value and not the next column's.
  metricColumn: {
    alignItems: 'flex-end',
  },
  // As wide as the old legend-plus-value pair, so weight × reps keeps its room.
  oneRepMaxColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  volumeColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  oneRepMax: { width: uiGeometry.metricValueWidth + uiSpace.sm },
  volume: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  weightReps: {
    flex: 1,
    minWidth: 0,
  },
});
