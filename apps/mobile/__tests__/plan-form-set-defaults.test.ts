import { createPlanFormSet, planFormBlockFromEmptySet, planFormBlockFromSuggestion } from '@/src/session-planner/plan-form-model';
import { addSet } from '@/src/session-recorder/exercise-page-model';
import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';
import type { SessionSetTypeValue } from '@/src/data/set-types';

const exercise = { id: 'bench', name: 'Bench', loadInputMode: 'per_side_load' as const };

it('starts empty plan blocks with the recorder default, including filtered choices', () => {
  expect(planFormBlockFromEmptySet(exercise).sets[0].targetSetType).toBe(addSet([])[0].setType);
  const display: EffortChoice[] = ['rir_2'];
  expect(planFormBlockFromEmptySet(exercise, display).sets[0].targetSetType).toBe('rir_2');
  expect(planFormBlockFromSuggestion(exercise, [], display).sets[0].targetSetType).toBe('rir_2');
});

it.each<SessionSetTypeValue>(['warm_up', null, 'rir_4', 'rir_3', 'rir_2', 'rir_12', 'technique', 'cooldown'])(
  'copies values with the recorder effort default for %p', (setType) => {
    const previous = { id: 'source', targetWeightText: '0', targetRepsText: '100', targetSetType: setType };
    const display: EffortChoice[] = ['unspecified', 'rir_4', 'rir_2'];
    const copied = createPlanFormSet(previous, display);
    const recorder = addSet([{ id: 'source', weightValue: '0', repsValue: '100', setType }], 'copy', display)[1];
    expect(copied).toMatchObject({
      targetWeightText: recorder.weightValue,
      targetRepsText: recorder.repsValue,
      targetSetType: recorder.setType,
    });
    expect(copied.id).not.toBe(previous.id);
    expect(previous.targetSetType).toBe(setType);
  },
);

it('preserves historical efforts on Repeat last, normalizing an unknown label', () => {
  const block = planFormBlockFromSuggestion(exercise, [
    { weightValue: '', repsValue: '8', setType: 'rir_12' },
    { weightValue: '0', repsValue: '10', setType: 'work' },
  ], ['rir_2']);
  expect(block.sets.map(({ targetWeightText, targetSetType }) => [targetWeightText, targetSetType])).toEqual([
    ['', 'rir_12'], ['0', null],
  ]);
  expect(createPlanFormSet(block.sets[0], ['rir_2']).targetSetType).toBe('rir_2');
});
