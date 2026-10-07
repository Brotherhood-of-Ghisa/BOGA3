import {
  beatsRecord,
  beatsWeightRecord,
  compareWeightRecord,
  createRecordBook,
  sessionRecordKinds,
  type RecordEntry,
} from '@/src/exercise-calculations/records';

// The one record definition (training-metrics-contract §3).
describe('what beats a record', () => {
  it('needs a strictly higher positive 1RM or Volume, against a positive record', () => {
    expect(beatsRecord(101, 100)).toBe(true);
    expect(beatsRecord(100, 100)).toBe(false);
    expect(beatsRecord(99, 100)).toBe(false);
    expect(beatsRecord(100, null)).toBe(false); // the first value is the baseline
    expect(beatsRecord(5, 0)).toBe(false); // a zero is no record to beat
    expect(beatsRecord(0, null)).toBe(false);
    expect(beatsRecord(Number.POSITIVE_INFINITY, 100)).toBe(false);
  });

  it('orders a Weight by kg, then reps', () => {
    const record = { weight: 100, reps: 5 };
    expect(beatsWeightRecord({ weight: 102.5, reps: 1 }, record)).toBe(true);
    expect(beatsWeightRecord({ weight: 100, reps: 6 }, record)).toBe(true);
    expect(beatsWeightRecord({ weight: 100, reps: 5 }, record)).toBe(false);
    expect(beatsWeightRecord({ weight: 97.5, reps: 20 }, record)).toBe(false);
    expect(beatsWeightRecord({ weight: 0, reps: 30 }, { weight: 0, reps: 10 })).toBe(false);
    expect(beatsWeightRecord({ weight: 20, reps: 5 }, { weight: 0, reps: 10 })).toBe(false);
  });
});

describe('the record book', () => {
  const entry = (oneRepMax: number | null, weight: [number, number] | null, volume: number | null): RecordEntry => ({
    oneRepMax: oneRepMax === null ? null : { value: oneRepMax },
    weight: weight === null ? null : { weight: weight[0], reps: weight[1] },
    volume: volume === null ? null : { value: volume },
  });

  it('takes the first value as the baseline, keeps the earliest of a tie, and ignores zeros', () => {
    const book = createRecordBook();
    expect(book.add(entry(0, [0, 12], 0))).toEqual({ oneRepMax: false, weight: false, volume: false });
    expect(book.holders).toEqual({ oneRepMax: null, weight: null, volume: null });

    expect(book.add(entry(100, [90, 5], 1000))).toEqual({ oneRepMax: false, weight: false, volume: false });
    const first = book.holders;
    expect(book.add(entry(100, [90, 5], 1000))).toEqual({ oneRepMax: false, weight: false, volume: false });
    expect(book.holders.oneRepMax).toBe(first.oneRepMax);

    expect(book.add(entry(101, [90, 6], null))).toEqual({ oneRepMax: true, weight: true, volume: false });
    expect(book.holders.weight).toEqual({ weight: 90, reps: 6 });
    expect(book.holders.volume).toEqual({ value: 1000 });
  });

  it('holds the earliest maximum of every record, as the rule states it, on any history', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T,>(values: T[]) => values[Math.floor(random() * values.length)];
    for (let run = 0; run < 200; run += 1) {
      const history = Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
        entry(pick([null, 0, 80, 100, 120]), pick([null, [0, 10], [80, 5], [80, 8], [100, 3]] as const) as
          [number, number] | null, pick([null, 0, 500, 900])));
      const book = createRecordBook();
      const flags = history.map((value) => book.add(value));

      // The rule restated: each record is the first positive maximum, and a
      // session sets it when it beats every earlier positive value.
      const oneRepMaxes = history.map((value) => value.oneRepMax?.value ?? 0);
      const weights = history.map((value) => value.weight);
      history.forEach((_, index) => {
        const earlier = oneRepMaxes.slice(0, index).filter((value) => value > 0);
        expect(flags[index].oneRepMax).toBe(earlier.length > 0 && oneRepMaxes[index] > Math.max(...earlier));
        const earlierWeights = weights.slice(0, index).filter((value) => value !== null && value.weight > 0);
        const weight = weights[index];
        expect(flags[index].weight).toBe(earlierWeights.length > 0 && weight !== null && weight.weight > 0 &&
          earlierWeights.every((value) => compareWeightRecord(weight, value!) > 0));
      });
      const top = Math.max(0, ...oneRepMaxes);
      expect(book.holders.oneRepMax).toBe(top > 0 ? history[oneRepMaxes.indexOf(top)].oneRepMax : null);
    }
  });
});

describe("a session's PRs", () => {
  it('counts one per record kind an exercise took, so one exercise adds up to three', () => {
    expect(sessionRecordKinds({ oneRepMax: false, weight: false, volume: false })).toEqual([]);
    expect(sessionRecordKinds({ oneRepMax: true, weight: false, volume: false })).toEqual(['oneRepMax']);
    expect(sessionRecordKinds({ oneRepMax: true, weight: true, volume: false })).toEqual(['oneRepMax', 'weight']);
    expect(sessionRecordKinds({ oneRepMax: false, weight: false, volume: true })).toEqual(['volume']);
    expect(sessionRecordKinds({ oneRepMax: true, weight: true, volume: true })).toEqual(['oneRepMax', 'weight', 'volume']);
  });

  it('counts the kinds the record book returns for a session', () => {
    const book = createRecordBook<RecordEntry>();
    book.add({ oneRepMax: { value: 100 }, weight: { weight: 90, reps: 5 }, volume: { value: 1000 } });
    expect(sessionRecordKinds(book.add({ oneRepMax: { value: 105 }, weight: { weight: 95, reps: 5 }, volume: { value: 1200 } })))
      .toHaveLength(3);
  });
});
