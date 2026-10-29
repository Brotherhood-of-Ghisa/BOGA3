import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import type { RecordLine } from '@/src/session-insights/record-band';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';

import { RecordBand } from './record-band';
import { SetSummaryRow } from './set-summary-row';

type ExerciseSetsCardBaseProps = {
  name: string;
  // The header's count: `2/3` on the session view, `3 sets` on View Session;
  // a history week's day or gym. One line, never more than its share.
  count: string;
  // Faded when nothing is done yet.
  countMuted?: boolean;
  rows: SessionViewSetRow[];
  hideDerivedMetrics?: boolean;
  percentageMetrics?: boolean;
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

// A card that is a link must say where it goes (`Card`), and offers a control
// in its `accessory` to VoiceOver as one of its actions.
type ExerciseSetsCardProps = ExerciseSetsCardBaseProps &
  (
    | { onPress?: undefined; accessibilityLabel?: string; accessibilityActions?: undefined; onAccessibilityAction?: undefined }
    | {
        onPress: () => void;
        accessibilityLabel: string;
        accessibilityActions?: readonly AccessibilityActionInfo[];
        onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
      }
  );

// One exercise's sets as a card: name · count · accessory, the set
// rows, and a `record` band with a line per record the card holds. The session
// view, View Session and the group session view all draw an exercise with it.
export function ExerciseSetsCard({
  name,
  count,
  countMuted = false,
  rows,
  hideDerivedMetrics = false,
  percentageMetrics = false,
  record = [],
  summary,
  accessory,
  testID,
  rowTestID,
  onPress,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
}: ExerciseSetsCardProps) {
  const content = (
    <>
      <View style={styles.header}>
        <Text allowFontScaling={false} ellipsizeMode={percentageMetrics ? 'middle' : 'tail'} numberOfLines={1} style={[uiText.title, styles.name]}>
          <FigureText strong>{`${name}${percentageMetrics ? ' (% BW)' : ''}`}</FigureText>
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, styles.count, countMuted ? uiTextTone.faint : null]} testID={`${testID}-count`}>
          <FigureText>{count}</FigureText>
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
              percentageMetrics={percentageMetrics}
              testID={rowTestID ? rowTestID(row, index) : `${testID}-set-${index + 1}`}
            />
          ))}
        </View>
      ) : null}
      <RecordBand lines={record} placement="footer" testID={`${testID}-record`} />
    </>
  );

  return onPress ? (
    <Card
      accessibilityActions={accessibilityActions}
      accessibilityLabel={accessibilityLabel}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      testID={testID}>
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
  },
  count: {
    maxWidth: '45%',
  },
  rows: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
});
