import type { SessionDraftSetSnapshot } from '@/src/data/session-drafts';
import {
  addSet,
  buildSetRows,
  canCommitLogger,
  commitSet,
  describeCompleteExercisePlan,
  displayedValues,
  findCursorIndex,
  formatWeight,
  planCompleteExercise,
  toggleSetPerformed,
  updateLoggerValues,
} from '@/src/session-recorder/exercise-page-model';

const performedSet = (
  id: string,
  weight: string,
  reps: string,
  setType: SessionDraftSetSnapshot['setType']
) => ({
  id,
  weightValue: weight,
  repsValue: reps,
  setType,
  plannedWeightValue: null,
  plannedRepsValue: null,
  plannedSetType: null,
  performanceStatus: null,
});

const plannedSet = (
  id: string,
  weight: string,
  reps: string,
  setType: SessionDraftSetSnapshot['setType']
) => ({
  id,
  weightValue: '',
  repsValue: '',
  setType: null,
  plannedWeightValue: weight,
  plannedRepsValue: reps,
  plannedSetType: setType,
  performanceStatus: 'planned' as const,
});

// The accepted target's `V5-Quiet` list: two performed, three planned.
const quietSets = (): SessionDraftSetSnapshot[] => [
  performedSet('s1', '60', '10', 'warm_up'),
  performedSet('s2', '80', '8', 'rir_2'),
  plannedSet('s3', '82.5', '6', 'rir_1'),
  plannedSet('s4', '82.5', '6', 'rir_1'),
  plannedSet('s5', '85', '5', 'rir_0'),
];

describe('exercise page model', () => {
  it('puts the cursor on the first set not performed', () => {
    expect(findCursorIndex(quietSets())).toBe(2);
    expect(findCursorIndex(quietSets().slice(0, 2))).toBeNull();
  });

  it('shows 1RM and volume for every row, warm-ups and planned sets included', () => {
    const rows = buildSetRows(quietSets());
    expect(rows.map((row) => row.kind)).toEqual(['performed', 'performed', 'pending', 'pending', 'pending']);
    expect(rows[0]).toMatchObject({
      setType: 'warm_up',
      weight: 60,
      reps: 10,
      volume: 600,
    });
    expect(rows[0]?.oneRepMax).toBeCloseTo(80.8, 1);
    expect(rows[1]?.oneRepMax).toBeCloseTo(102.1, 1);
    expect(rows[2]).toMatchObject({
      isCursor: true,
      setType: 'rir_1',
      weight: 82.5,
      reps: 6,
      volume: 495,
    });
    expect(rows[3]?.isCursor).toBe(false);
  });

  it('marks the best of today per column, only once there are two sets to compare', () => {
    const rows = buildSetRows([
      performedSet('a', '100', '3', 'rir_1'),
      performedSet('b', '90', '8', 'rir_1'),
    ]);
    // The heavier set is the best weight; the other the best 1RM and volume.
    expect(rows[0]).toMatchObject({
      weightEmphasis: 'best',
      oneRepMaxEmphasis: 'none',
      volumeEmphasis: 'none',
    });
    expect(rows[1]).toMatchObject({
      weightEmphasis: 'none',
      oneRepMaxEmphasis: 'best',
      volumeEmphasis: 'best',
    });

    const single = buildSetRows([performedSet('a', '100', '3', 'rir_1')]);
    expect(single[0]).toMatchObject({
      weightEmphasis: 'none',
      oneRepMaxEmphasis: 'none',
      volumeEmphasis: 'none',
    });
  });

  it('marks a value beating the all-time best as a record, and never a planned row', () => {
    const rows = buildSetRows([...quietSets(), performedSet('s6', '90', '6', 'rir_0')], {
      oneRepMax: 102.1,
      weight: 85,
    });
    const last = rows[5];
    // 90 × 6 (540) is not today's top volume: 80 × 8 (640) is.
    expect(last).toMatchObject({
      weightEmphasis: 'record',
      oneRepMaxEmphasis: 'record',
      volumeEmphasis: 'none',
    });
    expect(rows[1]?.volumeEmphasis).toBe('best');
    expect(rows[4]).toMatchObject({
      weightEmphasis: 'none',
      oneRepMaxEmphasis: 'none',
    });
  });

  it('shows entered values over the plan once the lifter starts typing', () => {
    const [set] = updateLoggerValues([plannedSet('p', '82.5', '6', 'rir_1')], 'p', { weightValue: '80' });
    expect(set).toMatchObject({
      weightValue: '80',
      repsValue: '6',
      setType: 'rir_1',
      performanceStatus: 'planned',
    });
    expect(displayedValues(set!)).toEqual({
      weightValue: '80',
      repsValue: '6',
      setType: 'rir_1',
    });
  });

  it('commits only a valid set, and a planned row keeps its plan', () => {
    const sets = quietSets();
    expect(canCommitLogger({ weightValue: '82.5', repsValue: '0' })).toBe(false);
    expect(
      commitSet(sets, 's3', {
        weightValue: '82.5',
        repsValue: '',
        setType: 'rir_1',
      })
    ).toBe(sets);

    const next = commitSet(sets, 's3', {
      weightValue: '82.5',
      repsValue: '6',
      setType: 'rir_0',
    });
    expect(next[2]).toMatchObject({
      weightValue: '82.5',
      repsValue: '6',
      setType: 'rir_0',
      performanceStatus: null,
      plannedWeightValue: '82.5',
      plannedSetType: 'rir_1',
    });
    expect(findCursorIndex(next)).toBe(3);
  });

  it('commits a blank weight with valid reps as 0, like the recorder', () => {
    const next = commitSet([plannedSet('p', '', '10', null)], 'p', {
      weightValue: '',
      repsValue: '10',
      setType: null,
    });
    expect(next[0]).toMatchObject({
      weightValue: '0',
      repsValue: '10',
      performanceStatus: null,
    });
  });

  it('toggles a planned row to performed with its plan, and back to planned', () => {
    const performed = toggleSetPerformed(quietSets(), 's4');
    expect(performed?.[3]).toMatchObject({
      weightValue: '82.5',
      repsValue: '6',
      setType: 'rir_1',
      performanceStatus: null,
    });
    const back = toggleSetPerformed(performed!, 's4');
    expect(back?.[3]?.performanceStatus).toBe('planned');

    const adHoc = toggleSetPerformed(quietSets(), 's1');
    expect(adHoc?.[0]?.performanceStatus).toBe('unperformed');
  });

  it('returns null for a row with nothing valid to perform, so the page opens it', () => {
    expect(toggleSetPerformed([plannedSet('p', '', '', null)], 'p')).toBeNull();
  });

  it('adds a set copying the last row, not performed', () => {
    const next = addSet(quietSets(), 'new');
    expect(next[5]).toEqual({
      id: 'new',
      weightValue: '85',
      repsValue: '5',
      setType: 'rir_0',
      plannedWeightValue: null,
      plannedRepsValue: null,
      plannedSetType: null,
      performanceStatus: 'unperformed',
    });
    expect(addSet([], 'first')[0]).toMatchObject({
      weightValue: '',
      repsValue: '',
      setType: null,
    });
  });

  it('completes by discarding pending planned sets as unperformed, never deleting them', () => {
    const sets = [
      ...quietSets(),
      {
        ...performedSet('extra', '85', '5', 'rir_0'),
        performanceStatus: 'unperformed' as const,
      },
    ];
    const blank = {
      ...performedSet('blank', '', '', null),
      performanceStatus: 'unperformed' as const,
    };
    const plan = planCompleteExercise([...sets, blank]);

    expect(plan).toMatchObject({
      plannedToDiscard: 3,
      unloggedToRemove: 1,
      needsConfirmation: true,
    });
    expect(plan.nextSets.map((set) => [set.id, set.performanceStatus])).toEqual([
      ['s1', null],
      ['s2', null],
      ['s3', 'unperformed'],
      ['s4', 'unperformed'],
      ['s5', 'unperformed'],
    ]);
    expect(plan.nextSets[2]).toMatchObject({
      plannedWeightValue: '82.5',
      plannedRepsValue: '6',
    });
    expect(describeCompleteExercisePlan(plan)).toBe(
      '3 planned sets will be discarded. 1 set you did not log will be removed.'
    );

    // A second Complete has nothing left to ask about.
    expect(planCompleteExercise(plan.nextSets)).toMatchObject({
      needsConfirmation: false,
      plannedToDiscard: 0,
    });
  });

  it('completes without asking when every set is performed', () => {
    const plan = planCompleteExercise(quietSets().slice(0, 2));
    expect(plan.needsConfirmation).toBe(false);
    expect(plan.nextSets).toHaveLength(2);
  });

  it('formats weights with one decimal unless more were entered', () => {
    expect(formatWeight(60)).toBe('60.0');
    expect(formatWeight(82.5)).toBe('82.5');
    expect(formatWeight(2.25)).toBe('2.25');
  });
});
