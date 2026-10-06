import {
  PLAN_LIMITS,
  parseTargetReps,
  parseTargetWeight,
  validatePlanDraft,
  validatePlanExerciseDraft,
  validateProgrammeDraft,
} from '@/src/session-planner/plan-validation';
import { planStartCardId, planStartSessionId, planStartSetId } from '@/src/session-planner/deterministic-ids';
import type { PlanDraft, PlanExerciseDraft, ProgrammeDraft } from '@/src/session-planner/types';

// Pure session-planning-contract §7.1 validation plus the deterministic-ID recipes. No
// database: the editor-facing rules and the ID composition are both total
// functions over their inputs.

const set = (overrides: Partial<PlanExerciseDraft['sets'][number]> = {}) => ({
  targetWeightText: '60',
  targetRepsText: '8',
  targetSetType: null,
  ...overrides,
});

const exercise = (overrides: Partial<PlanExerciseDraft> = {}): PlanExerciseDraft => ({
  exerciseDefinitionId: 'def-1',
  name: 'Back Squat',
  machineName: '',
  sets: [set()],
  ...overrides,
});

const plan = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  title: 'Heavy Day',
  gymId: null,
  scheduledFor: null,
  exercises: [exercise()],
  ...overrides,
});

const programme = (overrides: Partial<ProgrammeDraft> = {}): ProgrammeDraft => ({
  name: 'Squat Wave',
  description: '',
  plans: [plan({ title: 'Week 1' }), plan({ title: 'Week 2' })],
  ...overrides,
});

describe('parseTargetReps', () => {
  it.each([
    ['8', 8],
    [' 12 ', 12],
    ['1', 1],
    ['999', 999],
  ])('accepts %s', (text, expected) => {
    expect(parseTargetReps(text)).toBe(expected);
  });

  it.each(['0', '1000', '-3', '8.5', 'eight', '', '1e2', ' 7abc '])('rejects %s', (text) => {
    expect(parseTargetReps(text)).toBeNull();
  });
});

describe('parseTargetWeight', () => {
  it('normalizes blank text to null ("choose during the workout")', () => {
    expect(parseTargetWeight('')).toEqual({ ok: true, value: null });
    expect(parseTargetWeight('   ')).toEqual({ ok: true, value: null });
  });

  it('canonicalizes the text', () => {
    expect(parseTargetWeight('007.50')).toEqual({ ok: true, value: '7.5' });
    expect(parseTargetWeight('60')).toEqual({ ok: true, value: '60' });
    expect(parseTargetWeight('0')).toEqual({ ok: true, value: '0' });
    expect(parseTargetWeight('9999.99')).toEqual({ ok: true, value: '9999.99' });
  });

  it.each(['-1', '1.234', '10000', '60kg', '1e2', '1,5', 'abc'])('rejects %s', (text) => {
    expect(parseTargetWeight(text)).toEqual({ ok: false });
  });
});

describe('validatePlanDraft', () => {
  it('accepts a valid one-off plan and normalizes its fields', () => {
    const result = validatePlanDraft(
      plan({
        title: '  Heavy Day  ',
        exercises: [
          exercise({
            name: '  Back Squat  ',
            machineName: '  Rack 1  ',
            sets: [set({ targetWeightText: '080.00', targetRepsText: '08' }), set({ targetWeightText: '' })],
          }),
        ],
        scheduledFor: new Date(2026, 9, 8, 7, 30),
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        plan: {
          title: 'Heavy Day',
          gymId: null,
          scheduledFor: new Date(2026, 9, 8, 7, 30),
          exercises: [
            {
              exerciseDefinitionId: 'def-1',
              name: 'Back Squat',
              machineName: 'Rack 1',
              sets: [
                { targetWeightValue: '80', targetReps: 8, targetSetType: null },
                { targetWeightValue: null, targetReps: 8, targetSetType: null },
              ],
            },
          ],
        },
      },
    });
  });

  it('rejects a zero-exercise plan', () => {
    const result = validatePlanDraft(plan({ exercises: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { path: 'exercises', code: 'too_few', message: 'Add at least one exercise.' },
      ]);
    }
  });

  it('rejects more exercises than the contract limit', () => {
    const result = validatePlanDraft({
      ...plan(),
      exercises: Array.from({ length: PLAN_LIMITS.planExercises.max + 1 }, (_, i) => exercise({ name: `X${i}` })),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        path: 'exercises',
        code: 'too_many',
        message: `Use at most ${PLAN_LIMITS.planExercises.max} exercises.`,
      });
    }
  });

  it('rejects a zero-set exercise at its exact field', () => {
    const zeroSet = validatePlanDraft(plan({ exercises: [exercise({ sets: [] })] }));
    expect(zeroSet.ok).toBe(false);
    if (!zeroSet.ok) {
      expect(zeroSet.errors).toEqual([
        { path: 'exercises.0.sets', code: 'too_few', message: 'Add at least one target set.' },
      ]);
    }
  });

  it('addresses invalid reps and weights at their exact fields', () => {
    const result = validatePlanDraft(
      plan({
        exercises: [
          exercise({
            sets: [set({ targetRepsText: '0', targetWeightText: '-5' }), set({ targetRepsText: 'abc' })],
          }),
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { path: 'exercises.0.sets.0.targetReps', code: 'invalid_reps', message: expect.any(String) },
        { path: 'exercises.0.sets.0.targetWeight', code: 'invalid_weight', message: expect.any(String) },
        { path: 'exercises.0.sets.1.targetReps', code: 'invalid_reps', message: expect.any(String) },
      ]);
    }
  });

  it('rejects unknown set types', () => {
    const result = validatePlanDraft(
      plan({ exercises: [exercise({ sets: [set({ targetSetType: 'work' as never })] })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { path: 'exercises.0.sets.0.targetSetType', code: 'unknown_set_type', message: expect.any(String) },
      ]);
    }
  });

  it('rejects overlong titles, exercise names and machine names at their fields', () => {
    const long = 'x'.repeat(PLAN_LIMITS.name.max + 1);
    const result = validatePlanDraft(
      plan({
        title: long,
        exercises: [exercise({ name: long, machineName: long })],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path).sort()).toEqual([
        'exercises.0.machineName',
        'exercises.0.name',
        'title',
      ]);
    }
  });

  it('rejects an invalid schedule', () => {
    const result = validatePlanDraft(plan({ scheduledFor: new Date(Number.NaN) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { path: 'scheduledFor', code: 'invalid_schedule', message: 'Pick a valid date and time.' },
      ]);
    }
  });

  it('addresses a single block under an explicit path prefix', () => {
    const result = validatePlanExerciseDraft(exercise({ sets: [set({ targetRepsText: '' })] }), 'exercises.2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual(['exercises.2.sets.0.targetReps']);
    }
  });
});

describe('validateProgrammeDraft', () => {
  it('accepts a two-plan programme and keeps child order', () => {
    const result = validateProgrammeDraft(programme());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.programme.plans.map((p) => p.title)).toEqual(['Week 1', 'Week 2']);
      expect(result.value.programme.description).toBeNull();
    }
  });

  it('rejects a one-plan programme', () => {
    const result = validateProgrammeDraft(programme({ plans: [plan()] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        path: 'plans',
        code: 'too_few',
        message: 'A programme needs at least two sessions.',
      });
    }
  });

  it('rejects an overlong description and an unnamed programme', () => {
    const result = validateProgrammeDraft(
      programme({
        name: '',
        description: 'x'.repeat(PLAN_LIMITS.description.max + 1),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path).sort()).toEqual(['description', 'name']);
      expect(result.errors.map((e) => e.code).sort()).toEqual(['required', 'too_long']);
    }
  });

  it('propagates child plan errors with their index path', () => {
    const result = validateProgrammeDraft(
      programme({ plans: [plan({ title: 'Week 1' }), plan({ title: '' })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual(['plans.1.title']);
    }
  });
});

describe('deterministic materialization IDs', () => {
  it('composes owner and source id with the :start recipe', () => {
    expect(planStartSessionId('user-1', 'plan-1')).toBe('user-1:plan-1:start');
    expect(planStartCardId('user-1', 'plan-exercise-1')).toBe('user-1:plan-exercise-1:start');
    expect(planStartSetId('user-1', 'plan-set-1')).toBe('user-1:plan-set-1:start');
  });

  it('falls back to the local owner for signed-out devices and trims inputs', () => {
    expect(planStartSessionId(null, ' plan-1 ')).toBe('local:plan-1:start');
    expect(planStartCardId(null, ' pe ')).toBe('local:pe:start');
    expect(planStartSetId(null, ' ps ')).toBe('local:ps:start');
  });

  it('is stable across repeated calls (retry convergence)', () => {
    expect(planStartSessionId('user-1', 'plan-1')).toBe(planStartSessionId('user-1', 'plan-1'));
  });
});
