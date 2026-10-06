import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { RecordLine } from '@/src/session-insights/record-band';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

import { SetSummaryRow } from './set-summary-row';

type ExerciseSetsCardBaseProps = {
  name: string;
  // `figure`: the name is a figure (exercise history's completion stamp), set
  // in Plex Mono like every other figure.
  nameFace?: 'display' | 'figure';
  // The header's count: `2/3` on the session view, `3 sets` on View Session.
  count: string;
  // Faded when nothing is done yet.
  countMuted?: boolean;
  rows: SessionViewSetRow[];
  hideDerivedMetrics?: boolean;
  // The `record` band, one line per record this card holds; empty for none.
  record?: readonly RecordLine[];
  // Under the header, before the set rows (exercise history's gym, tags and
  // session stats). It brings its own insets.
  summary?: ReactNode;
  // An inline glyph after the count (the session view's chevron).
  accessory?: ReactNode;
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

// One exercise's sets as a card: name · count · accessory, the set
// rows, and a `record` band with a line per record the card holds. The session
// view, View Session and the group session view all draw an exercise with it.
export function ExerciseSetsCard({
  name,
  nameFace = 'display',
  count,
  countMuted = false,
  rows,
  hideDerivedMetrics = false,
  record = [],
  summary,
  accessory,
  testID,
  rowTestID,
  onPress,
  accessibilityLabel,
}: ExerciseSetsCardProps) {
  const content = (
    <>
      <View style={styles.header}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.name, nameFace === 'figure' ? styles.nameFigure : null]}>
          {name}
        </Text>
        <Text allowFontScaling={false} style={[styles.count, countMuted ? styles.countMuted : null]} testID={`${testID}-count`}>
          {count}
        </Text>
        {accessory}
      </View>
      {summary}
      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row, index) => (
            <SetSummaryRow
              key={row.id}
              row={row}
              hideDerivedMetrics={hideDerivedMetrics}
              testID={rowTestID ? rowTestID(row, index) : `${testID}-set-${index + 1}`}
            />
          ))}
        </View>
      ) : null}
      {record.length > 0 ? (
        <View style={styles.band} testID={`${testID}-record`}>
          {record.map((line, index) => (
            <View
              key={line.key}
              style={[styles.bandLine, index > 0 ? styles.bandLineRuled : null]}
              testID={`${testID}-record-${index + 1}`}>
              <Icon color={uiRoles.record} name="arrow-up" size="xs" />
              <Text allowFontScaling={false} style={styles.bandLabel}>{line.label}</Text>
              {line.set ? (
                <Text allowFontScaling={false} numberOfLines={1} style={styles.bandSet}>{line.set}</Text>
              ) : null}
            </View>
          ))}
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
  name: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  nameFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
  },
  count: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  countMuted: {
    color: uiRoles.inkGhost,
  },
  rows: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  band: {
    backgroundColor: uiRoles.recordWash,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  bandLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  bandLineRuled: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  // The set a line names, right-aligned in the figure face.
  bandSet: {
    marginLeft: 'auto',
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
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
