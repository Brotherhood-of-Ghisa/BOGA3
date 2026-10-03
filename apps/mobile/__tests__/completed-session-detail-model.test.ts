import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

// View Session's model (`ux-rules` §7.4–§7.6): confirmed sets with valid
// values only, the session view's row, and the session view's record rule.

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

const legacy = {
  id: 'legacy',
  exerciseDefinitionId: null,
  name: 'Old Import',
  sets: [{ id: 'l1', weight: '82.5', reps: '8', setType: null }],
};

describe('buildCompletedSessionDetailModel', () => {
  it('keeps confirmed sets with valid values and totals them', () => {
    const model = buildCompletedSessionDetailModel([bench, legacy], new Map());

    expect(model.cards.map((card) => card.id)).toEqual(['bench', 'legacy']);
    expect(model.cards[0].setCount).toBe(3);
    expect(model.cards[0].rows.map((row) => row.id)).toEqual(['b1', 'b2', 'b-zero']);
    expect(model.cards[0].rows[2]).toMatchObject({ weightReps: '0.0 × 5', volume: '0', oneRepMax: '0.0' });
    expect(model.performedSetCount).toBe(4);
    // Working sets only: 100×5 + 0×5 + 82.5×8, rounded, no separator; the
    // 60×10 warm-up keeps its row and adds no volume.
    expect(model.volume).toBe('1160');
  });

  it('keeps a warm-up-only exercise card, with no volume', () => {
    const warmUpOnly = { ...bench, sets: [{ id: 'w', weight: '60', reps: '10', setType: 'warm_up' }] };
    const model = buildCompletedSessionDetailModel([warmUpOnly], new Map());
    expect(model.cards[0]).toMatchObject({ setCount: 1, rows: [expect.objectContaining({ id: 'w', volume: '600' })] });
    expect(model.performedSetCount).toBe(1);
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
    expect(model.performedSetCount).toBe(0);
    expect(model.volume).toBe('0');
  });

  it('marks the best set when it beats every earlier session, and nothing otherwise', () => {
    const beaten = buildCompletedSessionDetailModel([bench], new Map([['bench-def', 80]])).cards[0];
    expect(beaten.recordOneRepMax).toMatch(/^\d+\.\d$/);
    expect(beaten.rows.find((row) => row.oneRepMaxRecord)?.id).toBe('b2');

    const notBeaten = buildCompletedSessionDetailModel([bench], new Map([['bench-def', 500]])).cards[0];
    expect(notBeaten.recordOneRepMax).toBeNull();
    expect(notBeaten.rows.some((row) => row.oneRepMaxRecord)).toBe(false);
  });

  it('never marks a warm-up heavier than the working sets as the record', () => {
    const heavyWarmUp = { ...bench, sets: [{ id: 'w', weight: '200', reps: '5', setType: 'warm_up' }, bench.sets[1]] };

    const beaten = buildCompletedSessionDetailModel([heavyWarmUp], new Map([['bench-def', 80]])).cards[0];
    expect(beaten.rows[0]).toMatchObject({ typeLabel: 'W-Up', weightReps: '200.0 × 5', volume: '1000', oneRepMaxRecord: false });
    expect(beaten.rows.filter((row) => row.oneRepMaxRecord).map((row) => row.id)).toEqual(['b2']);

    // Only the warm-up beats the other sessions: no record.
    const onlyWarmUpBeats = buildCompletedSessionDetailModel([heavyWarmUp], new Map([['bench-def', 150]])).cards[0];
    expect(onlyWarmUpBeats.recordOneRepMax).toBeNull();
    expect(onlyWarmUpBeats.rows.some((row) => row.oneRepMaxRecord)).toBe(false);
  });

  it('shows no record without history, or for an exercise without a definition', () => {
    expect(buildCompletedSessionDetailModel([bench], new Map()).cards[0].recordOneRepMax).toBeNull();
    expect(buildCompletedSessionDetailModel([legacy], new Map()).cards[0].recordOneRepMax).toBeNull();
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
