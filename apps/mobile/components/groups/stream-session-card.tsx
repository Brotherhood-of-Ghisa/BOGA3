import { Pressable, Text, View } from 'react-native';

import { CompactCard, CompactHeader, FigureText, makeStyles, uiSpace, uiTextEmphasis, useTextRoles } from '@/components/ui';
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
  const styles = useStyles();
  const { text, tone } = useTextRoles();
  return (
    <Pressable
      accessibilityHint={onPress ? 'Opens the record' : undefined}
      accessibilityLabel={line.accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.recordLine, pressed ? styles.recordPressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.meta, tone.ink, uiTextEmphasis.strong, styles.recordExercise]}>
        {line.exercise}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.meta, tone.record, styles.recordValue]} testID={`${testID}-value`}>
        {/* The record line is drawn heavy, its figures as heavy as its words. */}
        <FigureText figureStyle={tone.record}>{line.value}</FigureText>
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
  const styles = useStyles();
  const { text, tone } = useTextRoles();
  const testID = `group-stream-session-card-${card.key}`;
  const context = [card.startedAtLabel, card.gymName?.trim() || null].filter(Boolean).join(' · ');
  const records = card.records;

  return (
    <CompactCard
      accessibilityLabel={[card.memberName, card.statusLabel, context, card.setsLabel, card.exercisesLabel,
        records.length > 0 ? `${records.length} group record${records.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}
      onPress={() => onPress(card)}
      accessibilityActions={onPressRecord ? records.map(line => ({ name: `record-${line.key}`, label: `Open ${line.accessibilityLabel}` })) : undefined}
      onAccessibilityAction={onPressRecord ? event => {
        const record = records.find(line => `record-${line.key}` === event.nativeEvent.actionName);
        if (record) onPressRecord(record.key);
      } : undefined}
      testID={testID}>
      <CompactHeader label={card.statusLabel} metadata={context}
        icon={card.isTrainingNow ? 'set-current' : undefined} tone={card.isTrainingNow ? 'ink' : 'muted'}
        labelTestID={`${testID}-status`} metadataTestID={`${testID}-context`} />
      <Text allowFontScaling={false} numberOfLines={1} style={[text.bodyStrong, styles.member]} testID={`${testID}-member`}>
        {card.memberName}
      </Text>
      <Text allowFontScaling={false} style={[text.meta, tone.ink]} testID={`${testID}-metrics`}>
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
        <Text allowFontScaling={false} numberOfLines={1} style={text.meta} testID={`${testID}-groups`}>
          {card.groupNames.join(', ')}
        </Text>
      ) : null}
    </CompactCard>
  );
}

const useStyles = makeStyles((roles) => ({
  member: { flexShrink: 1, minWidth: 0 },
  // The records sit under the figures, behind a `rule-soft` hairline.
  records: {
    marginTop: uiSpace.xs,
    paddingTop: uiSpace.xs,
    borderTopWidth: 1,
    borderTopColor: roles.ruleSoft,
    gap: uiSpace.xs,
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingVertical: uiSpace.xs,
  },
  recordPressed: {
    backgroundColor: roles.paper,
  },
  recordExercise: {
    flexShrink: 1,
  },
  recordValue: {
    flexShrink: 1,
  },
}));
