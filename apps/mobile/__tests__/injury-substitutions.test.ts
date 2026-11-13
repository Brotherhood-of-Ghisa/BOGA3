import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import {
  CURATED_SUBSTITUTIONS,
  resolveExerciseSubstitutions,
} from '@/src/injuries/injury-substitutions';

const makeMapping = (id: string, muscleGroupId: string, role: 'primary' | 'secondary' = 'primary') => ({
  id,
  muscleGroupId,
  weight: 1,
  role,
});

const makeMockExercise = (
  id: string,
  name: string,
  mappings: { muscleGroupId: string; role?: 'primary' | 'secondary' }[],
  deletedAt: Date | null = null
): ExerciseCatalogExercise => ({
  id,
  name,
  bodyweightContribution: 0,
  splitByGym: false,
  restTimerSec: null,
  deletedAt,
  mappings: mappings.map((m, idx) => makeMapping(`map-${id}-${idx}`, m.muscleGroupId, m.role ?? 'primary')),
});

const mockCatalog: ExerciseCatalogExercise[] = [
  makeMockExercise('seed_back_squat', 'Barbell Back Squat', [{ muscleGroupId: 'quads' }]),
  makeMockExercise('seed_leg_press', 'Leg Press', [{ muscleGroupId: 'quads' }]),
  makeMockExercise('seed_dumbbell_goblet_squats', 'Dumbbell Goblet Squats', [{ muscleGroupId: 'quads' }]),
  makeMockExercise('seed_machine_hack_squats', 'Machine Hack Squats', [{ muscleGroupId: 'quads' }]),
  makeMockExercise('seed_leg_extensions', 'Leg Extensions', [{ muscleGroupId: 'quads' }]),
  makeMockExercise('seed_bench_press', 'Barbell Bench Press', [{ muscleGroupId: 'chest' }]),
  makeMockExercise('seed_dumbbell_bench_presses', 'Dumbbell Bench Presses', [{ muscleGroupId: 'chest' }]),
  makeMockExercise('seed_machine_bench_presses', 'Machine Bench Presses', [{ muscleGroupId: 'chest' }]),
  makeMockExercise('seed_push-ups', 'Push-Ups', [{ muscleGroupId: 'chest' }]),
  makeMockExercise('seed_deadlift', 'Barbell Deadlift', [{ muscleGroupId: 'hamstrings' }]),
  makeMockExercise('seed_trap_bar_deadlifts', 'Trap Bar Deadlifts', [{ muscleGroupId: 'hamstrings' }]),
  makeMockExercise('seed_overhead_press', 'Barbell Overhead Press', [{ muscleGroupId: 'delts_front' }]),
  makeMockExercise('deleted_exercise', 'Deleted Quad Exercise', [{ muscleGroupId: 'quads' }], new Date(2026, 1, 1)),
];

describe('injury substitutions', () => {
  describe('CURATED_SUBSTITUTIONS patterns', () => {
    it('matches squat patterns', () => {
      const squat = CURATED_SUBSTITUTIONS.find((s) => s.pattern === 'squat');
      expect(squat?.matches('Barbell Back Squat')).toBe(true);
      expect(squat?.matches('Front Squat')).toBe(true);
      expect(squat?.matches('Bench Press')).toBe(false);
    });

    it('matches bench press patterns', () => {
      const bench = CURATED_SUBSTITUTIONS.find((s) => s.pattern === 'bench_press');
      expect(bench?.matches('Barbell Bench Press')).toBe(true);
      expect(bench?.matches('Incline Barbell Bench Press')).toBe(true);
      expect(bench?.matches('Deadlift')).toBe(false);
    });

    it('matches deadlift patterns', () => {
      const dl = CURATED_SUBSTITUTIONS.find((s) => s.pattern === 'deadlift');
      expect(dl?.matches('Barbell Deadlift')).toBe(true);
      expect(dl?.matches('Conventional Deadlift')).toBe(true);
    });

    it('matches overhead press patterns', () => {
      const ohp = CURATED_SUBSTITUTIONS.find((s) => s.pattern === 'overhead_press');
      expect(ohp?.matches('Barbell Overhead Press')).toBe(true);
      expect(ohp?.matches('Military Press')).toBe(true);
    });
  });

  describe('resolveExerciseSubstitutions', () => {
    it('returns curated alternatives and muscle group fallbacks for Barbell Back Squat', () => {
      const result = resolveExerciseSubstitutions(
        {
          id: 'seed_back_squat',
          name: 'Barbell Back Squat',
          mappings: [{ muscleGroupId: 'quads', role: 'primary' }],
        },
        mockCatalog
      );

      // Curated contains Leg Press, Goblet Squat, Hack Squat
      const curatedNames = result.curated.map((c) => c.exercise.name);
      expect(curatedNames).toContain('Leg Press');
      expect(curatedNames).toContain('Dumbbell Goblet Squats');
      expect(curatedNames).toContain('Machine Hack Squats');
      expect(result.curated[0].isCurated).toBe(true);
      expect(result.curated[0].curatedReason).toBeDefined();

      // Alternatives contain other quad exercises not in curated
      const altNames = result.alternatives.map((a) => a.exercise.name);
      expect(altNames).toContain('Leg Extensions');

      // Does not contain itself or deleted exercises
      expect(curatedNames).not.toContain('Barbell Back Squat');
      expect(altNames).not.toContain('Barbell Back Squat');
      expect(altNames).not.toContain('Deleted Quad Exercise');
    });

    it('returns curated alternatives for Barbell Bench Press', () => {
      const result = resolveExerciseSubstitutions(
        {
          id: 'seed_bench_press',
          name: 'Barbell Bench Press',
          mappings: [{ muscleGroupId: 'chest', role: 'primary' }],
        },
        mockCatalog
      );

      const curatedNames = result.curated.map((c) => c.exercise.name);
      expect(curatedNames).toContain('Dumbbell Bench Presses');
      expect(curatedNames).toContain('Machine Bench Presses');
      expect(curatedNames).toContain('Push-Ups');
    });

    it('falls back to primary muscle group alternatives when no curated pattern matches', () => {
      const result = resolveExerciseSubstitutions(
        {
          id: 'custom_quad_blaster',
          name: 'Custom Quad Blaster',
          mappings: [{ muscleGroupId: 'quads', role: 'primary' }],
        },
        mockCatalog
      );

      expect(result.curated).toHaveLength(0);
      const altNames = result.alternatives.map((a) => a.exercise.name);
      expect(altNames).toContain('Barbell Back Squat');
      expect(altNames).toContain('Leg Press');
      expect(altNames).toContain('Leg Extensions');
      expect(altNames).not.toContain('Custom Quad Blaster');
      expect(altNames).not.toContain('Deleted Quad Exercise');
    });
  });
});
