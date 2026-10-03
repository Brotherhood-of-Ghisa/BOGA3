import { formatVolumeDelta } from '@/app/(tabs)/stats-history';
import { formatExerciseVolumeComparison, formatVolumeFigure } from '@/components/session-complete/exercise-volume-card';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

it('does not render an infinite percentage from otherwise finite complete volumes', () => {
  expect(formatVolumeDelta(1e308, 1e-308)).toEqual({ text: 'Increased', tone: 'positive' });
  expect(formatVolumeDelta(110, 100)).toEqual({ text: '+10%', tone: 'positive' });
  expect(formatVolumeDelta(null, 100)).toEqual({ text: 'Incomplete', tone: 'neutral' });
  expect(formatVolumeFigure(1e308)).toBe('1e+308');
  const comparison: ExerciseVolumeComparison = {
    exerciseDefinitionId: 'pull', exerciseName: 'Pull-up', sessionExerciseIds: ['ex'], sessionExerciseOrderIndex: 0,
    currentVolume: 1e308, medianVolume: 1e-308, percentile5Volume: 1e-308, percentile95Volume: 1e-308,
    workingSetCount: 1, historicalSessionCount: 1, state: 'single-baseline',
  };
  expect(formatExerciseVolumeComparison(comparison)).toBe('Above median');
  expect(formatExerciseVolumeComparison({ ...comparison, currentVolume: null, knownVolume: 100 }))
    .toBe('Incomplete · comparison unavailable');
  expect(formatExerciseVolumeComparison({ ...comparison, medianVolume: null, excludedHistoricalSessionCount: 1 }))
    .toBe('No complete comparison history');
});
