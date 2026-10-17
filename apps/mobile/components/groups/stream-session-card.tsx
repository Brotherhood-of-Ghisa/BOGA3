import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Icon, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type {
  CompetitionSessionCard as StreamSessionCardViewModel,
  CompetitionSessionRecordLine,
} from '@/src/groups/competition-stream-view-model';

type GroupStreamSessionCardProps = {
  card: StreamSessionCardViewModel;
  /** In All, name the groups holding the share. */
  showGroupNames: boolean;
  onPress: (card: StreamSessionCardViewModel) => void;
  /** Opens one of the session's records; without it the lines are not pressable. */
  onPressRecord?: (key: string) => void;
};

/** One group record the session took, under its figures. */
function RecordLine({ line, onPress, testID }: { line: CompetitionSessionRecordLine; onPress?: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityHint={onPress ? 'Opens the record' : undefined}
      accessibilityLabel={line.accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.recordLine, pressed ? styles.recordPressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.recordExercise}>
        {line.exercise}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.recordValue}>
        {line.value}
      </Text>
    </Pressable>
  );
}

/**
 * Stream session card (08 UX pattern "Stream card"): a collapsed summary with
 * no expand; a tap opens the friend's session view. "Training now" is the
 * `set-current` ring and the words, never a colour (G3).
 */
export function GroupStreamSessionCard({ card, showGroupNames, onPress, onPressRecord }: GroupStreamSessionCardProps) {
  const testID = `group-stream-session-card-${card.key}`;
  const context = [card.startedAtLabel, card.gymName?.trim() || null].filter(Boolean).join(' · ');
  const records = card.records;

  return (
    <Card
      accessibilityLabel={[card.memberName, card.statusLabel, context, card.setsLabel, card.exercisesLabel,
        records.length > 0 ? `${records.length} group record${records.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}
      onPress={() => onPress(card)}
      style={styles.card}
      testID={testID}>
      <View style={styles.headerRow}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.member} testID={`${testID}-member`}>
          {card.memberName}
        </Text>
        <View style={styles.status}>
          {card.isTrainingNow ? <Icon name="set-current" size="xs" /> : null}
          <Text
            allowFontScaling={false}
            style={[styles.statusText, card.isTrainingNow ? styles.statusLive : null]}
            testID={`${testID}-status`}>
            {card.statusLabel}
          </Text>
        </View>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.muted} testID={`${testID}-context`}>
        {context}
      </Text>
      <Text allowFontScaling={false} style={styles.metrics} testID={`${testID}-metrics`}>
        {`${card.setsLabel} · ${card.exercisesLabel}`}
      </Text>
      {records.length > 0 ? (
        <View style={styles.records} testID={`${testID}-records`}>
          {records.map((line) => (
            <RecordLine
              key={line.key}
              line={line}
              onPress={onPressRecord ? () => onPressRecord(line.key) : undefined}
              testID={`${testID}-record-${line.key}`}
            />
          ))}
        </View>
      ) : null}
      {showGroupNames && card.groupNames.length > 0 ? (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.muted} testID={`${testID}-groups`}>
          {card.groupNames.join(', ')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  member: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  statusText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  statusLive: {
    fontWeight: '600',
    color: uiRoles.ink,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  // The records sit under the figures, behind a `rule-soft` hairline.
  records: {
    marginTop: uiSpace.xs,
    paddingTop: uiSpace.xs,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
    gap: uiSpace.xs,
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingVertical: uiSpace.xs,
  },
  recordPressed: {
    backgroundColor: uiRoles.paper,
  },
  recordExercise: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  recordValue: {
    flexShrink: 1,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
  },
  metrics: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
