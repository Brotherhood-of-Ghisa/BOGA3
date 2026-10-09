import { partitionVolumeComparisons, type ExerciseVolumeComparison } from '@/src/session-insights';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

const comparison = (
  exerciseName: string,
  overrides: Partial<ExerciseVolumeComparison> = {},
): ExerciseVolumeComparison => ({
  exerciseDefinitionId: exerciseName, exerciseName, sessionExerciseIds: [exerciseName], sessionExerciseOrderIndex: 0,
  workingSetCount: 2, currentVolume: 500, historicalSessionCount: MIN_HISTORY_OBSERVATIONS,
  medianVolume: 400, percentile25Volume: 300, percentile75Volume: 600, state: 'distribution',
  ...overrides,
});

// The cutoff decides which exercise gets a card ([[session.volume-comparison]]).
it.each([[MIN_HISTORY_OBSERVATIONS - 1, false], [MIN_HISTORY_OBSERVATIONS, true]])(
  'draws a card at %i prior observations: %s',
  (historicalSessionCount, drawn) => {
    const { comparable, unavailable } = partitionVolumeComparisons([
      comparison('Bench Press', { historicalSessionCount: historicalSessionCount as number }),
    ]);
    expect(comparable).toHaveLength(drawn ? 1 : 0);
    expect(unavailable).toEqual(drawn ? [] : ['Bench Press']);
  }
);

it.each([
  ['an unavailable session volume', { currentVolume: null, state: 'unavailable' as const }],
  ['a missing median', { medianVolume: null }],
  ['a missing lower quartile', { percentile25Volume: null }],
  ['a missing upper quartile', { percentile75Volume: null }],
])('pools %s even with the observations', (_case, overrides) => {
  const { comparable, unavailable } = partitionVolumeComparisons([comparison('Bench Press', overrides)]);
  expect(comparable).toEqual([]);
  expect(unavailable).toEqual(['Bench Press']);
});

it('keeps the session order in both halves', () => {
  const { comparable, unavailable } = partitionVolumeComparisons([
    comparison('Squat'),
    comparison('Pull-Up', { historicalSessionCount: 0, medianVolume: null, percentile25Volume: null, percentile75Volume: null, state: 'no-history' }),
    comparison('Bench Press'),
    comparison('Curl', { historicalSessionCount: 1, state: 'single-baseline' }),
  ]);
  expect(comparable.map((entry) => entry.exerciseName)).toEqual(['Squat', 'Bench Press']);
  expect(unavailable).toEqual(['Pull-Up', 'Curl']);
});
