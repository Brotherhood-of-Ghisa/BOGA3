import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Stat } from '@/components/ui/stat';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExercisePersonalRecord } from '@/src/session-insights';
import { formatOneRepMaxFigure, formatWeightFigure } from '@/src/session-recorder/session-view-model';

type PersonalRecordCardProps = {
  personalRecord: ExercisePersonalRecord;
  testID: string;
};

/**
 * One exercise's new 1RM record on the completion screen, in the language's
 * one superlative: a `record` band, then the exercise and the set that set it,
 * its 1RM bold `record` (`design-language.md` §5).
 */
export function PersonalRecordCard({ personalRecord, testID }: PersonalRecordCardProps) {
  const oneRepMax = formatOneRepMaxFigure(personalRecord.estimatedOneRepMax);
  const set = `${formatWeightFigure(personalRecord.weight)} × ${personalRecord.reps}`;

  return (
    <Card testID={testID}>
      <View
        accessibilityLabel={`New 1RM record for ${personalRecord.exerciseName}: ${set}, 1RM ${oneRepMax}`}
        accessible>
        <View style={styles.band}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} style={styles.bandLabel}>{`New 1RM record · ${oneRepMax}`}</Text>
        </View>
        <View style={styles.body}>
          <Text allowFontScaling={false} numberOfLines={2} style={styles.name}>
            {personalRecord.exerciseName}
          </Text>
          <View style={styles.row}>
            <Text allowFontScaling={false} style={styles.set}>{set}</Text>
            <Stat emphasis="record" label="1RM" layout="inline" value={oneRepMax} />
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
});
