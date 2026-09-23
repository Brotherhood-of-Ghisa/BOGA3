import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Stat } from '@/components/ui/stat';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionViewExerciseCard, SessionViewSetRow } from '@/src/session-recorder/session-view-model';

type SessionExerciseCardProps = {
  card: SessionViewExerciseCard;
  onPress: () => void;
};

// One read-only set: type · weight × reps · 1RM · VOL. No control column — the
// whole card is the one target (build spec, "Session view"). Every figure in a
// row shares the row's colour and weight; only a record 1RM stands out, in
// `record` (decided on device 2026-09-23: per-column bests read as noise).
function SetSummaryRow({ row, testID }: { row: SessionViewSetRow; testID: string }) {
  const state = row.done ? 'realised' : 'planned';
  return (
    <View style={styles.setRow} testID={testID}>
      <Text numberOfLines={1} style={[styles.type, row.done ? null : styles.typePlanned]}>
        {row.typeLabel}
      </Text>
      <Text numberOfLines={1} style={[styles.weightReps, row.done ? null : styles.valuePlanned]}>
        {row.weightReps}
      </Text>
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
    </View>
  );
}

// An exercise in the session view: a read-only card that links to the exercise
// page, showing its sets, an `n/m` done count and, when a set in it is an
// all-time best, a `record` band.
export function SessionExerciseCard({ card, onPress }: SessionExerciseCardProps) {
  const testID = `session-view-exercise-${card.id}`;
  const label = [
    card.name,
    `${card.doneCount} of ${card.totalCount} sets done`,
    card.recordOneRepMax ? `new 1RM record ${card.recordOneRepMax}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card accessibilityLabel={label} onPress={onPress} testID={testID}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.name}>
          {card.name}
        </Text>
        <Text style={[styles.count, card.doneCount === 0 ? styles.countNone : null]} testID={`${testID}-count`}>
          {`${card.doneCount}/${card.totalCount}`}
        </Text>
        <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
      </View>
      {card.rows.length > 0 ? (
        <View style={styles.rows}>
          {card.rows.map((row, index) => (
            <SetSummaryRow key={row.id} row={row} testID={`${testID}-set-${index + 1}`} />
          ))}
        </View>
      ) : null}
      {card.recordOneRepMax ? (
        <View style={styles.band} testID={`${testID}-record`}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text style={styles.bandLabel}>{`New 1RM record · ${card.recordOneRepMax}`}</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  name: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  count: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  countNone: {
    color: uiRoles.planned,
  },
  rows: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
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
    color: uiRoles.planned,
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
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.recordWash,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  bandLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.record,
  },
});
