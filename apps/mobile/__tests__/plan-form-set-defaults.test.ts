import { createPlanFormSet, duplicatePlanFormSet, planFormBlockFromEmptySet, planFormBlockFromSuggestion, planSetDuplicationError } from '@/src/session-planner/plan-form-model';
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

describe('explicit target duplication', () => {
  const targets = ['warm_up', 'rir_12', 'cooldown'].map((targetSetType, index) => ({
    id: `source-${index}`,
    targetWeightText: ` ${index}.00 `,
    targetRepsText: '005',
    targetSetType: targetSetType as SessionSetTypeValue,
  }));

  it.each([0, 1, 2])('inserts exact copies after source %i, preserving every existing row', (index) => {
    const result = duplicatePlanFormSet(targets, targets[index].id, '9');
    expect(result).toHaveLength(12);
    expect(new Set(result.map((set) => set.id)).size).toBe(12);
    expect(result.slice(0, index + 1)).toEqual(targets.slice(0, index + 1));
    expect(result.slice(index + 10)).toEqual(targets.slice(index + 1));
    for (const copy of result.slice(index + 1, index + 10)) {
      expect(copy).toEqual({ ...targets[index], id: copy.id });
      expect(copy).not.toBe(targets[index]);
    }
    expect(result[index]).toBe(targets[index]);
  });

  it.each(['', '0', '-1', '1.5', '1e1', 'abc', '9007199254740992', '30'])(
    'rejects invalid or over-capacity count %p without changing targets', (count) => {
      expect(planSetDuplicationError(1, count)).not.toBeNull();
      expect(duplicatePlanFormSet([targets[0]], targets[0].id, count)).toEqual([targets[0]]);
    },
  );

  it('fills the exact block boundary and refuses a full block or missing source', () => {
    const result = duplicatePlanFormSet([targets[0]], targets[0].id, ' 29 ');
    expect(result).toHaveLength(30);
    expect(new Set(result.map((set) => set.id)).size).toBe(30);
    expect(planSetDuplicationError(29, '1')).toBeNull();
    expect(planSetDuplicationError(29, '2')).toBe('This block can fit only 1 more set.');
    expect(planSetDuplicationError(30, '1')).toBe('This block already has 30 sets.');
    expect(duplicatePlanFormSet(result, targets[0].id, '1')).toBe(result);
    expect(duplicatePlanFormSet(targets, 'missing', '1')).toBe(targets);
  });
});
