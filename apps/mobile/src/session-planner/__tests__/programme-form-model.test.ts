import {
  emptyProgrammeForm,
  emptyProgrammeChildPlan,
  programmeFormFromDetail,
  programmeFormToDraft,
  programmeFormErrors,
  type ProgrammeFormState,
} from '../programme-form-model';
import type { ProgrammeDetailView } from '../plan-queries';

describe('programme-form-model', () => {
  it('creates an empty form with two default child plans', () => {
    const form = emptyProgrammeForm();
    expect(form.name).toBe('');
    expect(form.description).toBe('');
    expect(form.plans).toHaveLength(2);
    expect(form.plans[0].title).toBe('Session 1');
    expect(form.plans[1].title).toBe('Session 2');
    expect(form.plans[0].blocks).toHaveLength(1);
    expect(form.plans[0].blocks[0].sets).toHaveLength(1);
  });

  it('validates required name and minimum 2 sessions', () => {
    const form = emptyProgrammeForm();
    const errors = programmeFormErrors(form);
    expect(errors.get('name')).toBe('Name the programme.');

    // With 1 session
    const singleSessionForm: ProgrammeFormState = {
      ...form,
      name: 'Hypertrophy Block',
      plans: [emptyProgrammeChildPlan(0)],
    };
    const errorsSingle = programmeFormErrors(singleSessionForm);
    expect(errorsSingle.get('plans')).toBe('A programme needs at least two sessions.');
  });

  it('catches invalid schedule dates on child plans', () => {
    const form = emptyProgrammeForm();
    form.name = 'Valid Programme';
    form.plans[0].scheduleText = 'invalid-date';
    const errors = programmeFormErrors(form);
    expect(errors.get('plans.0.scheduledFor')).toBe('Enter a valid date and time in YYYY-MM-DD HH:mm format.');
  });

  it('catches nested exercise and set validation errors', () => {
    const form = emptyProgrammeForm();
    form.name = 'Valid Programme';
    form.plans[0].blocks[0].name = ''; // Empty exercise name
    form.plans[0].blocks[0].sets[0].targetRepsText = '0'; // Non-positive reps
    const errors = programmeFormErrors(form);
    expect(errors.get('plans.0.exercises.0.name')).toBe('Name the exercise.');
    expect(errors.get('plans.0.exercises.0.sets.0.targetReps')).toBe('Reps must be a whole number from 1 to 999.');
  });

  it('converts valid form to ProgrammeDraft', () => {
    const form = emptyProgrammeForm();
    form.name = 'Upper Lower Split';
    form.description = '4-week cycle';
    form.plans[0].title = 'Upper A';
    form.plans[0].blocks[0].name = 'Bench Press';
    form.plans[0].blocks[0].sets[0].targetRepsText = '5';
    form.plans[0].blocks[0].sets[0].targetWeightText = '100';

    form.plans[1].title = 'Lower A';
    form.plans[1].blocks[0].name = 'Back Squat';
    form.plans[1].blocks[0].sets[0].targetRepsText = '5';
    form.plans[1].blocks[0].sets[0].targetWeightText = '140';

    const result = programmeFormToDraft(form);
    expect(result.draft).not.toBeNull();
    if (result.draft) {
      expect(result.draft.name).toBe('Upper Lower Split');
      expect(result.draft.description).toBe('4-week cycle');
      expect(result.draft.plans).toHaveLength(2);
      expect(result.draft.plans[0].title).toBe('Upper A');
      expect(result.draft.plans[1].title).toBe('Lower A');
    }
  });

  it('prefills from loaded ProgrammeDetailView', () => {
    const detail: ProgrammeDetailView = {
      id: 'prog-1',
      name: '5/3/1 Wave',
      description: 'Wave 1',
      progress: 'planned',
      planCount: 2,
      blockCounts: { pending: 2, attached: 0, completed: 0, skipped: 0 },
      nextBlock: null,
      plans: [
        {
          id: 'plan-1',
          title: 'Day 1: Squat',
          gymId: null,
          scheduledFor: new Date('2026-10-10T10:00:00Z'),
          programmeId: 'prog-1',
          programmeOrderIndex: 0,
          provenance: 'human',
          progress: 'planned',
          blockCounts: { pending: 1, attached: 0, completed: 0, skipped: 0 },
          blocks: [
            {
              id: 'block-1',
              planId: 'plan-1',
              exerciseDefinitionId: 'ex-1',
              name: 'Barbell Squat',
              orderIndex: 0,
              progressStatus: 'pending',
              status: 'pending',
              resolvedAt: null,
              attachedSessionId: null,
              attachedSessionExerciseId: null,
              targets: [
                {
                  id: 'set-1',
                  orderIndex: 0,
                  targetWeightValue: '120',
                  targetReps: 5,
                  targetSetType: null,
                },
              ],
            },
          ],
        },
        {
          id: 'plan-2',
          title: 'Day 2: Bench',
          gymId: null,
          scheduledFor: null,
          programmeId: 'prog-1',
          programmeOrderIndex: 1,
          provenance: 'human',
          progress: 'planned',
          blockCounts: { pending: 1, attached: 0, completed: 0, skipped: 0 },
          blocks: [],
        },
      ],
    };

    const form = programmeFormFromDetail(detail);
    expect(form.name).toBe('5/3/1 Wave');
    expect(form.description).toBe('Wave 1');
    expect(form.plans).toHaveLength(2);
    expect(form.plans[0].title).toBe('Day 1: Squat');
    expect(form.plans[0].sourcePlanId).toBe('plan-1');
    expect(form.plans[0].blocks).toHaveLength(1);
    expect(form.plans[0].blocks[0].name).toBe('Barbell Squat');
    expect(form.plans[0].blocks[0].sets[0].targetWeightText).toBe('120');
    expect(form.plans[0].blocks[0].sets[0].targetRepsText).toBe('5');
    expect(form.plans[1].title).toBe('Day 2: Bench');
    expect(form.plans[1].sourcePlanId).toBe('plan-2');
  });
});
