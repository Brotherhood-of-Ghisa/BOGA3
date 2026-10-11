import { formatVolumeDelta } from '@/app/(tabs)/stats-history';
import { formatExerciseVolumeComparison } from '@/components/session-complete/exercise-volume-card';
import { formatVolume } from '@/src/exercise-calculations/format';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

it('does not render an infinite percentage from otherwise finite complete volumes', () => {
  expect(formatVolumeDelta(1e308, 1e-308)).toEqual({ text: 'Increased', tone: 'positive' });
  expect(formatVolumeDelta(110, 100)).toEqual({ text: '+10%', tone: 'positive' });
  expect(formatVolumeDelta(null, 100)).toEqual({ text: '—', tone: 'neutral' });
  expect(formatVolume(1e308)).toBe('1e+308');
  const comparison: ExerciseVolumeComparison = {
    exerciseDefinitionId: 'pull', exerciseName: 'Pull-up', sessionExerciseIds: ['ex'], sessionExerciseOrderIndex: 0,
    currentVolume: 1e308, medianVolume: 1e-308, percentile25Volume: 1e-308, percentile75Volume: 1e-308,
    workingSetCount: 1, historicalSessionCount: 1, state: 'single-baseline',
  };
  expect(formatExerciseVolumeComparison(comparison)).toBe('Above median');
  // An overflowed sum is dashed, never explained ([[copy.no-inline-explanation]]).
  expect(formatExerciseVolumeComparison({ ...comparison, currentVolume: null, state: 'unavailable' })).toBe('—');
  expect(formatExerciseVolumeComparison({ ...comparison, medianVolume: null })).toBe('No comparison history yet');
});
