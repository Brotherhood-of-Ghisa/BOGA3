import {
  aggregateExerciseCatalogStats,
  type ExerciseCatalogStatsRawHistory,
} from '@/src/data/exercise-catalog-stats';
import { estimateOneRepMax } from '@/src/exercise-calculations';

const NOW = new Date('2026-05-22T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

const buildRawHistory = (
  overrides: Partial<ExerciseCatalogStatsRawHistory> = {}
): ExerciseCatalogStatsRawHistory => ({
  sessions: [
    { id: 'session-recent', completedAt: daysBefore(NOW, 3) },
    { id: 'session-mid', completedAt: daysBefore(NOW, 20) },
    { id: 'session-old', completedAt: daysBefore(NOW, 200) },
  ],
  sessionExercises: [
    { id: 'se-recent-bench', sessionId: 'session-recent', exerciseDefinitionId: 'ex-bench' },
    { id: 'se-recent-curl', sessionId: 'session-recent', exerciseDefinitionId: 'ex-curl' },
    { id: 'se-mid-bench', sessionId: 'session-mid', exerciseDefinitionId: 'ex-bench' },
    { id: 'se-old-squat', sessionId: 'session-old', exerciseDefinitionId: 'ex-squat' },
    { id: 'se-orphan', sessionId: 'session-recent', exerciseDefinitionId: null },
  ],
  exerciseSets: [
    // Recent bench: 1 warm-up (excluded), 2 working
    { sessionExerciseId: 'se-recent-bench', weightValue: '60', repsValue: '10', setType: 'warm_up' },
    { sessionExerciseId: 'se-recent-bench', weightValue: '100', repsValue: '5', setType: null },
    { sessionExerciseId: 'se-recent-bench', weightValue: '100', repsValue: '4', setType: 'rir_2' },
    // Recent curl: 1 working set
    { sessionExerciseId: 'se-recent-curl', weightValue: '20', repsValue: '12', setType: null },
    // Mid bench (in 30d, not in 7d): 1 working set with invalid weight (should be skipped)
    { sessionExerciseId: 'se-mid-bench', weightValue: '', repsValue: '8', setType: null },
    { sessionExerciseId: 'se-mid-bench', weightValue: '90', repsValue: '6', setType: null },
    // Old squat (200 days ago, only in 1y / all): 1 working set
    { sessionExerciseId: 'se-old-squat', weightValue: '120', repsValue: '5', setType: null },
    // Orphan: should be ignored entirely (exerciseDefinitionId is null)
    { sessionExerciseId: 'se-orphan', weightValue: '50', repsValue: '10', setType: null },
  ],
  ...overrides,
});

describe('aggregateExerciseCatalogStats', () => {
  it('returns empty aggregates and empty everDoneIds for empty history', () => {
    const result = aggregateExerciseCatalogStats(
      { sessions: [], sessionExercises: [], exerciseSets: [] },
      30,
      NOW
    );
    expect(result.aggregatesById.size).toBe(0);
    expect(result.everDoneIds.size).toBe(0);
  });

  it('includes warm-up sets in volume and 1RM', () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 7, NOW);
    const bench = result.aggregatesById.get('ex-bench');
    expect(bench).toBeDefined();
    // 60*10 + 100*5 + 100*4 = 1500
    expect(bench?.totalVolume).toBe(1500);
    // Best Wathan estimate of 100x5 vs 100x4 — 5 reps is higher
    expect(bench?.estimatedOneRepMax).toBeCloseTo(estimateOneRepMax(100, 5)!, 5);
  });

  it('counts distinct sessions per exercise definition within the period', () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 30, NOW);
    const bench = result.aggregatesById.get('ex-bench');
    // session-recent and session-mid both contain bench within 30d
    expect(bench?.sessionCount).toBe(2);
    const curl = result.aggregatesById.get('ex-curl');
    expect(curl?.sessionCount).toBe(1);
  });

  it('skips unparseable weight/reps but still counts the exercise as everDone', () => {
    const result = aggregateExerciseCatalogStats(
      {
        sessions: [{ id: 's1', completedAt: daysBefore(NOW, 1) }],
        sessionExercises: [{ id: 'se1', sessionId: 's1', exerciseDefinitionId: 'ex-only-bad' }],
        exerciseSets: [
          { sessionExerciseId: 'se1', weightValue: '', repsValue: '', setType: null },
          { sessionExerciseId: 'se1', weightValue: 'NaN', repsValue: '5', setType: null },
        ],
      },
      30,
      NOW
    );
    expect(result.everDoneIds.has('ex-only-bad')).toBe(true);
    expect(result.aggregatesById.has('ex-only-bad')).toBe(false);
  });

  it('counts warm-up-only exercises as done', () => {
    const result = aggregateExerciseCatalogStats(
      {
        sessions: [{ id: 's1', completedAt: daysBefore(NOW, 1) }],
        sessionExercises: [{ id: 'se1', sessionId: 's1', exerciseDefinitionId: 'ex-warm-only' }],
        exerciseSets: [
          { sessionExerciseId: 'se1', weightValue: '40', repsValue: '10', setType: 'warm_up' },
        ],
      },
      30,
      NOW
    );
    expect(result.everDoneIds.has('ex-warm-only')).toBe(true);
    expect(result.aggregatesById.get('ex-warm-only')).toEqual(
      expect.objectContaining({
        sessionCount: 1,
        totalVolume: 400,
      })
    );
  });

  it('ignores sessionExercises with null exerciseDefinitionId', () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 30, NOW);
    // Orphan rows must not introduce any exercise id
    for (const id of result.everDoneIds) {
      expect(id).not.toBeNull();
    }
  });

  it('respects the 7d window — older sessions excluded', () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 7, NOW);
    expect(result.aggregatesById.get('ex-bench')?.sessionCount).toBe(1); // only session-recent
    expect(result.aggregatesById.has('ex-squat')).toBe(false); // 200d ago
  });

  it('respects the 365d window — squat included, mid bench included', () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 365, NOW);
    expect(result.aggregatesById.get('ex-squat')?.sessionCount).toBe(1);
    expect(result.aggregatesById.get('ex-bench')?.sessionCount).toBe(2);
  });

  it("includes everything for period='all'", () => {
    const result = aggregateExerciseCatalogStats(buildRawHistory(), 'all', NOW);
    expect(result.aggregatesById.get('ex-squat')?.sessionCount).toBe(1);
    expect(result.aggregatesById.get('ex-bench')?.sessionCount).toBe(2);
    expect(result.everDoneIds.has('ex-squat')).toBe(true);
    expect(result.everDoneIds.has('ex-bench')).toBe(true);
    expect(result.everDoneIds.has('ex-curl')).toBe(true);
  });

  it('everDoneIds is independent of selected period', () => {
    const seven = aggregateExerciseCatalogStats(buildRawHistory(), 7, NOW);
    const all = aggregateExerciseCatalogStats(buildRawHistory(), 'all', NOW);
    expect(seven.everDoneIds).toEqual(all.everDoneIds);
    // Squat falls outside 7d window but is still everDone
    expect(seven.everDoneIds.has('ex-squat')).toBe(true);
  });
});
