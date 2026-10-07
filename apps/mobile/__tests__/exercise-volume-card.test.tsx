import { render, screen } from '@testing-library/react-native';

import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

const comparison: ExerciseVolumeComparison = {
  exerciseDefinitionId: 'bench', exerciseName: 'Bench Press', sessionExerciseIds: ['bench'], sessionExerciseOrderIndex: 0,
  workingSetCount: 2, currentVolume: 500, historicalSessionCount: 0,
  medianVolume: null, percentile5Volume: null, percentile95Volume: null, state: 'no-history',
};

// An overflowed sum is dashed, never explained ([[copy.no-inline-explanation]]).
it('dashes an unavailable Volume with no note and no comparison line', () => {
  render(<ExerciseVolumeCard comparison={{ ...comparison, currentVolume: null, state: 'unavailable' }} testID="card" />);
  expect(screen.getByText('Vol')).toBeTruthy();
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.queryByText(/Known vol|Missing load|excluded|incomplete|first comparable/i)).toBeNull();
  expect(screen.getByLabelText('Bench Press, 2 sets. Session volume unavailable.')).toBeTruthy();
});

it('keeps the first-session line for a known Volume without history', () => {
  render(<ExerciseVolumeCard comparison={comparison} testID="card" />);
  expect(screen.getByText('500')).toBeTruthy();
  expect(screen.getByText('This is the first comparable completed session.')).toBeTruthy();
});
