import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

// View Session's model: confirmed sets with valid values only, the session
// view's row, and the session view's record rule.

const bench = {
  id: 'bench',
  exerciseDefinitionId: 'bench-def',
  name: 'Bench Press',
  sets: [
    { id: 'b1', weight: '60', reps: '10', setType: 'warm_up' },
    { id: 'b2', weight: '100', reps: '5', setType: 'rir_1' },
    { id: 'b-zero', weight: '', reps: '5', setType: 'rir_1' },
    { id: 'b-invalid', weight: '-1', reps: '5', setType: 'rir_1' },
    { id: 'b-skipped', weight: '140', reps: '5', setType: 'rir_0', performanceStatus: 'unperformed' as const },
  ],
};

const baseline = (oneRepMax: number, weight: number, reps: number, volume: number | null = null): RecordBaseline => ({
  oneRepMax,
  weight: { weight, reps },
  volume,
});

const legacy = {
  id: 'legacy',
  exerciseDefinitionId: null,
  name: 'Old Import',
  sets: [{ id: 'l1', weight: '82.5', reps: '8', setType: null }],
};

describe('buildCompletedSessionDetailModel', () => {
  it('keeps confirmed sets with valid values and counts the working ones', () => {
    const model = buildCompletedSessionDetailModel([bench, legacy], new Map());

    expect(model.cards.map((card) => card.id)).toEqual(['bench', 'legacy']);
    // The card's `<n> sets` counts working sets; the warm-up keeps its row.
    expect(model.cards[0].setCount).toBe(2);
    expect(model.cards[0].rows.map((row) => row.id)).toEqual(['b1', 'b2', 'b-zero']);
    expect(model.cards[0].rows[2]).toMatchObject({ weightReps: '0.0 × 5', volume: '0', oneRepMax: '0.0' });
    expect(model.workingSetCount).toBe(3);
    // Working sets only: 100×5 + 0×5 + 82.5×8, rounded, no separator; the
    // 60×10 warm-up keeps its row and adds no volume.
    expect(model.volume).toBe('1160');
  });

  it('keeps a warm-up-only exercise card, with no sets or volume', () => {
    const warmUpOnly = { ...bench, sets: [{ id: 'w', weight: '60', reps: '10', setType: 'warm_up' }] };
    const model = buildCompletedSessionDetailModel([warmUpOnly], new Map());
    expect(model.cards[0]).toMatchObject({ setCount: 0, rows: [expect.objectContaining({ id: 'w', volume: '600' })] });
    expect(model.workingSetCount).toBe(0);
    expect(model.volume).toBe('0');
  });

  it("formats rows as the session view does", () => {
    const [warmUp, working] = buildCompletedSessionDetailModel([bench], new Map()).cards[0].rows;

    expect(warmUp).toMatchObject({ typeLabel: 'W-Up', weightReps: '60.0 × 10', volume: '600', done: true });
    expect(working).toMatchObject({ typeLabel: 'RIR 1', weightReps: '100.0 × 5', done: true });
    expect(working.oneRepMax).toMatch(/^\d+\.\d$/);
    const [legacyRow] = buildCompletedSessionDetailModel([legacy], new Map()).cards[0].rows;
    expect(legacyRow).toMatchObject({ typeLabel: '—', weightReps: '82.5 × 8' });
  });

  it('leaves out an exercise with no confirmed valid set', () => {
    const model = buildCompletedSessionDetailModel(
      [{ ...bench, sets: [bench.sets[3], bench.sets[4]] }],
      new Map()
    );

    expect(model.cards).toEqual([]);
    expect(model.workingSetCount).toBe(0);
    expect(model.volume).toBe('0');
  });

  const flagged = (rows: { id: string; oneRepMaxRecord: boolean; weightRecord: boolean }[]) =>
    rows.flatMap(({ id, oneRepMaxRecord, weightRecord }) =>
      oneRepMaxRecord || weightRecord ? [{ id, oneRepMaxRecord, weightRecord }] : []);

  it('marks the record set when it beats every earlier session, and nothing otherwise', () => {
    const beaten = buildCompletedSessionDetailModel([bench], new Map([['bench-def', baseline(80, 120, 1)]])).cards[0];
    expect(beaten.record).toEqual([{
      key: 'b2', label: 'New 1RM record · 116.6', set: '100.0 × 5', spoken: 'new 1RM record 116.6 on 100.0 × 5',
    }]);
    expect(flagged(beaten.rows)).toEqual([{ id: 'b2', oneRepMaxRecord: true, weightRecord: false }]);

    const notBeaten = buildCompletedSessionDetailModel([bench], new Map([['bench-def', baseline(500, 120, 1)]])).cards[0];
    expect(notBeaten.record).toEqual([]);
    expect(flagged(notBeaten.rows)).toEqual([]);
  });

  it('adds the Volume record: the exercise\'s working volume against earlier sessions', () => {
    // 100×5 + 0×5; the warm-up adds no volume.
    const [card] = buildCompletedSessionDetailModel([bench], new Map([['bench-def', baseline(500, 500, 1, 400)]])).cards;
    expect(card.record).toEqual([{ key: 'volume', label: 'New volume record · 500', set: null, spoken: 'new volume record 500' }]);
    expect(flagged(card.rows)).toEqual([]);
  });

  it('marks a Weight record when no 1RM beats the record', () => {
    // As heavy as the record with more reps: a Weight record, not a 1RM one.
    const [card] = buildCompletedSessionDetailModel([bench], new Map([['bench-def', baseline(500, 100, 4)]])).cards;
    expect(flagged(card.rows)).toEqual([{ id: 'b2', oneRepMaxRecord: false, weightRecord: true }]);
    expect(card.record).toEqual([{ key: 'b2', label: 'New top weight', set: '100.0 × 5', spoken: 'new top weight 100.0 × 5' }]);
  });

  it('never marks a warm-up heavier than the working sets as the record', () => {
    const heavyWarmUp = { ...bench, sets: [{ id: 'w', weight: '200', reps: '5', setType: 'warm_up' }, bench.sets[1]] };

    const beaten = buildCompletedSessionDetailModel([heavyWarmUp], new Map([['bench-def', baseline(80, 90, 5)]])).cards[0];
    expect(beaten.rows[0]).toMatchObject({ typeLabel: 'W-Up', weightReps: '200.0 × 5', volume: '1000', oneRepMaxRecord: false, weightRecord: false });
    expect(flagged(beaten.rows)).toEqual([{ id: 'b2', oneRepMaxRecord: true, weightRecord: true }]);

    // Only the warm-up beats the other sessions: no record.
    const onlyWarmUpBeats = buildCompletedSessionDetailModel([heavyWarmUp], new Map([['bench-def', baseline(150, 150, 1)]])).cards[0];
    expect(onlyWarmUpBeats.record).toEqual([]);
    expect(flagged(onlyWarmUpBeats.rows)).toEqual([]);
  });

  it('shows no record without history, against a zero baseline, or for an exercise without a definition', () => {
    expect(buildCompletedSessionDetailModel([bench], new Map()).cards[0].record).toEqual([]);
    expect(buildCompletedSessionDetailModel([bench], new Map([['bench-def', baseline(0, 0, 9)]])).cards[0].record).toEqual([]);
    expect(buildCompletedSessionDetailModel([legacy], new Map()).cards[0].record).toEqual([]);
  });
});

describe('formatSetRow', () => {
  it('shows numeric zero volume and 1RM for a zero-weight set', () => {
    expect(formatSetRow({ id: 's', weight: 0, reps: 10, setType: 'rir_2', done: true })).toMatchObject({
      weightReps: '0.0 × 10',
      oneRepMax: '0.0',
      volume: '0',
    });
  });

  it('shows dashes for missing values', () => {
    expect(formatSetRow({ id: 's', weight: null, reps: null, setType: null, done: false })).toMatchObject({
      typeLabel: '—',
      weightReps: '— × —',
      oneRepMax: '—',
      volume: '—',
    });
  });
});
