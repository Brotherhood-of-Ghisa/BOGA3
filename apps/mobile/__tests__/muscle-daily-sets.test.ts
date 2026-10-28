/**
 * Each muscle's working sets per local day ([[muscle.set-count]]): what the
 * Plan page's recovery card reads. Pure; Europe/London (jest.config.js).
 */

import { aggregateMuscleDailySets, type MuscleAnalyticsInput } from '@/src/data';

const local = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour);

const working = (id: string, sessionExerciseId: string) => ({
  id, sessionExerciseId, setType: 'rir_2', weightValue: '100', repsValue: '5',
});

const input = (overrides: Partial<MuscleAnalyticsInput> = {}): MuscleAnalyticsInput => ({
  sessions: [
    { id: 'thu', completedAt: local(2026, 10, 29, 23) },
    { id: 'fri', completedAt: local(2026, 10, 30, 0) },
    { id: 'empty', completedAt: local(2026, 10, 30, 18) },
  ],
  sessionExercises: [
    { id: 'thu-bench', sessionId: 'thu', exerciseDefinitionId: 'bench' },
    { id: 'thu-dips', sessionId: 'thu', exerciseDefinitionId: 'dips' },
    { id: 'fri-bench', sessionId: 'fri', exerciseDefinitionId: 'bench' },
  ],
  exerciseSets: [
    working('b1', 'thu-bench'), working('b2', 'thu-bench'),
    working('d1', 'thu-dips'),
    { ...working('warm', 'fri-bench'), setType: 'warm_up' },
    working('b3', 'fri-bench'),
  ],
  muscleMappings: [
    { exerciseDefinitionId: 'bench', muscleGroupId: 'chest', role: 'primary' },
    { exerciseDefinitionId: 'bench', muscleGroupId: 'triceps', role: 'secondary' },
    // Primary and secondary to one muscle counts once, at primary.
    { exerciseDefinitionId: 'dips', muscleGroupId: 'triceps', role: 'primary' },
    { exerciseDefinitionId: 'dips', muscleGroupId: 'triceps', role: 'secondary' },
    { exerciseDefinitionId: 'bench', muscleGroupId: 'core', role: 'stabilizer' },
  ],
  muscleGroups: [
    { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 1 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 2 },
    { id: 'core', displayName: 'Core', familyName: 'Core', sortOrder: 3 },
  ],
  ...overrides,
});

describe('aggregateMuscleDailySets', () => {
  it('counts primary 1 and secondary ½ per muscle per local day', () => {
    const daily = aggregateMuscleDailySets(input());
    expect(daily.sets.chest).toEqual({ '2026-10-29': 2, '2026-10-30': 1 });
    expect(daily.sets.triceps).toEqual({ '2026-10-29': 2, '2026-10-30': 0.5 });
  });

  it('leaves out warm-ups and stabilizers, and lists every muscle in order', () => {
    const daily = aggregateMuscleDailySets(input());
    expect(daily.sets.core).toBeUndefined();
    expect(daily.muscles.map((muscle) => muscle.id)).toEqual(['chest', 'triceps', 'core']);
  });

  it('names the days that hold a counted session, never an empty one', () => {
    expect(aggregateMuscleDailySets(input()).sessionDays).toEqual(['2026-10-29', '2026-10-30']);
  });
});
