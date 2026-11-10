import {
  hasOneWorkoutExerciseReference, isWorkoutOperationKey, isWorkoutWeight,
} from '../../../services/boga-mcp/src/workout-input';

describe('MCP workout wire boundary', () => {
  it.each(['0', '80', '80.25', '.5', '1.', ' 40 '])('accepts explicit decimal kg %s', value => {
    expect(isWorkoutWeight(value)).toBe(true);
  });
  it.each(['', ' ', '.', '-1', '1e3', 'Infinity', '80 kg', '1,5', '0'.repeat(101)])('rejects non-wire weight %s', value => {
    expect(isWorkoutWeight(value)).toBe(false);
  });
  it('accepts a bounded retry key and rejects whitespace, header injection and non-ASCII', () => {
    expect(isWorkoutOperationKey('new-set-1')).toBe(true);
    expect(isWorkoutOperationKey('x'.repeat(128))).toBe(true);
    for (const value of ['', ' ', 'x'.repeat(129), 'two keys', 'key\nheader', 'clé']) {
      expect(isWorkoutOperationKey(value)).toBe(false);
    }
  });
  it('requires exactly one persisted exercise or block reference', () => {
    expect(hasOneWorkoutExerciseReference({ exercise_id: 'e' })).toBe(true);
    expect(hasOneWorkoutExerciseReference({ session_exercise_id: 'b' })).toBe(true);
    expect(hasOneWorkoutExerciseReference({})).toBe(false);
    expect(hasOneWorkoutExerciseReference({ exercise_id: 'e', session_exercise_id: 'b' })).toBe(false);
  });
});
