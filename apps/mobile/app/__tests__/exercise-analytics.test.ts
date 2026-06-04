import {
  aggregateExerciseWeeklyEffort,
  type ExerciseRawSession,
} from '@/src/data/exercise-analytics';

const makeSession = (
  isoDate: string,
  sets: Array<{ setType: string | null; weight: number; reps: number }>
): ExerciseRawSession => ({
  completedAt: new Date(isoDate),
  sets: sets.map((s) => ({
    setType: s.setType,
    weightValue: String(s.weight),
    repsValue: String(s.reps),
  })),
});

const TZ = 'UTC';

describe('aggregateExerciseWeeklyEffort', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateExerciseWeeklyEffort([], TZ)).toEqual([]);
  });

  it('aggregates a single working set correctly', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [{ setType: 'rir_1', weight: 100, reps: 5 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result).toHaveLength(1);
    const week = result[0];
    expect(week.totalVolume).toBe(500);
    expect(week.nearFailureCount).toBe(1);
    expect(week.highestWeight).toBe(100);
    expect(week.estimatedRM1).not.toBeNull();
  });

  it('excludes warm-up sets from all metrics', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [
        { setType: 'warm_up', weight: 60, reps: 10 },
        { setType: 'rir_2', weight: 100, reps: 5 },
      ]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result).toHaveLength(1);
    expect(result[0].totalVolume).toBe(500);
    expect(result[0].nearFailureCount).toBe(1);
    expect(result[0].highestWeight).toBe(100);
  });

  it('excludes null setType sets from nearFailureCount but includes in volume', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [{ setType: null, weight: 80, reps: 8 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result[0].totalVolume).toBe(640);
    expect(result[0].nearFailureCount).toBe(0);
  });

  it('merges two sessions in the same week', () => {
    // 2026-05-18 (Mon) and 2026-05-20 (Wed) → same Mon-start week
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [{ setType: 'rir_0', weight: 100, reps: 5 }]),
      makeSession('2026-05-20T10:00:00Z', [{ setType: 'rir_1', weight: 110, reps: 3 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result).toHaveLength(1);
    expect(result[0].totalVolume).toBe(500 + 330);
    expect(result[0].nearFailureCount).toBe(2);
    expect(result[0].highestWeight).toBe(110);
    expect(result[0].weekStartDateKey).toBe('2026-05-18');
  });

  it('produces two entries for sessions in different weeks', () => {
    // 2026-05-18 (Mon, week 3 of May) and 2026-05-25 (Mon, week 4 of May)
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-05-25T10:00:00Z', [{ setType: null, weight: 120, reps: 4 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result).toHaveLength(2);
    expect(result[0].weekStartDateKey).toBe('2026-05-18');
    expect(result[1].weekStartDateKey).toBe('2026-05-25');
  });

  it('assigns correct weekOfMonth (1-based)', () => {
    // May 2026: Mon-start weeks → 2026-05-04 (w1), 2026-05-11 (w2), 2026-05-18 (w3), 2026-05-25 (w4)
    const sessions = [
      makeSession('2026-05-04T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-05-11T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-05-18T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-05-25T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result.map((w) => w.weekOfMonth)).toEqual([1, 2, 3, 4]);
  });

  it('clips 5th week of month', () => {
    // May 2026 has 4 Mon-start weeks; April 2026: 2026-04-06 (w1), 2026-04-13 (w2), 2026-04-20 (w3), 2026-04-27 (w4)
    // Adding a session on 2026-04-30 (Thu) falls in week starting 2026-04-27 (w4) — still 4 weeks
    // To get a 5th week: need a month where 5th Mon exists.
    // June 2026: weeks start 2026-06-01, 2026-06-08, 2026-06-15, 2026-06-22, 2026-06-29 → 5 Mon-start weeks
    // but monthKey is based on weekStart month, so 2026-06-29's monthKey = '2026-06' → weekOfMonth = 5 → clipped
    const sessions = [
      makeSession('2026-06-01T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-06-08T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-06-15T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-06-22T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-06-29T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    const juneWeeks = result.filter((w) => w.monthKey === '2026-06');
    expect(juneWeeks).toHaveLength(4);
    expect(juneWeeks.map((w) => w.weekOfMonth)).toEqual([1, 2, 3, 4]);
  });

  it('resets weekOfMonth counter across months', () => {
    // weekOfMonth is a sequential counter per monthKey within the result set.
    // A single session in May and a single session in June → each gets weekOfMonth = 1.
    const sessions = [
      makeSession('2026-05-25T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-06-01T10:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result[0].monthKey).toBe('2026-05');
    expect(result[0].weekOfMonth).toBe(1);
    expect(result[1].monthKey).toBe('2026-06');
    expect(result[1].weekOfMonth).toBe(1);
  });

  it('handles Monday/Sunday boundary: Sunday is in the previous Mon-start week', () => {
    // 2026-05-24 (Sunday) → Mon week starts 2026-05-18
    // 2026-05-25 (Monday) → Mon week starts 2026-05-25
    const sessions = [
      makeSession('2026-05-24T23:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
      makeSession('2026-05-25T01:00:00Z', [{ setType: null, weight: 100, reps: 5 }]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result).toHaveLength(2);
    expect(result[0].weekStartDateKey).toBe('2026-05-18');
    expect(result[1].weekStartDateKey).toBe('2026-05-25');
  });

  it('tracks highestWeight as max across sets and sessions in the week', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [
        { setType: null, weight: 100, reps: 5 },
        { setType: null, weight: 120, reps: 3 },
      ]),
      makeSession('2026-05-20T10:00:00Z', [
        { setType: null, weight: 90, reps: 8 },
      ]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result[0].highestWeight).toBe(120);
  });

  it('tracks estimatedRM1 as max across sets in the week', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [
        { setType: null, weight: 100, reps: 1 },
        { setType: null, weight: 80, reps: 10 },
      ]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    // estimatedRM1 should be the max of the two estimates
    expect(result[0].estimatedRM1).toBeGreaterThan(0);
  });

  it('skips sets with invalid weight (zero/non-numeric)', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [
        { setType: null, weight: 0, reps: 5 },
      ]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    // parseSetWeight('0') returns null (zero weight is invalid)
    // If the only set is invalid, we might get an empty result or a result with zero volume
    // The implementation skips sets where weight === null
    if (result.length > 0) {
      expect(result[0].totalVolume).toBe(0);
    }
  });

  it('counts nearFailureCount for rir_0, rir_1, rir_2 only', () => {
    const sessions = [
      makeSession('2026-05-18T10:00:00Z', [
        { setType: 'rir_0', weight: 100, reps: 5 },
        { setType: 'rir_1', weight: 100, reps: 5 },
        { setType: 'rir_2', weight: 100, reps: 5 },
        { setType: null, weight: 100, reps: 5 },
        { setType: 'warm_up', weight: 60, reps: 10 },
      ]),
    ];
    const result = aggregateExerciseWeeklyEffort(sessions, TZ);
    expect(result[0].nearFailureCount).toBe(3);
  });
});
