import { addPlanFormSets, planFormBlockFromEmptySet, planFormBlockFromSuggestion, planSetCountError } from '@/src/session-planner/plan-form-model';
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
  'appends exact values and effort for %p', (targetSetType) => {
    const source = { id: 'source', targetWeightText: '0', targetRepsText: '100', targetSetType };
    const result = addPlanFormSets([source], '1');
    expect(result[0]).toBe(source);
    expect(result[1]).toEqual({ ...source, id: result[1].id });
    expect(result[1].id).not.toBe(source.id);
    expect(result[1]).not.toBe(source);
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
});

describe('Add set(s)', () => {
  const targets = ['warm_up', 'rir_12', 'cooldown'].map((targetSetType, index) => ({
    id: `source-${index}`,
    targetWeightText: ` ${index}.00 `,
    targetRepsText: '005',
    targetSetType: targetSetType as SessionSetTypeValue,
  }));

  it.each(['1', '9'])('appends %s exact last-target copies, preserving every existing row', (count) => {
    const result = addPlanFormSets(targets, count);
    expect(result).toHaveLength(targets.length + Number(count));
    expect(new Set(result.map((set) => set.id)).size).toBe(result.length);
    expect(result.slice(0, targets.length)).toEqual(targets);
    for (const copy of result.slice(targets.length)) {
      expect(copy).toEqual({ ...targets.at(-1), id: copy.id });
      expect(copy).not.toBe(targets.at(-1));
    }
  });

  it.each(['', '0', '-1', '1.5', '1e1', 'abc', '9007199254740992', '30'])(
    'rejects invalid or over-capacity count %p without changing targets', (count) => {
      expect(planSetCountError(1, count)).not.toBeNull();
      expect(addPlanFormSets([targets[0]], count)).toEqual([targets[0]]);
    },
  );

  it('fills the exact block boundary and refuses a full or empty block', () => {
    const result = addPlanFormSets([targets[0]], ' 29 ');
    expect(result).toHaveLength(30);
    expect(new Set(result.map((set) => set.id)).size).toBe(30);
    expect(planSetCountError(29, '1')).toBeNull();
    expect(planSetCountError(29, '2')).toBe('This block can fit only 1 more set.');
    expect(planSetCountError(30, '1')).toBe('This block already has 30 sets.');
    expect(addPlanFormSets(result, '1')).toBe(result);
    const empty: typeof targets = [];
    expect(addPlanFormSets(empty, '1')).toBe(empty);
  });
});
