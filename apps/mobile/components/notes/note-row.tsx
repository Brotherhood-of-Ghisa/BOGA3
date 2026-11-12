import { StyleSheet, Text, View } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import { parseLocalDateKey, type TrainingNoteView } from '@/src/data/training-notes';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatCompactDate, formatShortDate } from '@/src/utils/local-time';

/** The label of the robot mark on a note an agent wrote. */
export const AGENT_NOTE_LABEL = 'Added by your coach';

/** A note's applies-from date: compact on screen, full numeric when spoken. */
export const noteDateLabels = (notedOn: string, dateFormat: ExerciseDateFormat) => {
  const date = parseLocalDateKey(notedOn);
  return date
    ? { shown: formatCompactDate(date, dateFormat), spoken: formatShortDate(date, dateFormat) }
    : { shown: notedOn, spoken: notedOn };
};

type NoteRowProps = {
  note: TrainingNoteView;
  dateFormat: ExerciseDateFormat;
  // All notes name the exercise (or `General`); one exercise's page does not repeat it.
  showExercise: boolean;
  divider: boolean;
  removing: boolean;
  onRemove: (note: TrainingNoteView) => void;
};

// One note: its date (and exercise), the robot mark when an agent wrote it,
// the text in full, and Remove.
export function NoteRow({ note, dateFormat, showExercise, divider, removing, onRemove }: NoteRowProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  const date = noteDateLabels(note.notedOn, dateFormat);
  const subject = note.exerciseId ? note.exerciseName ?? 'Exercise' : 'General';
  return (
    <ListRow
      density="list"
      divider={divider}
      testID={`note-row-${note.id}`}
      trailing={
        <IconButton
          accessibilityLabel={`Remove note from ${date.spoken}`}
          disabled={removing}
          name="trash"
          onPress={() => onRemove(note)}
          testID={`note-remove-${note.id}`}
          tone="danger"
        />
      }>
      <View style={styles.meta}>
        <Text allowFontScaling={false} style={[text.meta, tone.muted]} testID={`note-meta-${note.id}`}>
          <FigureText>{date.shown}</FigureText>
          {showExercise ? ` · ${subject}` : ''}
        </Text>
        {note.source === 'agent' ? (
          <Icon colorRole="inkMuted" label={AGENT_NOTE_LABEL} name="ai-logging" size="sm" testID={`note-agent-${note.id}`} />
        ) : null}
      </View>
      <Text allowFontScaling={false} selectable style={text.body} testID={`note-body-${note.id}`}>
        {note.body}
      </Text>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});
