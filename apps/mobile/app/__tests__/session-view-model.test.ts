import type { Session, SessionSet } from '@/components/session-recorder/types';
import { activeSessionHref, sessionExerciseHref } from '@/src/navigation/active-session-entry';
import {
  appendSuggestedPlan,
  describeSubmitCleanupPrompt,
  nextSubmitCleanup,
} from '@/src/session-recorder/session-model';
import {
  buildSessionViewModel,
  formatElapsed,
  historicalBestOneRepMax,
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
  tags: [],
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

  it('bolds the best of each column among done sets, per column', () => {
    const [card] = buildSessionViewModel(session([bench]), new Map()).cards;
    const byId = new Map(card.rows.map((row) => [row.id, row]));

    // Heaviest weight is 162.5; best 1RM and volume are the RIR 2 set. The
    // planned 165 does not count — it is not realised.
    expect(byId.get('b3')?.bestWeight).toBe(true);
    expect(byId.get('b4')?.bestWeight).toBe(false);
    expect(byId.get('b2')?.oneRepMaxEmphasis).toBe('best');
    expect(byId.get('b2')?.bestVolume).toBe(true);
    expect(card.recordOneRepMax).toBeNull();
  });

  it('marks a record only when today beats the loaded history, and not before it loads', () => {
    const beaten = buildSessionViewModel(session([bench]), new Map([['def_bench', 197.9]])).cards[0];
    expect(beaten.recordOneRepMax).toBe('204.3');
    expect(beaten.rows.find((row) => row.id === 'b2')?.oneRepMaxEmphasis).toBe('record');

    const notBeaten = buildSessionViewModel(session([bench]), new Map([['def_bench', 210]])).cards[0];
    expect(notBeaten.recordOneRepMax).toBeNull();

    // No history for the exercise (first time, or not loaded yet): no record.
    const firstTime = buildSessionViewModel(session([bench]), new Map([['def_bench', null]])).cards[0];
    expect(firstTime.recordOneRepMax).toBeNull();
  });

  it('totals done sets and their volume, warm-ups included', () => {
    const model = buildSessionViewModel(session([bench]), new Map());
    expect(model.performedSetCount).toBe(3);
    expect(model.volume).toBe('3255');
  });

  it('shows a blank row as absent values', () => {
    const [card] = buildSessionViewModel(
      session([{ ...bench, id: 'blank', sets: [blankSet('x1')] }]),
      new Map()
    ).cards;
    expect(card.rows[0]).toMatchObject({ typeLabel: '—', weightReps: '— × —', oneRepMax: '—', volume: '—', done: false });
    expect(card.doneCount).toBe(0);
  });

  it('reads the best historical 1RM from completed blocks', () => {
    const block = (estimatedOneRepMax: number | null) => ({
      sessionId: 's',
      completedAt: new Date(0),
      daysAgo: 1,
      sessionExerciseIds: [],
      estimatedOneRepMax,
      totalVolume: 0,
      highestWeight: null,
      workingSetCount: 0,
    });
    expect(historicalBestOneRepMax([block(180), block(null), block(197.9)])).toBe(197.9);
    expect(historicalBestOneRepMax([block(null)])).toBeNull();
  });

  it('formats elapsed time as m:ss, then h:mm:ss', () => {
    const start = new Date('2026-09-23T09:00:00Z');
    expect(formatElapsed(start, new Date('2026-09-23T09:47:12Z'))).toBe('47:12');
    expect(formatElapsed(start, new Date('2026-09-23T10:05:03Z'))).toBe('1:05:03');
    expect(formatElapsed(start, new Date('2026-09-23T08:59:00Z'))).toBe('0:00');
  });
});

describe('submit cleanup (shared by the recorder and the session view)', () => {
  it('asks about incomplete sets, then unconfirmed ones, then empty exercises, then completes', () => {
    const unconfirmed = { ...doneSet('u1', '50', '5', 'rir_1'), performanceStatus: 'unperformed' as const };
    const start = session([
      { ...bench, sets: [bench.sets[1], blankSet('x1'), unconfirmed] },
      { ...bench, id: 'fly', exerciseDefinitionId: 'def_fly', sets: [plannedSet('f1', '20', '10', 'rir_1')] },
    ]);

    const first = nextSubmitCleanup(start);
    expect(first).toMatchObject({ kind: 'prompt', prompt: { step: 'incomplete-sets', affectedCount: 1 } });
    if (first.kind !== 'prompt') throw new Error('expected a prompt');

    const second = nextSubmitCleanup(first.prompt.nextSession);
    expect(second).toMatchObject({ kind: 'prompt', prompt: { step: 'unconfirmed-sets', affectedCount: 1 } });
    if (second.kind !== 'prompt') throw new Error('expected a prompt');

    const third = nextSubmitCleanup(second.prompt.nextSession);
    expect(third).toMatchObject({ kind: 'prompt', prompt: { step: 'empty-exercises', affectedCount: 1 } });
    if (third.kind !== 'prompt') throw new Error('expected a prompt');

    const done = nextSubmitCleanup(third.prompt.nextSession);
    expect(done.kind).toBe('ready');
    if (done.kind !== 'ready') throw new Error('expected ready');
    expect(done.session.exercises.map((exercise) => exercise.sets.map((set) => set.id))).toEqual([['b2']]);
  });

  it('keeps the recorder copy for each prompt', () => {
    expect(describeSubmitCleanupPrompt({ step: 'incomplete-sets', affectedCount: 2 }, 'active')).toEqual({
      title: 'Remove incomplete sets and submit?',
      message: '2 incomplete sets missing reps or weight will be removed.',
      confirmLabel: 'Remove incomplete sets and submit',
    });
    expect(describeSubmitCleanupPrompt({ step: 'unconfirmed-sets', affectedCount: 1 }, 'completed-edit')).toEqual({
      title: 'Discard unconfirmed sets and submit?',
      message: '1 set with entered values is not confirmed and will be discarded.',
      confirmLabel: 'Discard unconfirmed sets and save changes',
    });
    expect(describeSubmitCleanupPrompt({ step: 'empty-exercises', affectedCount: 1 }, 'active').confirmLabel).toBe(
      'Remove empty exercises and submit'
    );
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
  it('opens the session view only with the setting on and a known session', () => {
    expect(activeSessionHref('s1', true)).toBe('/session/s1');
    expect(activeSessionHref('s1', false)).toBe('/session-recorder');
    expect(activeSessionHref(null, true)).toBe('/session-recorder');
    expect(sessionExerciseHref('s1', 'e 1')).toBe('/session/s1/exercise/e%201');
  });
});
