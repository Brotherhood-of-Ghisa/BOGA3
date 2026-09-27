import { compareReadingIds, createAsOfWeightResolver, type DatedWeightReading } from '@/src/bodyweight/as-of';
const reading = (id: string, at: number, kg = 80): DatedWeightReading => ({
  id, measuredAt: at, weightValue: String(kg), weightUnit: 'kg', weightKg: kg,
});

it('selects exact UTC instants and ascending binary IDs independently of input and edit order', () => {
  const rows = [reading('z', 2000, 90), reading('a', 2000, 85), reading('old', 1000), reading('future', 3000, 95)];
  for (const ordered of [rows, rows.slice().reverse()]) {
    const resolve = createAsOfWeightResolver(ordered);
    expect(resolve(999).bodyWeightKg).toBeNull();
    expect(resolve(1000).bodyWeightKg).toBe(80);
    expect(resolve(1999).bodyWeightKg).toBe(80);
    expect(resolve(new Date(2000))).toMatchObject({ bodyWeightKg: 85, bodyWeightMeasurementId: 'a' });
    expect(resolve(2999).bodyWeightKg).toBe(85);
    expect(resolve(3000).bodyWeightKg).toBe(95);
    expect(resolve(NaN).bodyWeightKg).toBeNull();
    expect(resolve(8640000000000001).bodyWeightKg).toBeNull();
  }
  expect(['\u{10000}', '\uE000', 'é', 'Z', 'a'].sort(compareReadingIds)).toEqual(['Z', 'a', 'é', '\uE000', '\u{10000}']);
});

it('does not borrow a later same-day reading across a DST transition', () => {
  const session = new Date('2026-10-25T01:30:00+01:00');
  const before = new Date('2026-10-25T01:15:00+01:00');
  const after = new Date('2026-10-25T01:15:00+00:00');
  const resolve = createAsOfWeightResolver([reading('before', +before, 80), reading('after', +after, 90)]);
  expect(resolve(session).bodyWeightMeasurementId).toBe('before');
  expect(resolve(new Date('2026-10-25T00:30:00Z'))).toEqual(resolve(session));
});

it.each([{ weightKg: 800 }, { weightValue: 'NaN' }, { weightUnit: 'stone' }, { weightKg: 0 }, { weightValue: '8e1' }])(
  'selects before validating and never falls back past malformed context %j', invalid => {
    const resolve = createAsOfWeightResolver([reading('old', 1000), { ...reading('latest', 2000), ...invalid }]);
    expect(resolve(2000)).toMatchObject({ bodyWeightKg: null, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'latest' });
  });

it('rebuilds the bounded intervals after an edit, move, tombstone, restoration and late backdated insert', () => {
  const rows = [reading('first', 1000), reading('middle', 2000, 85), reading('last', 4000, 90)];
  const resolve = () => [1500, 2500, 3500, 4500].map(at => createAsOfWeightResolver(rows)(at).bodyWeightKg);
  expect(resolve()).toEqual([80, 85, 85, 90]);
  Object.assign(rows[1], { weightValue: '86', weightKg: 86 });
  expect(resolve()).toEqual([80, 86, 86, 90]);
  rows[1].measuredAt = 3000;
  expect(resolve()).toEqual([80, 80, 86, 90]);
  rows[1].deletedAt = 5000;
  expect(resolve()).toEqual([80, 80, 80, 90]);
  rows[1].deletedAt = null;
  rows.push(reading('late-import', 2200, 82));
  expect(resolve()).toEqual([80, 82, 86, 90]);
});
