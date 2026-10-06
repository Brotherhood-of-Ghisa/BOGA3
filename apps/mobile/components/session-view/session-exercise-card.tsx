import { ExerciseSetsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { uiRoles } from '@/components/ui/tokens';
import type { SessionViewExerciseCard } from '@/src/session-recorder/session-view-model';

type SessionExerciseCardProps = {
  card: SessionViewExerciseCard;
  onPress: () => void;
};

// An exercise in the session view: a read-only card that links to the exercise
// page, showing its sets, an `n/m` done count and a `record` band with a line
// per record it holds.
export function SessionExerciseCard({ card, onPress }: SessionExerciseCardProps) {
  const label = [
    card.name,
    `${card.doneCount} of ${card.totalCount} sets done`,
    ...card.record.map((line) => line.spoken),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ExerciseSetsCard
      accessibilityLabel={label}
      accessory={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />}
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
