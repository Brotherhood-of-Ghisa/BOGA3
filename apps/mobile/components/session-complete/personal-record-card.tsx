import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { personalRecordCount, type ExercisePersonalRecord } from '@/src/session-insights';
import { personalRecordLines } from '@/src/session-insights/record-band';

type PersonalRecordCardProps = {
  personalRecord: ExercisePersonalRecord;
  testID: string;
};

const formatRecordCount = (count: number): string => `${count} ${count === 1 ? 'record' : 'records'}`;

/**
 * One exercise's records in a session summary (View Session and completion):
 * the exercise and its PR count, then a line per record set — what it took,
 * then the set — and a Volume line. A plain list in `ink`: the section heading
 * already says these are records, so no band or `record` emphasis.
 */
export function PersonalRecordCard({ personalRecord, testID }: PersonalRecordCardProps) {
  const count = formatRecordCount(personalRecordCount(personalRecord));
  const lines = personalRecordLines(personalRecord);

  return (
    <Card testID={testID}>
      <View
        accessibilityLabel={`${personalRecord.exerciseName}, ${count}: ${lines.map((line) => line.spoken).join('; ')}`}
        accessible
        style={styles.body}>
        <View style={styles.header}>
          <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
            {personalRecord.exerciseName}
          </Text>
          <Text allowFontScaling={false} style={styles.count} testID={`${testID}-count`}>{count}</Text>
        </View>
        {lines.map((line, index) => (
          <View key={line.key} style={styles.line} testID={`${testID}-line-${index + 1}`}>
            <Text allowFontScaling={false} style={styles.label}>{line.label}</Text>
            {line.set ? (
              <Text allowFontScaling={false} numberOfLines={1} style={styles.set}>{line.set}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  // The exercise card's header (`ExerciseSetsCard`): name, then its count.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
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
  line: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  label: {
    flex: 1,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  set: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
});
