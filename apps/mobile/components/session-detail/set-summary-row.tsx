import { StyleSheet, Text, View } from 'react-native';

import { Stat } from '@/components/ui/stat';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

// One read-only set: type · weight × reps · 1RM · VOL. No control column — a
// card of these rows is read, not edited (`ux-rules` §14b.4). Every
// figure in a row shares the row's colour and weight; only the record set's
// 1RM and Weight records stand out, in `record`, as on the exercise page
// (decided on device 2026-09-23: per-column bests read as noise).
export function SetSummaryRow({ row, testID, hideDerivedMetrics = false }: { row: SessionViewSetRow; testID: string; hideDerivedMetrics?: boolean }) {
  const state = row.done ? 'realised' : 'planned';
  return (
    <View style={styles.setRow} testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.type, row.done ? null : styles.typePlanned]}>
        {row.typeLabel}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[styles.weightReps, row.done ? (row.weightRecord ? styles.valueRecord : null) : styles.valuePlanned]}
        testID={`${testID}-values`}>
        {row.weightReps}
      </Text>
      {!hideDerivedMetrics ? <>
      <Stat
        emphasis={row.done && row.oneRepMaxRecord ? 'record' : 'none'}
        label="1RM"
        layout="inline"
        rank="primary"
        state={state}
        testID={`${testID}-1rm`}
        value={row.oneRepMax}
      />
      <Stat
        label="Vol"
        layout="inline"
        rank="primary"
        state={state}
        testID={`${testID}-vol`}
        value={row.volume}
      />
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  setRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  type: {
    width: uiGeometry.tapTarget,
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
