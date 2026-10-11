import { formatWeight } from '@/src/exercise-calculations/format';
import type { SessionDraftSetSnapshot } from '@/src/data/session-drafts';
import { ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import {
  addSet,
  buildSetRows,
  sessionRecordBlocks,
  canCommitLogger,
  canConfirmSet,
  canDropSet,
  commitSet,
  describeCompleteExercisePlan,
  dropSet,
  displayedValues,
  findCursorIndex,
  isPerformed,
  planCompleteExercise,
  recordBandFor,
  toggleSetPerformed,
  updateLoggerValues,
  type ExerciseRecordBaseline,
  type SetRowSession,
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

// The exercise page's default list: two performed, three planned.
const quietSets = (): SessionDraftSetSnapshot[] => [
  performedSet('s1', '60', '10', 'warm_up'),
  performedSet('s2', '80', '8', 'rir_2'),
  plannedSet('s3', '82.5', '6', 'rir_1'),
  plannedSet('s4', '82.5', '6', 'rir_1'),
  plannedSet('s5', '85', '5', 'rir_0'),
];

const rowsFor = (
  sets: SessionDraftSetSnapshot[],
  baseline: ExerciseRecordBaseline | null = null,
  session: SetRowSession | null = null,
) => buildSetRows(sets, baseline, ordinaryLoadContext(), session);

const bandFor = (
  sets: SessionDraftSetSnapshot[],
  baseline: ExerciseRecordBaseline | null = null,
  session: SetRowSession | null = null,
) => recordBandFor(sets, baseline, ordinaryLoadContext(), session);

describe('exercise page model', () => {
  it('puts the cursor on the first set not performed', () => {
    expect(findCursorIndex(quietSets())).toBe(2);
    expect(findCursorIndex(quietSets().slice(0, 2))).toBeNull();
  });

  it('shows 1RM and volume for every row, warm-ups and planned sets included', () => {
    const rows = rowsFor(quietSets());
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

  it('highlights no per-column best: without a record every figure is plain', () => {
    const rows = rowsFor([
      performedSet('a', '100', '3', 'rir_1'),
      performedSet('b', '90', '8', 'rir_1'),
    ]);
    // Today's top weight (a) and top 1RM and volume (b) are not marked.
    expect(rows.map(({ weightRecord, oneRepMaxRecord }) => ({ weightRecord, oneRepMaxRecord }))).toEqual([
      { weightRecord: false, oneRepMaxRecord: false },
      { weightRecord: false, oneRepMaxRecord: false },
    ]);
    expect(rows[0]).not.toHaveProperty('volumeEmphasis');
  });

  it('marks a weight or 1RM beating the all-time best as a record, and never a planned row', () => {
    const rows = rowsFor([...quietSets(), performedSet('s6', '90', '6', 'rir_0')], {
      oneRepMax: 102.2,
      weight: { weight: 85, reps: 5 }, volume: null,
    });
    expect(rows[5]).toMatchObject({ weightRecord: true, oneRepMaxRecord: true });
    // 80 × 8 (1RM 102.14) is today's top volume and 1RM, but beats neither record.
    expect(rows[1]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    // Planned 85 × 5 would equal the weight record; a planned row is never one.
    expect(rows[4]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });

    // A weight record without a 1RM record is marked on its own.
    const heavy = rowsFor([performedSet('h', '87.5', '1', 'rir_0')], { oneRepMax: 102.2, weight: { weight: 85, reps: 5 }, volume: null });
    expect(heavy[0]).toMatchObject({ weightRecord: true, oneRepMaxRecord: false });

    // No history, no records.
    expect(rowsFor([performedSet('x', '200', '5', 'rir_0')])[0]).toMatchObject({
      weightRecord: false,
      oneRepMaxRecord: false,
    });
  });

  it('highlights the 1RM record\'s set and the Weight record\'s set, not every qualifying one', () => {
    // Both sets beat the baseline; the best 1RM wins (Epley: 90×8 ≈ 114, 100×6 ≈ 120).
    const both = [performedSet('a', '90', '8', 'rir_1'), performedSet('b', '100', '6', 'rir_0')];
    const bothBaseline = { oneRepMax: 100, weight: { weight: 85, reps: 5 }, volume: null };
    const rows = rowsFor(both, bothBaseline);
    expect(rows[0]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    expect(rows[1]).toMatchObject({ weightRecord: true, oneRepMaxRecord: true });
    expect(bandFor(both, bothBaseline).map(({ label, set }) => [label, set]))
      .toEqual([[expect.stringMatching(/^New 1RM · \d+\.\d \+ top weight$/), '100.0 × 6']]);

    // The best 1RM and the top Weight on different sets: each set, a line each.
    const split = [performedSet('reps', '100', '8', 'rir_1'), performedSet('heavy', '110', '1', 'rir_0')];
    const splitBaseline = { oneRepMax: 100, weight: { weight: 105, reps: 5 }, volume: null };
    expect(rowsFor(split, splitBaseline).map(({ weightRecord, oneRepMaxRecord }) => ({ weightRecord, oneRepMaxRecord })))
      .toEqual([{ weightRecord: false, oneRepMaxRecord: true }, { weightRecord: true, oneRepMaxRecord: false }]);
    expect(bandFor(split, splitBaseline).map(({ label, set }) => [label, set])).toEqual([
      [expect.stringMatching(/^New 1RM record · \d+\.\d$/), '100.0 × 8'],
      ['New top weight', '110.0 × 1'],
    ]);

    // A tie on the best 1RM keeps the set that reached it first.
    const tied = rowsFor(
      [
        performedSet('a', '100', '3', 'rir_0'),
        performedSet('b', '100', '3', 'rir_0'),
      ],
      { oneRepMax: 90, weight: { weight: 90, reps: 5 }, volume: null }
    );
    expect(tied[0]).toMatchObject({ oneRepMaxRecord: true });
    expect(tied[1]).toMatchObject({ oneRepMaxRecord: false });

    // No 1RM beats the baseline: the heaviest qualifying weight is the one
    // record, and its line is the top-weight one.
    const heavySets = [performedSet('a', '90', '3', 'rir_0'), performedSet('b', '95', '1', 'rir_0')];
    const heavyBaseline = { oneRepMax: 120, weight: { weight: 85, reps: 5 }, volume: null };
    const heavy = rowsFor(heavySets, heavyBaseline);
    expect(heavy[0]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    expect(heavy[1]).toMatchObject({ weightRecord: true, oneRepMaxRecord: false });
    expect(bandFor(heavySets, heavyBaseline)).toEqual([
      { key: 'b', label: 'New top weight', set: '95.0 × 1', spoken: 'new top weight 95.0 × 1' },
    ]);
  });

  it('makes a Weight record of more reps at the record weight, never of a zero', () => {
    const baseline = { oneRepMax: 200, weight: { weight: 100, reps: 5 }, volume: null };
    expect(rowsFor([performedSet('more', '100', '6', 'rir_0')], baseline)[0]).toMatchObject({ weightRecord: true });
    expect(rowsFor([performedSet('same', '100', '5', 'rir_0')], baseline)[0]).toMatchObject({ weightRecord: false });

    // A zero record is no baseline: nothing beats it, and a zero beats nothing.
    expect(rowsFor([performedSet('z', '20', '5', 'rir_0')], { oneRepMax: 0, weight: { weight: 0, reps: 10 }, volume: null })[0])
      .toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    expect(rowsFor([performedSet('b', '', '12', 'rir_0')], { oneRepMax: 0, weight: { weight: 0, reps: 10 }, volume: null })[0])
      .toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
  });

  it('uses Working set for Weight records independently of Volume, retaining every row figure', () => {
    const sets = [performedSet('technique', '100', '6', 'technique')];
    const baseline = { oneRepMax: 200, weight: { weight: 100, reps: 5 }, volume: null };
    const volumeContext: LoadContext = {
      ...ordinaryLoadContext(), effortPolicy: { workingSetEfforts: [], volumeEfforts: ['technique'] },
    };
    const volumeOnly = buildSetRows(sets, baseline, volumeContext);
    expect(volumeOnly[0]).toMatchObject({ weight: 100, reps: 6, volume: 600, weightRecord: false, oneRepMaxRecord: false });
    expect(recordBandFor(sets, baseline, volumeContext)).toEqual([]);

    const workingContext: LoadContext = {
      ...ordinaryLoadContext(), effortPolicy: { workingSetEfforts: ['technique'], volumeEfforts: [] },
    };
    const workingOnly = buildSetRows(sets, baseline, workingContext);
    expect(workingOnly[0]).toMatchObject({ volume: 600, weightRecord: true, oneRepMaxRecord: false });
    expect(recordBandFor(sets, baseline, workingContext).map((line) => line.label)).toEqual(['New top weight']);
  });

  it('picks the session\'s record set across every block of the exercise', () => {
    const baseline = { oneRepMax: 100, weight: { weight: 85, reps: 5 }, volume: null };
    const earlierBlock = { id: 'block-1', sets: [performedSet('e', '110', '5', 'rir_0')] };
    const thisBlock = [performedSet('t', '100', '6', 'rir_0')];
    const session = { blockId: 'block-2', blocks: [earlierBlock, { id: 'block-2', sets: thisBlock }] };

    // The earlier block holds the session's best 1RM and top Weight, so this
    // block shows no record, and no band: its lines sit on the earlier block.
    expect(rowsFor(thisBlock, baseline, session)[0]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    expect(bandFor(thisBlock, baseline, session)).toEqual([]);
    expect(rowsFor(thisBlock, baseline)[0]).toMatchObject({ oneRepMaxRecord: true });
    expect(bandFor(thisBlock, baseline).map((line) => line.key)).toEqual(['t']);
  });

  it('groups the session\'s blocks by the exercise the page shows now, a swap included', () => {
    const squat = { id: 'block-1', exerciseDefinitionId: 'squat', sets: [performedSet('s', '100', '5', 'rir_0')] };
    const curl = { id: 'block-3', exerciseDefinitionId: 'curl', sets: [performedSet('c', '20', '8', 'rir_0')] };
    // Block 2 was loaded as a squat and swapped to a curl since.
    const loaded = [squat, { id: 'block-2', exerciseDefinitionId: 'squat', sets: [] }, curl];

    expect(sessionRecordBlocks({ id: 'block-2', exerciseDefinitionId: 'curl' }, loaded).blocks.map((block) => block.id))
      .toEqual(['block-2', 'block-3']);
    expect(sessionRecordBlocks({ id: 'block-2', exerciseDefinitionId: 'squat' }, loaded).blocks.map((block) => block.id))
      .toEqual(['block-1', 'block-2']);
    // A block missing from the loaded session still records on its own sets.
    expect(sessionRecordBlocks({ id: 'new', exerciseDefinitionId: 'curl' }, loaded))
      .toEqual({ blockId: 'new', blocks: [{ id: 'new', sets: [] }] });
  });

  it('announces every record with the session card\'s band lines, or none at all', () => {
    expect(bandFor(quietSets())).toEqual([]);

    const set = [performedSet('a', '100', '3', 'rir_0')];
    expect(bandFor(set, { oneRepMax: 100, weight: { weight: 200, reps: 5 }, volume: null })).toEqual([
      { key: 'a', label: 'New 1RM record · 109.0', set: '100.0 × 3', spoken: 'new 1RM record 109.0 on 100.0 × 3' },
    ]);
    // The exercise's session volume (100 × 3) beats the Volume record.
    expect(bandFor(set, { oneRepMax: 500, weight: { weight: 200, reps: 5 }, volume: 250 })).toEqual([
      { key: 'volume', label: 'New volume record · 300', set: null, spoken: 'new volume record 300' },
    ]);

    expect(bandFor([], { oneRepMax: 100, weight: { weight: 200, reps: 5 }, volume: 1 })).toEqual([]);
  });

  it('never marks a warm-up as a record, though it keeps its own figures', () => {
    const rows = rowsFor([
      performedSet('w', '120', '5', 'warm_up'),
      performedSet('k', '90', '5', 'rir_1'),
    ], { oneRepMax: 102.2, weight: { weight: 85, reps: 5 }, volume: null });

    // The warm-up beats both records on its figures, which still show.
    expect(rows[0]).toMatchObject({ setType: 'warm_up', weight: 120, reps: 5, volume: 600 });
    expect(rows[0]?.oneRepMax).toBeGreaterThan(102.2);
    expect(rows[0]).toMatchObject({ weightRecord: false, oneRepMaxRecord: false });
    expect(rows[1]).toMatchObject({ weightRecord: true, oneRepMaxRecord: true });
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

  it('commits a blank weight with valid reps as 0, like every set entry', () => {
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

  it('drops a touched planned row back to its plan, keeping it in place', () => {
    const sets = quietSets();
    const typed = updateLoggerValues(sets, 's3', { weightValue: '90', repsValue: '4' });

    const dropped = dropSet(typed, 's3');
    // The planned row is pristine again: values blank, actual effort blank —
    // it reads as its plan (prescribed 82.5 × 6, RIR 1) through the fallback.
    expect(dropped).toHaveLength(5);
    expect(dropped[2]).toMatchObject({
      id: 's3',
      weightValue: '',
      repsValue: '',
      setType: null,
      performanceStatus: 'planned',
      plannedWeightValue: '82.5',
      plannedRepsValue: '6',
    });
    expect(displayedValues(dropped[2])).toEqual({ weightValue: '82.5', repsValue: '6', setType: 'rir_1' });
    expect(findCursorIndex(dropped)).toBe(2);

    // A planned row whose only entry is a chosen effort returns to blank.
    const cycled = updateLoggerValues(sets, 's3', { setType: 'rir_0' });
    expect(dropSet(cycled, 's3')[2]).toMatchObject({ setType: null });
  });

  it('drops an ad-hoc row by removing it, with or without values', () => {
    const adHoc = (id: string, weight: string, reps: string) =>
      ({ ...performedSet(id, weight, reps, 'rir_2'), performanceStatus: 'unperformed' as const });
    const sets = [...quietSets(), adHoc('x', '60', '8'), adHoc('blank', '', '')];

    expect(dropSet(sets, 'x').map((set) => set.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 'blank']);
    expect(dropSet(sets, 'blank').map((set) => set.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 'x']);
    // The last row going leaves an empty list; Add set starts afresh from it.
    expect(dropSet([adHoc('only', '60', '8')], 'only')).toEqual([]);
  });

  it('leaves an untouched planned row and an unknown id alone', () => {
    const sets = quietSets();
    expect(dropSet(sets, 's3')).toBe(sets);
    expect(dropSet(sets, 'missing')).toBe(sets);
  });

  it('drops a confirmed ad-hoc row by removing it, so a finished list stays editable', () => {
    const sets = quietSets();
    // s1 and s2 are confirmed and carry no plan: the swipe removes them.
    expect(dropSet(sets, 's1').map((set) => set.id)).toEqual(['s2', 's3', 's4', 's5']);
    expect(canDropSet(sets, 's1')).toBe(true);
  });

  it('drops a confirmed planned row back to its plan instead of deleting it', () => {
    const sets = quietSets();
    const performed = commitSet(sets, 's3', displayedValues(sets[2]));
    expect(isPerformed(performed[2])).toBe(true);

    const dropped = dropSet(performed, 's3');
    expect(dropped).toHaveLength(5);
    expect(dropped[2]).toMatchObject({
      id: 's3',
      weightValue: '',
      repsValue: '',
      setType: null,
      performanceStatus: 'planned',
      plannedWeightValue: '82.5',
      plannedRepsValue: '6',
    });
    expect(findCursorIndex(dropped)).toBe(2);
  });

  it('offers a swipe side only when its move would change the row', () => {
    const sets = quietSets();
    // Untouched planned row: nothing to drop, but its plan is a valid set.
    expect(canDropSet(sets, 's3')).toBe(false);
    expect(canConfirmSet(sets, 's3')).toBe(true);
    // Touched with invalid values: droppable, not confirmable.
    const invalid = updateLoggerValues(sets, 's3', { repsValue: '0' });
    expect(canDropSet(invalid, 's3')).toBe(true);
    expect(canConfirmSet(invalid, 's3')).toBe(false);
    expect(canDropSet(sets, 'missing')).toBe(false);
    expect(canConfirmSet(sets, 'missing')).toBe(false);
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
      setType: 'warm_up',
    });
  });

  it.each(['warm_up', null, 'rir_3', 'rir_2', 'rir_1', 'rir_0'] as const)(
    'defaults the next effort after %s without changing the previous row', (previous) => {
      const first = performedSet('first', '50', '8', previous);
      const result = addSet([first], 'next');
      expect(result[0]).toBe(first);
      expect(result[1]).toMatchObject({
        weightValue: '50', repsValue: '8', performanceStatus: 'unperformed',
        setType: previous === 'warm_up' ? null : previous,
      });
    }
  );

  it('skips hidden efforts for new rows without rewriting the prescribed source', () => {
    const source = plannedSet('p', '80', '6', 'rir_3');
    expect(addSet([source], 'next', ['rir_2', 'rir_0'])[1]).toMatchObject({
      setType: 'rir_2', plannedSetType: null, performanceStatus: 'unperformed',
    });
    expect(source.plannedSetType).toBe('rir_3');
    expect(addSet([source], 'next', ['rir_4'])[1].setType).toBe('rir_4');
  });

  it('keeps an explicitly cleared planned effort blank through edits and confirmation', () => {
    const sets = [plannedSet('p', '80', '6', 'rir_3')];
    const cleared = updateLoggerValues(sets, 'p', { setType: null });
    expect(displayedValues(cleared[0]).setType).toBeNull();
    const typed = updateLoggerValues(cleared, 'p', { repsValue: '5' });
    const confirmed = commitSet(typed, 'p', displayedValues(typed[0]));
    expect(displayedValues(confirmed[0]).setType).toBeNull();
    expect(confirmed[0].plannedSetType).toBe('rir_3');
  });

  it('completes by removing every set that was not confirmed, planned ones included', () => {
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

    // The three planned rows and the typed-but-unticked one are counted; the
    // blank row goes without being named.
    expect(plan).toMatchObject({ unfinishedToRemove: 4, needsConfirmation: true });
    expect(plan.nextSets.map((set) => [set.id, set.performanceStatus])).toEqual([
      ['s1', null],
      ['s2', null],
    ]);
    expect(describeCompleteExercisePlan(plan)).toBe(
      '4 unfinished sets will be removed.'
    );

    // A second Complete has nothing left to ask about.
    expect(planCompleteExercise(plan.nextSets)).toMatchObject({
      needsConfirmation: false,
      unfinishedToRemove: 0,
    });
    expect(describeCompleteExercisePlan(planCompleteExercise(plan.nextSets))).toBe('');
  });

  it('completes a blank trailing row without asking, since it holds nothing to lose', () => {
    const blank = { ...performedSet('blank', '', '', null), performanceStatus: 'unperformed' as const };
    const plan = planCompleteExercise([...quietSets().slice(0, 2), blank]);

    expect(plan).toMatchObject({ unfinishedToRemove: 0, needsConfirmation: false });
    expect(plan.nextSets.map((set) => set.id)).toEqual(['s1', 's2']);
  });

  it('names one unfinished set in the singular', () => {
    const sets = updateLoggerValues(quietSets().slice(0, 3), 's3', { repsValue: '4' });
    expect(describeCompleteExercisePlan(planCompleteExercise(sets))).toBe(
      '1 unfinished set will be removed.'
    );
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
