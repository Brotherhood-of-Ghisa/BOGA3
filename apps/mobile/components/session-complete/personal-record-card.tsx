import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Stat } from '@/components/ui/stat';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExercisePersonalRecord } from '@/src/session-insights';
import { recordBand } from '@/src/session-insights/record-band';

type PersonalRecordCardProps = {
  personalRecord: ExercisePersonalRecord;
  testID: string;
};

/**
 * One exercise's record set on the completion screen, in the language's one
 * superlative: a `record` band (`New 1RM record` or `New top weight`), then
 * the exercise and the set, with the figures it set bold `record`
 * (`design-language.md` §5). A Weight record's 1RM stays in `ink`.
 */
export function PersonalRecordCard({ personalRecord, testID }: PersonalRecordCardProps) {
  const band = recordBand(personalRecord);
  const oneRepMax =
    personalRecord.estimatedOneRepMax === null ? '—' : formatOneRepMax(personalRecord.estimatedOneRepMax);
  const set = `${formatWeight(personalRecord.weight)} × ${personalRecord.reps}`;
  const heading = personalRecord.kind === 'oneRepMax' ? 'New 1RM record' : 'New top weight';

  return (
    <Card testID={testID}>
      <View
        accessibilityLabel={`${heading} for ${personalRecord.exerciseName}: ${set}, 1RM ${oneRepMax}`}
        accessible>
        <View style={styles.band}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} style={styles.bandLabel}>{band.label}</Text>
        </View>
        <View style={styles.body}>
          <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
            {personalRecord.exerciseName}
          </Text>
          <View style={styles.row}>
            <Text
              allowFontScaling={false}
              style={[styles.set, personalRecord.weightRecord ? styles.setRecord : null]}
              testID={`${testID}-set`}>
              {set}
            </Text>
            <Stat
              emphasis={personalRecord.kind === 'oneRepMax' ? 'record' : 'none'}
              label="1RM"
              layout="inline"
              testID={`${testID}-1rm`}
              value={oneRepMax}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.recordWash,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.recordRule,
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
  body: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  set: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  setRecord: {
    fontWeight: '700',
    color: uiRoles.record,
  },
});
