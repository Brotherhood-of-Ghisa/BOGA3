import type { Session, SessionSet } from '@/components/session-recorder/types';
import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { sessionExerciseHref, sessionViewHref } from '@/src/navigation/active-session-entry';
import {
  appendSuggestedPlan,
  describeSubmitCleanupPrompt,
  nextSubmitCleanup,
  sessionHasInvalidSetValues,
} from '@/src/session-recorder/session-model';
import {
  buildSessionViewModel,
  completedSessionTitle,
  formatElapsed,
  sessionTitleForStart,
} from '@/src/session-recorder/session-view-model';

const doneSet = (id: string, weight: string, reps: string, setType: SessionSet['setType']): SessionSet => ({
  id,
  weight,
  reps,
  setType,
  plannedWeight: null,
  plannedReps: null,
  plannedSetType: null,
  performanceStatus: null,
});

const plannedSet = (id: string, weight: string, reps: string, setType: SessionSet['setType']): SessionSet => ({
  id,
  weight: '',
  reps: '',
  setType: null,
  plannedWeight: weight,
  plannedReps: reps,
  plannedSetType: setType,
  performanceStatus: 'planned',
});

const blankSet = (id: string): SessionSet => ({
  id,
  weight: '',
  reps: '',
  setType: null,
  plannedWeight: null,
  plannedReps: null,
  plannedSetType: null,
  performanceStatus: 'unperformed',
});

const baseline = (oneRepMax: number, weight: number, reps: number, volume: number | null = null): RecordBaseline => ({
  oneRepMax,
  weight: { weight, reps },
  volume,
});

const session = (exercises: Session['exercises']): Session => ({
  dateTime: '2026-09-23 09:00',
  locationId: null,
  exercises,
});

const bench = {
  id: 'bench',
  exerciseDefinitionId: 'def_bench',
  name: 'Barbell Bench Press',
  machineName: '',
  sets: [
    doneSet('b1', '100', '10', 'warm_up'),
    doneSet('b2', '160', '8', 'rir_2'),
    doneSet('b3', '162.5', '6', 'rir_1'),
    plannedSet('b4', '165', '5', 'rir_0'),
  ],
};

describe('session view model', () => {
  it('shows every row with its figures, fading what is not done', () => {
    const model = buildSessionViewModel(session([bench]), new Map());
    const [card] = model.cards;

    expect(card.doneCount).toBe(3);
    expect(card.totalCount).toBe(4);
    expect(card.rows.map((row) => [row.typeLabel, row.weightReps, row.oneRepMax, row.volume, row.done])).toEqual([
      ['W-Up', '100.0 × 10', '134.7', '1000', true],
      ['RIR 2', '160.0 × 8', '204.3', '1280', true],
      ['RIR 1', '162.5 × 6', '195.5', '975', true],
      // A planned row shows its prescription and projected figures.
      ['RIR 0', '165.0 × 5', '192.4', '825', false],
    ]);
  });

  it('highlights nothing without a record', () => {
    const [card] = buildSessionViewModel(session([bench]), new Map()).cards;
    expect(card.rows.some((row) => row.oneRepMaxRecord || row.weightRecord)).toBe(false);
    expect(card.record).toEqual([]);
  });

  const flags = (card: { rows: { id: string; oneRepMaxRecord: boolean; weightRecord: boolean }[] }) =>
    card.rows.flatMap(({ id, oneRepMaxRecord, weightRecord }) =>
      oneRepMaxRecord || weightRecord ? [{ id, oneRepMaxRecord, weightRecord }] : []);
  const labels = (card: { record: { label: string; set: string | null }[] }) =>
    card.record.map(({ label, set }) => [label, set]);

  it('marks the 1RM record set only when today beats the loaded records, and not before they load', () => {
    const beaten = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(197.9, 165, 5)]])).cards[0];
    expect(beaten.record).toEqual([{
      key: 'b2', label: 'New 1RM record · 204.3', set: '160.0 × 8', spoken: 'new 1RM record 204.3 on 160.0 × 8',
    }]);
    expect(flags(beaten)).toEqual([{ id: 'b2', oneRepMaxRecord: true, weightRecord: false }]);

    const notBeaten = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(210, 165, 5)]])).cards[0];
    expect(notBeaten.record).toEqual([]);

    // No earlier record for the exercise (first time, or not loaded yet): no record.
    const firstTime = buildSessionViewModel(session([bench]), new Map([['def_other', baseline(100, 100, 1)]])).cards[0];
    expect(firstTime.record).toEqual([]);
  });

  it('marks the 1RM and Weight records on their own sets, a band line each', () => {
    // 160 × 8 has the best 1RM; 162.5 × 6 is the top Weight. Both beat.
    const [card] = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(197.9, 150, 5)]])).cards;
    expect(flags(card)).toEqual([
      { id: 'b2', oneRepMaxRecord: true, weightRecord: false },
      { id: 'b3', oneRepMaxRecord: false, weightRecord: true },
    ]);
    expect(labels(card)).toEqual([['New 1RM record · 204.3', '160.0 × 8'], ['New top weight', '162.5 × 6']]);
  });

  it('names one set that takes both strength records on one line', () => {
    const press = { ...bench, sets: [doneSet('p1', '100', '5', 'rir_1'), doneSet('p2', '120', '5', 'rir_1')] };
    const [card] = buildSessionViewModel(session([press]), new Map([['def_bench', baseline(100, 110, 5)]])).cards;
    expect(flags(card)).toEqual([{ id: 'p2', oneRepMaxRecord: true, weightRecord: true }]);
    expect(card.record).toEqual([{
      key: 'p2',
      label: `New 1RM · ${card.rows[1].oneRepMax} + top weight`,
      set: '120.0 × 5',
      spoken: `new 1RM ${card.rows[1].oneRepMax} and top weight 120.0 × 5`,
    }]);
  });

  it('falls back to the heaviest Weight record when no 1RM beats the record', () => {
    // 160 × 8 beats 160 × 6 on reps, but 162.5 × 6 is heavier: it is the record set.
    const [card] = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(210, 160, 6)]])).cards;
    expect(flags(card)).toEqual([{ id: 'b3', oneRepMaxRecord: false, weightRecord: true }]);
    expect(card.record).toEqual([{ key: 'b3', label: 'New top weight', set: '162.5 × 6', spoken: 'new top weight 162.5 × 6' }]);
  });

  it('adds a Volume line on the exercise\'s first block when its session volume beats the record', () => {
    const later = { ...bench, id: 'bench-2', sets: [doneSet('c1', '150', '8', 'rir_2')] };
    const model = buildSessionViewModel(session([bench, later]), new Map([['def_bench', baseline(210, 200, 1, 1)]]));
    expect(labels(model.cards[0])).toEqual([[`New volume record · ${model.volume}`, null]]);
    expect(model.cards[0].record[0].spoken).toBe(`new volume record ${model.volume}`);
    expect(model.cards[1].record).toEqual([]);

    const notBeaten = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(210, 200, 1, 1e9)]]));
    expect(notBeaten.cards[0].record).toEqual([]);
  });

  it('bands each record on the block holding its set, across the blocks of an exercise', () => {
    const later = { ...bench, id: 'bench-2', sets: [doneSet('c1', '150', '8', 'rir_2')] };
    const cards = buildSessionViewModel(session([bench, later]), new Map([['def_bench', baseline(197.9, 165, 5)]])).cards;
    expect(flags(cards[0])).toEqual([{ id: 'b2', oneRepMaxRecord: true, weightRecord: false }]);
    expect(labels(cards[0])).toEqual([['New 1RM record · 204.3', '160.0 × 8']]);
    expect(flags(cards[1])).toEqual([]);
    expect(cards[1].record).toEqual([]);

    const heavierLater = { ...later, sets: [doneSet('c1', '170', '2', 'rir_0')] };
    const split = buildSessionViewModel(session([bench, heavierLater]), new Map([['def_bench', baseline(197.9, 165, 5)]])).cards;
    expect(labels(split[0])).toEqual([['New 1RM record · 204.3', '160.0 × 8']]);
    expect(labels(split[1])).toEqual([['New top weight', '170.0 × 2']]);
    expect(flags(split[1])).toEqual([{ id: 'c1', oneRepMaxRecord: false, weightRecord: true }]);
  });

  it('shows no record against a zero baseline', () => {
    const [card] = buildSessionViewModel(session([bench]), new Map([['def_bench', baseline(0, 0, 10, 0)]])).cards;
    expect(flags(card)).toEqual([]);
    expect(card.record).toEqual([]);
  });

  it('never marks a warm-up heavier than the working sets as the record', () => {
    const heavyWarmUp = { ...bench, sets: [doneSet('w', '250', '5', 'warm_up'), ...bench.sets.slice(1)] };
    const [card] = buildSessionViewModel(session([heavyWarmUp]), new Map([['def_bench', baseline(197.9, 165, 5)]])).cards;

    // The warm-up keeps its own figures, but the record is the best working set.
    expect(card.rows[0]).toMatchObject({ typeLabel: 'W-Up', weightReps: '250.0 × 5', volume: '1250', oneRepMaxRecord: false, weightRecord: false });
    expect(flags(card)).toEqual([{ id: 'b2', oneRepMaxRecord: true, weightRecord: false }]);
    expect(labels(card)).toEqual([['New 1RM record · 204.3', '160.0 × 8']]);

    // Only the warm-up beats the records: no record at all.
    const [onlyWarmUpBeats] = buildSessionViewModel(session([heavyWarmUp]), new Map([['def_bench', baseline(210, 200, 1)]])).cards;
    expect(onlyWarmUpBeats.record).toEqual([]);
    expect(flags(onlyWarmUpBeats)).toEqual([]);
  });

  it('counts the done working sets and totals their volume', () => {
    const model = buildSessionViewModel(session([bench]), new Map());
    // The 100 × 10 warm-up is done but no set.
    expect(model.workingSetCount).toBe(2);
    // 160 × 8 + 162.5 × 6; the 100 × 10 warm-up adds no volume.
    expect(model.volume).toBe('2255');
  });

  it('keeps a warm-up-only exercise card but adds nothing to the sets or volume', () => {
    const warmUpOnly = { ...bench, sets: [doneSet('w', '100', '10', 'warm_up')] };
    const model = buildSessionViewModel(session([warmUpOnly]), new Map());
    expect(model.cards[0].rows[0]).toMatchObject({ typeLabel: 'W-Up', volume: '1000' });
    expect(model.workingSetCount).toBe(0);
    expect(model.volume).toBe('0');
  });

  it('totals the volume of the rest when a set\'s load cannot be calculated, with no note', () => {
    // Corrupt stored context: the way a personal set's load cannot be calculated.
    const corrupt = { ...bench, id: 'corrupt', exerciseDefinitionId: 'def_corrupt',
      loadContext: { policy: 'personal' as const, bodyweightContribution: 0, loadInputMode: 'sideways' as 'total_load' },
      sets: [doneSet('c1', '200', '5', 'rir_1')] };
    const model = buildSessionViewModel(session([bench, corrupt]), new Map());
    // [[copy.no-inline-explanation]]: 160 × 8 + 162.5 × 6, the 200 × 5 left out.
    expect(model.workingSetCount).toBe(3);
    expect(model.volume).toBe('2255');
    expect(Object.keys(model)).toEqual(['cards', 'workingSetCount', 'volume']);
  });

  it('shows a blank row as absent values', () => {
    const [card] = buildSessionViewModel(
      session([{ ...bench, id: 'blank', sets: [blankSet('x1')] }]),
      new Map()
    ).cards;
    expect(card.rows[0]).toMatchObject({ typeLabel: '—', weightReps: '— × —', oneRepMax: '—', volume: '—', done: false });
    expect(card.doneCount).toBe(0);
  });

  it('formats elapsed time as m:ss, then h:mm:ss', () => {
    const start = new Date('2026-09-23T09:00:00Z');
    expect(formatElapsed(start, new Date('2026-09-23T09:47:12Z'))).toBe('47:12');
    expect(formatElapsed(start, new Date('2026-09-23T10:05:03Z'))).toBe('1:05:03');
    expect(formatElapsed(start, new Date('2026-09-23T08:59:00Z'))).toBe('0:00');
  });

  it('names the session by the local hour it started, at each boundary', () => {
    const at = (hour: number, minute = 0) => sessionTitleForStart(new Date(2026, 8, 23, hour, minute));
    expect(at(4, 59)).toBe('Night training');
    expect(at(5)).toBe('Morning training');
    expect(at(11, 59)).toBe('Morning training');
    expect(at(12)).toBe('Afternoon training');
    expect(at(16, 59)).toBe('Afternoon training');
    expect(at(17)).toBe('Evening training');
    expect(at(20, 59)).toBe('Evening training');
    expect(at(21)).toBe('Night training');
    expect(at(0)).toBe('Night training');
  });

  it('titles a finished session by its time of day and local start date', () => {
    expect(completedSessionTitle(new Date(2026, 1, 19, 16, 0))).toBe('Afternoon training · 19 Feb');
    expect(completedSessionTitle(new Date(2026, 11, 3, 6, 30))).toBe('Morning training · 3 Dec');
  });
});

describe('set field validation', () => {
  // The field check uses the calculation parser, so a value it accepts counts everywhere.
  it.each(['1e3', '0x10', '-5'])('marks weight %p invalid', (weight) => {
    expect(sessionHasInvalidSetValues(session([{ ...bench, sets: [doneSet('w', weight, '5', null)] }]))).toBe(true);
  });

  it.each(['', '42.', '.5', '100'])('accepts weight %p', (weight) => {
    expect(sessionHasInvalidSetValues(session([{ ...bench, sets: [doneSet('w', weight, '5', null)] }]))).toBe(false);
  });

  it.each(['0', '1.5', '1e1'])('marks reps %p invalid', (reps) => {
    expect(sessionHasInvalidSetValues(session([{ ...bench, sets: [doneSet('r', '100', reps, null)] }]))).toBe(true);
  });
});

describe('submit cleanup', () => {
  it('asks about unconfirmed sets, then removes incomplete sets and empty exercises behind one prompt', () => {
    const unconfirmed = { ...doneSet('u1', '50', '5', 'rir_1'), performanceStatus: 'unperformed' as const };
    const start = session([
      { ...bench, sets: [bench.sets[1], blankSet('x1'), unconfirmed] },
      { ...bench, id: 'fly', exerciseDefinitionId: 'def_fly', sets: [plannedSet('f1', '20', '10', 'rir_1')] },
    ]);

    const first = nextSubmitCleanup(start);
    expect(first).toMatchObject({ kind: 'prompt', prompt: { step: 'unconfirmed-sets', affectedCount: 1 } });
    if (first.kind !== 'prompt') throw new Error('expected a prompt');

    const second = nextSubmitCleanup(first.prompt.nextSession);
    expect(second).toMatchObject({
      kind: 'prompt',
      prompt: { step: 'empty-sets-and-exercises', incompleteSetCount: 1, emptyExerciseCount: 1 },
    });
    if (second.kind !== 'prompt') throw new Error('expected a prompt');

    const done = nextSubmitCleanup(second.prompt.nextSession);
    expect(done.kind).toBe('ready');
    if (done.kind !== 'ready') throw new Error('expected ready');
    expect(done.session.exercises.map((exercise) => exercise.sets.map((set) => set.id))).toEqual([['b2']]);
  });

  it('asks once for an added exercise whose only set was left empty', () => {
    const start = session([
      { ...bench, sets: [bench.sets[1]] },
      { ...bench, id: 'fly', exerciseDefinitionId: 'def_fly', sets: [blankSet('x1')] },
    ]);

    const first = nextSubmitCleanup(start);
    expect(first).toMatchObject({
      kind: 'prompt',
      prompt: { step: 'empty-sets-and-exercises', incompleteSetCount: 1, emptyExerciseCount: 1 },
    });
    if (first.kind !== 'prompt') throw new Error('expected a prompt');
    const done = nextSubmitCleanup(first.prompt.nextSession);
    expect(done.kind).toBe('ready');
    if (done.kind !== 'ready') throw new Error('expected ready');
    expect(done.session.exercises.map((exercise) => exercise.id)).toEqual([bench.id]);
  });

  it('keeps the cleanup copy for each prompt, and names both removals when there are two', () => {
    expect(
      describeSubmitCleanupPrompt(
        { step: 'empty-sets-and-exercises', incompleteSetCount: 2, emptyExerciseCount: 0 },
        'active'
      )
    ).toEqual({
      title: 'Remove incomplete sets and submit?',
      message: '2 incomplete sets missing reps or weight will be removed.',
      confirmLabel: 'Remove incomplete sets and submit',
    });
    expect(describeSubmitCleanupPrompt({ step: 'unconfirmed-sets', affectedCount: 1 }, 'completed-edit')).toEqual({
      title: 'Discard unconfirmed sets and submit?',
      message: '1 set with entered values is not confirmed and will be discarded.',
      confirmLabel: 'Discard unconfirmed sets and save changes',
    });
    expect(
      describeSubmitCleanupPrompt(
        { step: 'empty-sets-and-exercises', incompleteSetCount: 0, emptyExerciseCount: 1 },
        'active'
      ).confirmLabel
    ).toBe('Remove empty exercises and submit');
    expect(
      describeSubmitCleanupPrompt(
        { step: 'empty-sets-and-exercises', incompleteSetCount: 1, emptyExerciseCount: 2 },
        'active'
      )
    ).toEqual({
      title: 'Remove incomplete sets and empty exercises?',
      message: '1 incomplete set missing reps or weight and 2 exercises left with no sets will be removed.',
      confirmLabel: 'Remove and submit',
    });
  });
});

describe('appendSuggestedPlan', () => {
  const suggested = [{ setId: 'h1', sessionExerciseId: 'hx', weightValue: '100', repsValue: '5', setType: 'rir_1' }];

  it('appends onto the last exercise when it is the same definition', () => {
    const { session: next, targetExerciseId } = appendSuggestedPlan(
      session([bench]),
      { id: 'def_bench', name: 'Barbell Bench Press' },
      suggested as never,
      'new-id'
    );
    expect(targetExerciseId).toBe('bench');
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].sets.at(-1)).toMatchObject({
      plannedWeight: '100',
      plannedReps: '5',
      plannedSetType: 'rir_1',
      performanceStatus: 'planned',
    });
  });

  it('adds a new exercise otherwise', () => {
    const { session: next, targetExerciseId } = appendSuggestedPlan(
      session([bench]),
      { id: 'def_row', name: 'Row' },
      suggested as never,
      'new-id'
    );
    expect(targetExerciseId).toBe('new-id');
    expect(next.exercises.map((exercise) => exercise.id)).toEqual(['bench', 'new-id']);
  });
});

describe('active session entry', () => {
  it('builds the session view and exercise page hrefs', () => {
    expect(sessionViewHref('s1')).toBe('/session/s1');
    expect(sessionExerciseHref('s1', 'e 1')).toBe('/session/s1/exercise/e%201');
  });
});
