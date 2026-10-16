import { StyleSheet, Text, View } from 'react-native';

import { RecordBand } from '@/components/session-detail';
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
 * the exercise and its PR count above the shared record-band footer.
 * Only the achievements and their earning sets; full set details live in Sets.
 */
export function PersonalRecordCard({ personalRecord, testID }: PersonalRecordCardProps) {
  const count = formatRecordCount(personalRecordCount(personalRecord));
  const lines = personalRecordLines(personalRecord);

  return (
    <Card testID={testID}>
      <View
        accessibilityLabel={`${personalRecord.exerciseName}, ${count}: ${lines.map((line) => line.spoken).join('; ')}`}
        accessible>
        <View style={styles.header}>
          <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
            {personalRecord.exerciseName}
          </Text>
          <Text allowFontScaling={false} style={styles.count} testID={`${testID}-count`}>{count}</Text>
        </View>
        <RecordBand lines={lines} placement="footer" testID={`${testID}-record`} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The exercise card's header (`ExerciseSetsCard`): name, then its count.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
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
});
