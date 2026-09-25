import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

import { SetSummaryRow } from './set-summary-row';

type ExerciseSetsCardBaseProps = {
  name: string;
  // The header's count: `2/3` on the session view, `3 sets` on View Session.
  count: string;
  // Faded when nothing is done yet.
  countMuted?: boolean;
  rows: SessionViewSetRow[];
  // The record 1RM, formatted, when a set in this exercise is an all-time best.
  recordOneRepMax: string | null;
  // An inline glyph after the count (the session view's chevron).
  accessory?: ReactNode;
  // A 44pt control closing the header (View Session's ⋮); it sits flush with
  // the card's edge and brings its own height.
  control?: ReactNode;
  // `<testID>-count`, `-set-<n>` and `-record` hang off it.
  testID: string;
  // A row's testID, when a caller has its own (the group view keeps
  // `group-session-set-row-<setId>`); default `<testID>-set-<n>`.
  rowTestID?: (row: SessionViewSetRow, index: number) => string;
};

// A card that is a link must say where it goes (`Card`).
type ExerciseSetsCardProps = ExerciseSetsCardBaseProps &
  (
    | { onPress?: undefined; accessibilityLabel?: string }
    | { onPress: () => void; accessibilityLabel: string }
  );

// One exercise's sets as a card: name · count · accessory or control, the set
// rows, and a `record` band when a set in it is an all-time best. The session
// view, View Session and the group session view all draw an exercise with it.
export function ExerciseSetsCard({
  name,
  count,
  countMuted = false,
  rows,
  recordOneRepMax,
  accessory,
  control,
  testID,
  rowTestID,
  onPress,
  accessibilityLabel,
}: ExerciseSetsCardProps) {
  const content = (
    <>
      <View style={[styles.header, control ? styles.headerWithControl : null]}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text allowFontScaling={false} style={[styles.count, countMuted ? styles.countMuted : null]} testID={`${testID}-count`}>
          {count}
        </Text>
        {accessory}
        {control}
      </View>
      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row, index) => (
            <SetSummaryRow
              key={row.id}
              row={row}
              testID={rowTestID ? rowTestID(row, index) : `${testID}-set-${index + 1}`}
            />
          ))}
        </View>
      ) : null}
      {recordOneRepMax ? (
        <View style={styles.band} testID={`${testID}-record`}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} style={styles.bandLabel}>{`New 1RM record · ${recordOneRepMax}`}</Text>
        </View>
      ) : null}
    </>
  );

  return onPress ? (
    <Card accessibilityLabel={accessibilityLabel} onPress={onPress} testID={testID}>
      {content}
    </Card>
  ) : (
    <Card accessibilityLabel={accessibilityLabel} testID={testID}>
      {content}
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
  headerWithControl: {
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
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
  countMuted: {
    color: uiRoles.planned,
  },
  rows: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
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
