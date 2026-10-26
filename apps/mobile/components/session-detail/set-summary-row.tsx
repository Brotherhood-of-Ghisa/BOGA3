import { StyleSheet, Text, View } from 'react-native';

import { Stat } from '@/components/ui/stat';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
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
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.effortColumn, styles.type, row.done ? null : styles.typePlanned]}>
        {row.typeLabel}
      </Text>
      <Text
        allowFontScaling={false}
        accessibilityLabel={percentageMetrics ? row.weightReps : undefined}
        numberOfLines={1}
        style={[styles.weightReps, row.done ? (row.weightRecord ? styles.valueRecord : null) : styles.valuePlanned]}
        testID={`${testID}-values`}>
        {percentageMetrics ? row.weightReps.replace(' %BW', '') : row.weightReps}
      </Text>
      {!hideDerivedMetrics ? percentageMetrics ? <>
        <Text allowFontScaling={false} numberOfLines={1}
          accessibilityLabel={`1RM ${row.oneRepMax}`}
          style={[styles.metric, styles.oneRepMax, row.done ? (row.oneRepMaxRecord ? styles.valueRecord : null) : styles.valuePlanned]}
          testID={`${testID}-1rm`}>{row.oneRepMax.replace(' %BW', '')}</Text>
        <Text allowFontScaling={false} numberOfLines={1}
          accessibilityLabel={`Vol ${row.volume}`}
          style={[styles.metric, styles.volume, row.done ? null : styles.valuePlanned]}
          testID={`${testID}-vol`}>{row.volume.replace(' %BW·reps', '')}</Text>
      </> : <>
      <Stat
        emphasis={row.done && row.oneRepMaxRecord ? 'record' : 'none'}
        label="1RM"
        layout="inline"
        state={state}
        testID={`${testID}-1rm`}
        value={row.oneRepMax}
      />
      <Stat
        label="Vol"
        layout="inline"
        state={state}
        testID={`${testID}-vol`}
        value={row.volume}
      />
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
  type: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
  typePlanned: {
    color: uiRoles.inkGhost,
  },
  metric: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
    textAlign: 'right',
  },
  oneRepMax: { width: uiGeometry.metricValueWidth + uiSpace.sm },
  volume: { width: uiGeometry.metricValueWidth + uiSpace.xl },
  weightReps: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  valuePlanned: {
    color: uiRoles.inkFaint,
  },
  valueRecord: {
    fontWeight: '700',
    color: uiRoles.record,
  },
});
