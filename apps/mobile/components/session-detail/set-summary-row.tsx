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
export function SetSummaryRow({ row, testID, hideDerivedMetrics = false, percentageMetrics = false, wrapMetrics = false }:
  { row: SessionViewSetRow; testID: string; hideDerivedMetrics?: boolean; percentageMetrics?: boolean; wrapMetrics?: boolean }) {
  const text = useUiText();
  const tone = useUiTextTone();
  const state = row.done ? 'realised' : 'planned';
  const display = (value: string) => percentageMetrics ? value.replace(' %BW', '%') : value;
  const metrics = !hideDerivedMetrics && row.recordingMode !== 'hold' ? <>
    <View style={[styles.metricColumn, !wrapMetrics && styles.oneRepMaxColumn]} testID={`${testID}-1rm-column`}>
      <Stat
        emphasis={row.done && row.oneRepMaxRecord ? 'record' : 'none'}
        label="1RM"
        layout="inline"
        state={state}
        testID={`${testID}-1rm`}
        value={display(row.oneRepMax)}
        spokenValue={row.oneRepMax}
        valueWidth="hug"
      />
    </View>
    <View style={[styles.metricColumn, !wrapMetrics && styles.volumeColumn, percentageMetrics && styles.percentageVolumeColumn]} testID={`${testID}-vol-column`}>
      <Stat
        label="Vol"
        layout="inline"
        state={state}
        testID={`${testID}-vol`}
        value={display(row.volume)}
        spokenValue={row.volume}
        valueWidth="hug"
      />
    </View>
  </> : null;

  return (
    <View style={[styles.setRow, percentageMetrics && styles.percentageRow, wrapMetrics && styles.wrappingRow]} testID={testID}>
      <Text accessibilityLabel={row.typeLabel} allowFontScaling={false} numberOfLines={1} style={[text.label, row.done ? tone.ink : tone.faint, styles.effortColumn]}>
        <FigureText>{row.typeLabel === 'Technique' ? 'Tech' : row.typeLabel}</FigureText>
      </Text>
      <Text
        allowFontScaling={false}
        accessibilityLabel={row.recordingMode === 'hold' ? row.weightReps.replace(/ s$/, ' seconds') : percentageMetrics ? row.weightReps : undefined}
        numberOfLines={wrapMetrics ? undefined : 1}
        style={[text.figure, row.done ? (row.weightRecord ? tone.record : null) : tone.faint, styles.weightReps, wrapMetrics && styles.wrappingWeight]}
        testID={`${testID}-values`}>
        {display(row.weightReps)}
      </Text>
      {wrapMetrics && metrics ? <View style={styles.wrappingMetrics}>{metrics}</View> : metrics}
    </View>
  );
}

const styles = StyleSheet.create({
  percentageRow: {
    gap: uiSpace.xs,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  wrappingRow: { flexWrap: 'wrap', columnGap: uiSpace.xs },
  wrappingWeight: { minWidth: 86 },
  wrappingMetrics: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: uiSpace.sm, marginLeft: 'auto' },
  effortColumn: {
    width: uiGeometry.tapTarget,
  },
  // 1RM and VOL as two fixed columns: each value right-aligned
  // in its column, its legend a fixed gap to its left, so a legend reads with
  // its own value and not the next column's.
  metricColumn: {
    alignItems: 'flex-end',
  },
  // As wide as the old legend-plus-value pair, so weight × reps keeps its room.
  oneRepMaxColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl + uiSpace.sm },
  volumeColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  percentageVolumeColumn: { width: uiGeometry.metricValueWidth + uiSpace.xl + uiSpace.lg },
  weightReps: {
    flex: 1,
    minWidth: 0,
  },
});
