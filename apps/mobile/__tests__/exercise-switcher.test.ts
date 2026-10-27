import { buildExerciseSwitcherRows } from '@/src/session-recorder/exercise-switcher';
import type { ExercisePageSet } from '@/src/session-recorder/exercise-page-model';

const set = (id: string, overrides: Partial<ExercisePageSet> = {}): ExercisePageSet => ({
  id,
  weightValue: '80',
  repsValue: '8',
  setType: null,
  performanceStatus: null,
  ...overrides,
});
const planned = (id: string) => set(id, { performanceStatus: 'planned' });

const squat = { id: 'squat', name: 'Squat', sets: [set('s1'), set('s2')] };
const bench = { id: 'bench', name: 'Bench press', sets: [set('b1'), planned('b2'), planned('b3')] };
const row = { id: 'row', name: 'Barbell row', sets: [] };

describe('buildExerciseSwitcherRows', () => {
  it('lists every exercise in session order with its done / total sets and marks the open one', () => {
    expect(buildExerciseSwitcherRows([squat, bench, row], bench)).toEqual([
      { id: 'squat', position: 1, name: 'Squat', doneCount: 2, totalCount: 2, current: false },
      { id: 'bench', position: 2, name: 'Bench press', doneCount: 1, totalCount: 3, current: true },
      { id: 'row', position: 3, name: 'Barbell row', doneCount: 0, totalCount: 0, current: false },
    ]);
  });

  it('reads the open exercise from the live draft, not the loaded snapshot', () => {
    const live = { id: 'bench', name: 'Incline bench press', sets: [set('b1'), set('b2'), planned('b3')] };

    expect(buildExerciseSwitcherRows([squat, bench], live)[1]).toEqual({
      id: 'bench',
      position: 2,
      name: 'Incline bench press',
      doneCount: 2,
      totalCount: 3,
      current: true,
    });
  });

  it('counts only confirmed performed sets as done, as the session view card does', () => {
    const unfinished = { id: 'x', name: 'X', sets: [set('x1', { repsValue: '' }), planned('x2'), set('x3')] };

    expect(buildExerciseSwitcherRows([unfinished], squat)[0]).toMatchObject({ doneCount: 1, totalCount: 3, current: false });
  });
});
