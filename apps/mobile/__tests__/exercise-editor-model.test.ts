import {
  buildDuplicateExercisePrefill,
  editorOpenState,
  validateEditorInput,
} from '@/src/exercise-catalog/editor-model';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';

describe('exercise-editor-model', () => {
  describe('buildDuplicateExercisePrefill', () => {
    it('creates prefill data with (Copy) suffix, preserving load mode, bodyweight contribution, and mappings', () => {
      const source: ExerciseCatalogExercise = {
        id: 'bench-1',
        name: 'Barbell Bench Press',
        loadInputMode: 'total_load',
        bodyweightContribution: 0.15,
        splitByGym: false,
        deletedAt: null,
        mappings: [
          { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      };

      const prefill = buildDuplicateExercisePrefill(source);

      expect(prefill).toEqual({
        name: 'Barbell Bench Press (Copy)',
        loadInputMode: 'total_load',
        bodyweightContribution: 0.15,
        splitByGym: false,
        mappings: [
          { muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      });
    });

    it('defaults loadInputMode to total_load when omitted on source exercise', () => {
      const source: ExerciseCatalogExercise = {
        id: 'squat-1',
        name: 'Bodyweight Squat',
        bodyweightContribution: 1,
        splitByGym: false,
        deletedAt: null,
        mappings: [{ id: 'm3', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
      };

      const prefill = buildDuplicateExercisePrefill(source);

      expect(prefill.loadInputMode).toBe('total_load');
      expect(prefill.name).toBe('Bodyweight Squat (Copy)');
      expect(prefill.bodyweightContribution).toBe(1);
    });

    it('preserves per_side_load input mode', () => {
      const source: ExerciseCatalogExercise = {
        id: 'curl-1',
        name: 'Dumbbell Curl',
        loadInputMode: 'per_side_load',
        bodyweightContribution: 0,
        splitByGym: false,
        deletedAt: null,
        mappings: [{ id: 'm4', muscleGroupId: 'biceps', weight: 1, role: 'primary' }],
      };

      const prefill = buildDuplicateExercisePrefill(source);

      expect(prefill.loadInputMode).toBe('per_side_load');
    });

    it('populates editorOpenState correctly when fed the prefill', () => {
      const source: ExerciseCatalogExercise = {
        id: 'press-1',
        name: 'Overhead Press',
        loadInputMode: 'total_load',
        bodyweightContribution: 0.2,
        splitByGym: false,
        deletedAt: null,
        mappings: [
          { id: 'm5', muscleGroupId: 'shoulders', weight: 1, role: 'primary' },
          { id: 'm6', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      };

      const prefill = buildDuplicateExercisePrefill(source);
      const state = editorOpenState(null, prefill);

      expect(state.name).toBe('Overhead Press (Copy)');
      expect(state.loadInputMode).toBe('total_load');
      expect(state.primaryMuscleGroupId).toBe('shoulders');
      expect(state.secondaryMuscleRows).toHaveLength(1);
      expect(state.secondaryMuscleRows[0].muscleGroupId).toBe('triceps');
      expect(state.contributionPercentage).toBe('20');
      expect(state.splitByGym).toBe(false);
    });
  });

  describe('Track each gym separately', () => {
    const split: ExerciseCatalogExercise = {
      id: 'bench-1',
      name: 'Bench Press',
      bodyweightContribution: 0,
      splitByGym: true,
      deletedAt: null,
      mappings: [{ id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    };

    it('opens with the edited exercise\'s setting, and a duplicate keeps it', () => {
      expect(editorOpenState(split, null).splitByGym).toBe(true);
      expect(editorOpenState(null, buildDuplicateExercisePrefill(split)).splitByGym).toBe(true);
    });

    it('opens off for a new exercise and a prefill that does not set it (Add as new)', () => {
      expect(editorOpenState(null, null).splitByGym).toBe(false);
      expect(editorOpenState(null, { name: 'Bench', loadInputMode: 'total_load', mappings: [] }).splitByGym).toBe(false);
    });
  });
});
