import { StyleSheet, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { InjuryBadge } from '@/components/injuries/injury-badge';
import { uiSpace } from '@/components/ui/tokens';
import type { SessionViewExerciseCard } from '@/src/session-recorder/session-view-model';

type SessionExerciseCardProps = {
  card: SessionViewExerciseCard;
  onPress?: () => void;
};

// An exercise in the session view: a read-only card that links to the exercise
// page, showing its sets, an `n/m` done count and a `record` band with a line
// per record it holds.
export function SessionExerciseCard({ card, onPress }: SessionExerciseCardProps) {
  const label = [
    card.name,
    card.injuryWarning ? `Injury warning ${card.injuryWarning}` : null,
    `${card.doneCount} of ${card.totalCount} sets done`,
    ...card.record.map((line) => line.spoken),
  ]
    .filter(Boolean)
    .join(', ');

  const accessory = (
    <View style={styles.accessory}>
      {card.injuryWarning ? (
        <InjuryBadge
          severity={card.injuryWarning}
          testID={`session-view-exercise-${card.id}-injury-badge`}
        />
      ) : null}
      {onPress ? <Icon colorRole="inkFaint" name="chevron-right" size="sm" /> : null}
    </View>
  );

  return (
    <ExerciseSetsCard
      accessibilityLabel={label}
      accessory={accessory}
      count={`${card.doneCount}/${card.totalCount}`}
      countMuted={card.doneCount === 0}
      name={card.name}
      onPress={onPress}
      record={card.record}
      rows={card.rows}
      testID={`session-view-exercise-${card.id}`}
    />
  );
}

const styles = StyleSheet.create({
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});
