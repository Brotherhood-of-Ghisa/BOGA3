import type { InjuryView } from '@/src/data/injuries';
import {
  calculateDaysSinceOnset,
  detectExerciseSideAffinity,
  isAnatomicalSideConflict,
  matchInjuriesToExercise,
  resolveExerciseWarning,
  type ExerciseAnatomyTarget,
} from '@/src/injuries/injury-warning-engine';

const makeInjury = (overrides: Partial<InjuryView> = {}): InjuryView => ({
  id: 'inj-1',
  muscleGroupId: 'quads',
  muscleGroupName: 'Quadriceps',
  side: null,
  status: 'acute',
  painScore: 7,
  label: 'Knee strain',
  notes: null,
  contraindications: 'Avoid heavy loads',
  startedAt: new Date(2026, 10, 10),
  resolvedAt: null,
  createdAt: new Date(2026, 10, 10),
  updatedAt: new Date(2026, 10, 10),
  ...overrides,
});

describe('injury warning engine', () => {
  describe('calculateDaysSinceOnset', () => {
    it('returns Started today for same day', () => {
      const now = new Date(2026, 10, 13, 14, 0);
      const started = new Date(2026, 10, 13, 8, 0);
      expect(calculateDaysSinceOnset(started, now)).toEqual({
        days: 0,
        text: 'Started today',
      });
    });

    it('returns 1 day ago for yesterday', () => {
      const now = new Date(2026, 10, 13, 10, 0);
      const started = new Date(2026, 10, 12, 18, 0);
      expect(calculateDaysSinceOnset(started, now)).toEqual({
        days: 1,
        text: '1 day ago',
      });
    });

    it('returns n days ago for under 14 days', () => {
      const now = new Date(2026, 10, 13);
      const started = new Date(2026, 10, 8);
      expect(calculateDaysSinceOnset(started, now)).toEqual({
        days: 5,
        text: '5 days ago',
      });
    });

    it('returns weeks ago for 14+ days', () => {
      const now = new Date(2026, 10, 30);
      const started = new Date(2026, 10, 9);
      expect(calculateDaysSinceOnset(started, now)).toEqual({
        days: 21,
        text: '3 weeks ago',
      });
    });
  });

  describe('side detection and conflict checking', () => {
    it('detects bilateral vs explicit unilateral sides', () => {
      expect(detectExerciseSideAffinity('Barbell Back Squat')).toBe('bilateral');
      expect(detectExerciseSideAffinity('Left Dumbbell Row')).toBe('left');
      expect(detectExerciseSideAffinity('Single-Arm Row (Right)')).toBe('right');
      expect(detectExerciseSideAffinity('Dumbbell One-Arm Rows')).toBe('unilateral_any');
      expect(detectExerciseSideAffinity('Bulgarian Split Squats')).toBe('unilateral_any');
    });

    it('checks anatomical side conflicts correctly', () => {
      // Left injury
      expect(isAnatomicalSideConflict('Barbell Back Squat', 'left')).toBe(true);
      expect(isAnatomicalSideConflict('Single-Arm Row (Left)', 'left')).toBe(true);
      expect(isAnatomicalSideConflict('Single-Arm Row (Right)', 'left')).toBe(false);
      expect(isAnatomicalSideConflict('Dumbbell One-Arm Rows', 'left')).toBe(true);

      // Right injury
      expect(isAnatomicalSideConflict('Barbell Back Squat', 'right')).toBe(true);
      expect(isAnatomicalSideConflict('Single-Arm Row (Left)', 'right')).toBe(false);
      expect(isAnatomicalSideConflict('Single-Arm Row (Right)', 'right')).toBe(true);
      expect(isAnatomicalSideConflict('Dumbbell One-Arm Rows', 'right')).toBe(true);

      // Bilateral and null injury side
      expect(isAnatomicalSideConflict('Single-Arm Row (Right)', 'bilateral')).toBe(true);
      expect(isAnatomicalSideConflict('Single-Arm Row (Right)', null)).toBe(true);
    });
  });

  describe('matching injuries to exercise', () => {
    const squat: ExerciseAnatomyTarget = {
      exerciseDefinitionId: 'seed_back_squat',
      name: 'Barbell Back Squat',
      mappings: [
        { muscleGroupId: 'quads', role: 'primary' },
        { muscleGroupId: 'glutes_max', role: 'secondary' },
        { muscleGroupId: 'abs_rectus', role: 'stabilizer' },
      ],
    };

    it('matches primary muscle mapping', () => {
      const injury = makeInjury({ muscleGroupId: 'quads', status: 'acute' });
      const result = matchInjuriesToExercise(squat, [injury]);
      expect(result.hasWarning).toBe(true);
      expect(result.activeWarning?.severity).toBe('acute');
      expect(result.activeWarning?.matchingMuscles).toContain('quads');
    });

    it('matches secondary muscle mapping', () => {
      const injury = makeInjury({ muscleGroupId: 'glutes_max', status: 'managing' });
      const result = matchInjuriesToExercise(squat, [injury]);
      expect(result.hasWarning).toBe(true);
      expect(result.activeWarning?.severity).toBe('managing');
      expect(result.activeWarning?.matchingMuscles).toContain('glutes_max');
    });

    it('does NOT match stabilizer muscle mapping alone', () => {
      const injury = makeInjury({ muscleGroupId: 'abs_rectus', status: 'acute' });
      const result = matchInjuriesToExercise(squat, [injury]);
      expect(result.hasWarning).toBe(false);
      expect(result.activeWarning).toBeNull();
    });

    it('does NOT match unrelated muscle group', () => {
      const injury = makeInjury({ muscleGroupId: 'biceps', status: 'acute' });
      const result = matchInjuriesToExercise(squat, [injury]);
      expect(result.hasWarning).toBe(false);
      expect(result.activeWarning).toBeNull();
    });

    it('ignores resolved injuries', () => {
      const injury = makeInjury({ muscleGroupId: 'quads', status: 'resolved' });
      const result = matchInjuriesToExercise(squat, [injury]);
      expect(result.hasWarning).toBe(false);
    });

    it('resolves unmapped regional pain via anatomy aliases', () => {
      // injury with null muscleGroupId but label "patellar tendon flare" resolves to "quads"
      const aliasInjury = makeInjury({
        muscleGroupId: null,
        label: 'Patellar tendon flare',
        status: 'acute',
      });
      const result = matchInjuriesToExercise(squat, [aliasInjury]);
      expect(result.hasWarning).toBe(true);
      expect(result.activeWarning?.matchingMuscles).toContain('quads');

      // Unmapped injury without anatomical keywords triggers no false warning
      const obscureInjury = makeInjury({
        muscleGroupId: null,
        label: 'Weird tingling feeling',
        status: 'acute',
      });
      const result2 = matchInjuriesToExercise(squat, [obscureInjury]);
      expect(result2.hasWarning).toBe(false);
    });

    it('prioritizes acute over managing and monitoring', () => {
      const monitoringGlute = makeInjury({
        id: 'inj-glute',
        muscleGroupId: 'glutes_max',
        status: 'monitoring',
        painScore: 2,
      });
      const acuteQuad = makeInjury({
        id: 'inj-quad',
        muscleGroupId: 'quads',
        status: 'acute',
        painScore: 6,
      });

      const result = resolveExerciseWarning(squat, [monitoringGlute, acuteQuad]);
      expect(result.hasWarning).toBe(true);
      expect(result.activeWarning?.severity).toBe('acute');
      expect(result.activeWarning?.injury.id).toBe('inj-quad');
      expect(result.allMatchingWarnings).toHaveLength(2);
    });

    it('respects session dismissal on active warning', () => {
      const acuteQuad = makeInjury({
        id: 'inj-quad',
        muscleGroupId: 'quads',
        status: 'acute',
      });
      const managingGlute = makeInjury({
        id: 'inj-glute',
        muscleGroupId: 'glutes_max',
        status: 'managing',
      });

      // Dismiss the acuteQuad injury
      const result = matchInjuriesToExercise(squat, [acuteQuad, managingGlute], {
        dismissedInjuryIds: new Set(['inj-quad']),
      });

      expect(result.hasWarning).toBe(true);
      // Next non-dismissed warning becomes active
      expect(result.activeWarning?.injury.id).toBe('inj-glute');
      expect(result.activeWarning?.severity).toBe('managing');
      expect(result.allMatchingWarnings.find((w) => w.injury.id === 'inj-quad')?.isDismissed).toBe(true);
    });
  });
});
