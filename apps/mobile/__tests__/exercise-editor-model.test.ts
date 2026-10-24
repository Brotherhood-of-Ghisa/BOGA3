import {
  buildDuplicateExercisePrefill,
  editorOpenState,
  validateEditorInput,
  type EditorMapping,
} from '@/src/exercise-catalog/editor-model';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { buildMuscleSetup } from '@/src/exercise-catalog/muscle-setup';

import { broadMuscleRows, detailedMuscleRows } from './helpers/muscle-setup';

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

  describe("in the user's muscles ([[muscle.no-breakdown]])", () => {
    const broad = buildMuscleSetup(broadMuscleRows()).assignment;
    const detailed = buildMuscleSetup(detailedMuscleRows()).assignment;
    const exerciseMapped = (mappings: EditorMapping[]): ExerciseCatalogExercise => ({
      id: 'exercise',
      name: 'Exercise',
      bodyweightContribution: 0,
      splitByGym: false,
      deletedAt: null,
      mappings: mappings.map((mapping) => ({ id: `map-${mapping.muscleGroupId}`, ...mapping })),
    });
    const primary = (muscleGroupId: string): EditorMapping => ({ muscleGroupId, weight: 1, role: 'primary' });
    const secondary = (muscleGroupId: string): EditorMapping => ({ muscleGroupId, weight: 0.5, role: 'secondary' });
    /** What Save writes under Broad after the user leaves the form with these muscles. */
    const saveUnderBroad = (opened: ExerciseCatalogExercise, primaryMuscle: string | null, secondaryMuscles: string[]) => {
      const { validation, mappings } = validateEditorInput({
        name: opened.name,
        loadInputMode: 'total_load',
        primaryMuscleGroupId: primaryMuscle,
        secondaryMuscleRows: secondaryMuscles.map((muscleGroupId) => ({ rowId: muscleGroupId, muscleGroupId })),
        openedMappings: opened.mappings,
        assignment: broad,
      });
      return { validation, mappings: mappings?.slice().sort((left, right) => left.muscleGroupId.localeCompare(right.muscleGroupId)) };
    };

    it('shows an exercise mapped Quads primary and Adductors secondary as Quads once, primary', () => {
      const squat = exerciseMapped([primary('quads'), secondary('adductors')]);
      expect(editorOpenState(squat, null, broad)).toMatchObject({ primaryMuscleGroupId: 'quads', secondaryMuscleRows: [] });
      expect(editorOpenState(squat, null, detailed)).toMatchObject({
        primaryMuscleGroupId: 'quads',
        secondaryMuscleRows: [{ muscleGroupId: 'adductors' }],
      });
    });

    it('adds Back as one mapping to its anchor, Lats', () => {
      const row = exerciseMapped([primary('biceps')]);
      expect(saveUnderBroad(row, 'biceps', ['back_lats']).mappings).toEqual([secondary('back_lats'), primary('biceps')]);
    });

    it('keeps an unchanged muscle\'s mappings as they were, entry by entry', () => {
      const deadlift = exerciseMapped([primary('glutes_max'), primary('hamstrings'), secondary('hip_abductors'), secondary('quads')]);
      const opened = editorOpenState(deadlift, null, broad);
      expect(opened).toMatchObject({ primaryMuscleGroupId: 'glutes_max', secondaryMuscleRows: [{ muscleGroupId: 'quads' }] });
      expect(saveUnderBroad(deadlift, 'glutes_max', ['quads']).mappings).toEqual([
        primary('glutes_max'), primary('hamstrings'), secondary('hip_abductors'), secondary('quads'),
      ]);
    });

    it('rewrites every Glute Max, Hamstrings and Hip Abductors mapping when Glutes & Hams turns secondary, and removes them all', () => {
      const deadlift = exerciseMapped([primary('glutes_max'), primary('hamstrings'), secondary('hip_abductors'), secondary('quads')]);
      expect(saveUnderBroad(deadlift, 'quads', ['glutes_max']).mappings).toEqual([
        secondary('glutes_max'), secondary('hamstrings'), secondary('hip_abductors'), primary('quads'),
      ]);
      expect(saveUnderBroad(deadlift, 'quads', []).mappings).toEqual([primary('quads')]);
    });

    it('keeps a Forearms mapping it hides under Broad, and needs no primary when the hidden one is primary', () => {
      const curl = exerciseMapped([primary('biceps'), secondary('forearms_grip')]);
      expect(editorOpenState(curl, null, broad)).toMatchObject({ primaryMuscleGroupId: 'biceps', secondaryMuscleRows: [] });
      expect(saveUnderBroad(curl, 'biceps', []).mappings).toEqual([primary('biceps'), secondary('forearms_grip')]);
      expect(saveUnderBroad(curl, 'biceps', ['back_lats']).mappings).toEqual([
        secondary('back_lats'), primary('biceps'), secondary('forearms_grip'),
      ]);

      const wristCurl = exerciseMapped([primary('forearms_grip')]);
      expect(editorOpenState(wristCurl, null, broad).primaryMuscleGroupId).toBeNull();
      expect(saveUnderBroad(wristCurl, null, []).mappings).toEqual([primary('forearms_grip')]);
      expect(saveUnderBroad(curl, null, []).validation.primaryMuscleError).toBe('Select a primary muscle before saving.');
    });
  });
});
