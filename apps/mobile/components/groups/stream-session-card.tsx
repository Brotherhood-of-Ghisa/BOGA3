import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, Icon, uiRoles, uiSpace, uiText, uiTextEmphasis, uiTextTone } from '@/components/ui';
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
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, uiTextTone.ink, uiTextEmphasis.strong, styles.recordExercise]}>
        {line.exercise}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, uiTextTone.record, styles.recordValue]} testID={`${testID}-value`}>
        {/* The record line is drawn heavy, its figures as heavy as its words. */}
        <FigureText figureStyle={uiTextTone.record}>{line.value}</FigureText>
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
        <Text allowFontScaling={false} numberOfLines={1} style={[uiText.title, styles.member]} testID={`${testID}-member`}>
          {card.memberName}
        </Text>
        <View style={styles.status}>
          {card.isTrainingNow ? <Icon name="set-current" size="xs" /> : null}
          <Text
            allowFontScaling={false}
            style={[uiText.meta, card.isTrainingNow ? [uiTextTone.ink, uiTextEmphasis.strong] : null]}
            testID={`${testID}-status`}>
            {card.statusLabel}
          </Text>
        </View>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta} testID={`${testID}-context`}>
        <FigureText>{context}</FigureText>
      </Text>
      <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink]} testID={`${testID}-metrics`}>
        <FigureText>{`${card.setsLabel} · ${card.exercisesLabel}`}</FigureText>
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
        <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta} testID={`${testID}-groups`}>
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
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
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
  },
  recordValue: {
    flexShrink: 1,
  },
});
