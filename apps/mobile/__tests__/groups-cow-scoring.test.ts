import { scoreCoW, type CoWMetric, type CoWParticipant, type CoWSetVersion,
  type CoWWindow } from '@/src/groups/cow-scoring';
import { scoreCompetitionPerformance } from '@/src/groups/competition-score';

const window: CoWWindow = { startUs: 100, endUs: 200, readBeforeUs: 300,
  context: { key: 'comparison:revision:scorer', normalized: false }, contextChangedAtUs: null };
const metrics: CoWMetric[] = ['e1rm', 'volume', 'improvement'];
const participants: CoWParticipant[] = [{ memberId: 'a', endedAtUs: null }, { memberId: 'b', endedAtUs: null }];
function source(patch: Partial<CoWSetVersion> = {}): CoWSetVersion {
  return { memberId: 'a', setId: 'set', version: 1, receivedAtUs: 120,
    contextKey: window.context!.key, sessionStartedAtUs: 110, completed: true, shared: true, eligible: true,
    scores: [{ metric: 'e1rm', value: 100, unit: 'kg' }, { metric: 'volume', value: 500, unit: 'kg_reps' }], ...patch };
}
const baseline = (patch: Partial<CoWSetVersion> = {}) => source({ setId: 'baseline', receivedAtUs: 90,
  sessionStartedAtUs: 80, ...patch });
function run(rows: CoWSetVersion[], patch: Partial<CoWWindow> = {}, roster = participants) {
  return scoreCoW({ ...window, ...patch }, metrics, roster, rows);
}
const ranking = (result: ReturnType<typeof run>, metric: CoWMetric) => result.rankings.find(row => row.metric === metric)!;
const values = (result: ReturnType<typeof run>, metric: CoWMetric) => ranking(result, metric).entries.map(row => row.value);

it('takes weekly max 1RM but sums each set across sessions and repeated exercise blocks exactly once', () => {
  const rows = [baseline(), source(), source({ setId: 'another-block', receivedAtUs: 130,
    scores: [{ metric: 'e1rm', value: 110, unit: 'kg' }, { metric: 'volume', value: 600, unit: 'kg_reps' }] }),
  source({ setId: 'another-session', receivedAtUs: 140, sessionStartedAtUs: 135 })];
  const result = run([...rows, rows[1], rows[2]]);
  expect(values(result, 'e1rm')).toEqual([110]);
  expect(values(result, 'volume')).toEqual([1600]);
  expect(values(result, 'improvement')[0]).toBeCloseTo(10, 12);
  expect(run([...rows].reverse())).toEqual(result);
});

it.each([{ shared: false }, { eligible: false }, { completed: false }, { scores: [] }])(
  'never uses an unshared/ineligible/incomplete/missing baseline %j or private-history fallback', patch => {
    const result = run([baseline(patch), source()]);
    expect(values(result, 'improvement')).toEqual([]);
    expect(values(result, 'e1rm')).toEqual([100]);
    expect(values(result, 'volume')).toEqual([500]);
  });

it('freezes the latest pre-start baseline and rejects historical uploads at/after start', () => {
  const old = baseline();
  const correction = baseline({ version: 2, receivedAtUs: 99,
    scores: [{ metric: 'e1rm', value: 200, unit: 'kg' }] });
  const late = baseline({ version: 3, receivedAtUs: 100,
    scores: [{ metric: 'e1rm', value: 400, unit: 'kg' }] });
  expect(values(run([old, correction, late, source()]), 'improvement')).toEqual([-50]);
  expect(values(run([baseline({ receivedAtUs: 100 }), source()]), 'improvement')).toEqual([]);
  expect(values(run([baseline({ receivedAtUs: 101 }), source()]), 'improvement')).toEqual([]);
});

it.each([{ shared: false }, { eligible: false }, { completed: false }, { scores: [] }])(
  'resolves pre-start removals before eligibility instead of resurrecting a baseline %j', patch => {
    const removal = baseline({ version: 2, receivedAtUs: 99, ...patch });
    expect(values(run([baseline(), removal, source()]), 'improvement')).toEqual([]);
    expect(values(run([baseline(), { ...removal, receivedAtUs: 100 }, source()]), 'improvement')).toEqual([0]);
  });

it('ranks signed negative and zero improvements normally; missing weekly results never fabricate zero', () => {
  const rows = [baseline(), source({ scores: [{ metric: 'e1rm', value: 95, unit: 'kg' }] }),
    baseline({ memberId: 'b' }), source({ memberId: 'b', scores: [{ metric: 'e1rm', value: 98, unit: 'kg' }] }),
    baseline({ memberId: 'c' }), source({ memberId: 'c' }), baseline({ memberId: 'd' })];
  const result = run(rows, {}, [...participants, { memberId: 'c', endedAtUs: null }, { memberId: 'd', endedAtUs: null }]);
  expect(ranking(result, 'improvement').entries.map(row => [row.memberId, row.rank])).toEqual([['c', 1], ['b', 2], ['a', 3]]);
  expect(values(result, 'improvement')[0]).toBe(0);
  expect(values(result, 'improvement')[1]).toBeCloseTo(-2);
  expect(values(result, 'improvement')[2]).toBeCloseTo(-5);
});

it('does not rank nonpositive attained scores or a zero baseline', () => {
  const zero = [{ metric: 'e1rm', value: 0, unit: 'kg' }, { metric: 'volume', value: -1, unit: 'kg_reps' }] as const;
  expect(run([baseline(), source({ scores: zero })]).rankings.every(row => !row.entries.length)).toBe(true);
  expect(values(run([baseline({ scores: zero }), source()]), 'improvement')).toEqual([]);
});

it.each([99, 200, 201])('places the entire completed session by its start, excluding %s', sessionStartedAtUs => {
  expect(values(run([source({ sessionStartedAtUs })]), 'e1rm')).toEqual([]);
});

it('includes exact start and excludes exact end/late completion, regardless of request or transaction start', () => {
  expect(values(run([source({ receivedAtUs: 100, sessionStartedAtUs: 100 })]), 'e1rm')).toEqual([100]);
  const pending = source({ receivedAtUs: 199, completed: false });
  const completed = source({ version: 2, receivedAtUs: 200 });
  expect(values(run([pending, completed]), 'e1rm')).toEqual([]);
  // The request began at 199; its last required dependency was accepted at 201.
  expect(values(run([source({ receivedAtUs: 201 })]), 'e1rm')).toEqual([]);
  expect(values(run([source({ receivedAtUs: 199 })]), 'e1rm')).toEqual([100]);
});

it('preserves source and link versions before the exclusive cutoff through delayed evaluation', () => {
  const old = source();
  const removed = source({ version: 2, receivedAtUs: 199, shared: false });
  expect(values(run([old, removed]), 'e1rm')).toEqual([]);
  expect(values(run([old, { ...removed, receivedAtUs: 200 }]), 'e1rm')).toEqual([100]);
  const unlinked = source({ eligible: false });
  expect(values(run([unlinked, source({ version: 2, receivedAtUs: 200 })]), 'volume')).toEqual([]);
  expect(run([old], { readBeforeUs: 201 })).toEqual(run([old], { readBeforeUs: 900 }));
});

it('fixes the roster at start; leave freezes results and a rejoin cannot resume contributions', () => {
  const roster = [{ memberId: 'a', endedAtUs: 150 }];
  const lateEdit = source({ version: 2, receivedAtUs: 150, eligible: false });
  const outsider = source({ memberId: 'joined-midweek', receivedAtUs: 140 });
  const rejoined = source({ setId: 'after-rejoin', receivedAtUs: 160 });
  expect(values(run([source(), lateEdit, outsider, rejoined], {}, roster), 'volume')).toEqual([500]);
  expect(values(run([source({ completed: false }), source({ version: 2, receivedAtUs: 150 })], {}, roster), 'volume')).toEqual([]);
  expect(values(run([source(), { ...lateEdit, receivedAtUs: 149 }], {}, roster), 'volume')).toEqual([]);
});

it('orders equal scores by receipt, despite opposite performed/client/worker ordering, then UUID', () => {
  const rows = [baseline(), baseline({ memberId: 'b' }), source({ receivedAtUs: 130, sessionStartedAtUs: 100 }),
    source({ memberId: 'b', receivedAtUs: 120, sessionStartedAtUs: 115 })];
  for (const metric of metrics) expect(ranking(run(rows), metric).entries.map(row => row.memberId)).toEqual(['b', 'a']);
  for (const metric of metrics) expect(ranking(run(rows.map(row => ({ ...row, receivedAtUs: row.receivedAtUs === 130 ? 120 : row.receivedAtUs }))), metric)
    .entries.map(row => [row.memberId, row.rank])).toEqual([['a', 1], ['b', 2]]);
});

it('retains retry priority but advances a scoring-input revision even when its numeric score is identical', () => {
  const a = source();
  const b = source({ memberId: 'b', receivedAtUs: 125 });
  expect(ranking(run([a, b, { ...a }]), 'e1rm').entries.map(row => row.memberId)).toEqual(['a', 'b']);
  const { scores, ...rest } = a;
  expect(run([a, { scores: [...scores].reverse(), ...rest }])).toEqual(run([a]));
  const revised = source({ version: 2, receivedAtUs: 130 });
  expect(ranking(run([a, b, revised]), 'e1rm').entries.map(row => row.memberId)).toEqual(['b', 'a']);
  expect(ranking(run([a, b, revised]), 'volume').entries.map(row => row.memberId)).toEqual(['b', 'a']);
  expect(() => run([a, { ...a, receivedAtUs: 130 }])).toThrow('Conflicting CoW intake version');
});

it('uses the earliest currently qualifying winning set receipt, including completion/link eligibility', () => {
  const rows = [source(), source({ setId: 'second-best', receivedAtUs: 125 }),
    source({ version: 2, receivedAtUs: 130, eligible: false })];
  expect(ranking(run(rows), 'e1rm').entries[0].receivedAtUs).toBe(125);
  const pending = source({ completed: false, eligible: false });
  expect(ranking(run([pending, source({ version: 2, receivedAtUs: 140 })]), 'e1rm').entries[0].receivedAtUs).toBe(140);
});

it('advances Volume aggregate receipt on a removal, even when the old winning set remains unchanged', () => {
  const extra = source({ setId: 'extra', receivedAtUs: 130 });
  const rows = [source(), extra, source({ setId: 'extra', version: 2, receivedAtUs: 150, eligible: false }),
    source({ memberId: 'b', receivedAtUs: 140 })];
  expect(ranking(run(rows), 'volume').entries.map(row => [row.memberId, row.receivedAtUs])).toEqual([['b', 140], ['a', 150]]);
  expect(ranking(run(rows), 'e1rm').entries.map(row => [row.memberId, row.receivedAtUs])).toEqual([['a', 120], ['b', 140]]);
});

it('isolates non-finite sums and percentages to the affected member and metric, without a partial total', () => {
  const huge = source({ scores: [{ metric: 'e1rm', value: 100, unit: 'kg' }, { metric: 'volume', value: Number.MAX_VALUE, unit: 'kg_reps' }] });
  const result = run([baseline(), huge, { ...huge, setId: 'extra' }, source({ memberId: 'b' })]);
  expect(ranking(result, 'volume').unavailableMemberIds).toEqual(['a']);
  expect(values(result, 'volume')).toEqual([500]);
  expect(values(result, 'e1rm')).toEqual([100, 100]);
  const overflow = run([baseline({ scores: [{ metric: 'e1rm', value: Number.MIN_VALUE, unit: 'kg' }] }), source()]);
  expect(ranking(overflow, 'improvement').unavailableMemberIds).toEqual(['a']);
  expect(values(overflow, 'e1rm')).toEqual([100]);
});

it.each([Infinity, NaN, -Infinity])('never ranks a non-finite per-set metric %s or substitutes a partial best', value => {
  const result = run([baseline(), source({ scores: [{ metric: 'e1rm', value, unit: 'kg' }] }),
    source({ setId: 'valid-alternative' })]);
  expect(ranking(result, 'e1rm').unavailableMemberIds).toEqual(['a']);
  expect(ranking(result, 'improvement').unavailableMemberIds).toEqual(['a']);
  expect(values(result, 'volume')).toEqual([500]);
});

it.each([false, true])('aggregates the existing scorer with ordinary/normalized units (%s), without raw/private output', normalized => {
  const rules = { name: 'Pull-up', loadInputMode: 'total_load' as const, defaultMetric: 'e1rm' as const,
    bodyweightCalculationsEnabled: normalized, bodyweightContribution: 1 };
  const scores = scoreCompetitionPerformance({ live: true, weightValue: '20', repsValue: '5', performanceStatus: null,
    source: { loadInputMode: 'total_load' }, bodyWeightKg: 80, bodyWeightMeasurementId: 'private-reading',
    bodyWeightMeasuredAt: new Date(0), bodyWeightSource: 'reading' }, rules);
  const result = run([baseline({ scores }), source({ scores }), source({ setId: 'next', scores })],
    { context: { key: window.context!.key, normalized } });
  expect(result.rankings.map(row => row.unit)).toEqual(normalized ? ['percent_bw', 'percent_bw_reps', 'percent'] : ['kg', 'kg_reps', 'percent']);
  expect(values(result, 'volume')).toEqual([scores[0].value * 2]);
  expect(values(result, 'e1rm')).toEqual([scores[1].value]);
  expect(values(result, 'improvement')).toEqual([0]);
  expect(Object.keys(ranking(result, 'e1rm').entries[0]).sort()).toEqual(['memberId', 'rank', 'receivedAtUs', 'sourceSetIds', 'value']);
  expect(JSON.stringify(result)).not.toContain('private-reading');
});

it('compares full precision rather than rounded display values', () => {
  const result = run([source(), source({ memberId: 'b', receivedAtUs: 130,
    scores: [{ metric: 'e1rm', value: 100.0000000001, unit: 'kg' }] })]);
  expect(ranking(result, 'e1rm').entries.map(row => row.memberId)).toEqual(['b', 'a']);
});

it.each([
  ['2026-03-23T00:00:00Z', '2026-03-29T23:00:00Z', 167],
  ['2026-10-18T23:00:00Z', '2026-10-26T00:00:00Z', 169],
])('uses immutable London Monday bounds across DST: %s', (start, end, hours) => {
  const startUs = Date.parse(start) * 1000;
  const endUs = Date.parse(end) * 1000;
  expect((endUs - startUs) / 3_600_000_000).toBe(hours);
  const row = source({ receivedAtUs: endUs - 1, sessionStartedAtUs: startUs });
  expect(values(run([row], { startUs, endUs, readBeforeUs: endUs + 1 }), 'e1rm')).toEqual([100]);
  expect(values(run([{ ...row, receivedAtUs: endUs }], { startUs, endUs, readBeforeUs: endUs + 1 }), 'e1rm')).toEqual([]);
});

it('honours live read fences and only in-week context changes, keeping delayed finals stable', () => {
  expect(values(run([source()], { readBeforeUs: 120 }), 'e1rm')).toEqual([]);
  expect(run([source()], { context: null }).state).toBe('unavailable');
  for (const contextChangedAtUs of [100, 150, 199]) expect(run([source()], { contextChangedAtUs })).toEqual({ state: 'unavailable', rankings: [] });
  for (const contextChangedAtUs of [99, 200, 250]) expect(run([source()], { contextChangedAtUs }).state).toBe('ready');
  expect(run([source()], { readBeforeUs: 130, contextChangedAtUs: 150 }).state).toBe('ready');
  const lateContext = source({ version: 2, receivedAtUs: 200, contextKey: 'changed-later' });
  expect(run([source(), lateContext], { contextChangedAtUs: 200 })).toEqual(run([source()]));
  expect(run([source(), { ...lateContext, receivedAtUs: 150 }], {}, [{ memberId: 'a', endedAtUs: 150 }])).toEqual(
    run([source()], {}, [{ memberId: 'a', endedAtUs: 150 }]));
});

it('fails closed on mixed contexts/units, duplicate participants, and malformed internal boundaries', () => {
  expect(() => run([source({ contextKey: 'other' })])).toThrow('Invalid CoW source context');
  expect(() => run([source({ scores: [{ metric: 'e1rm', value: 100, unit: 'percent_bw' }] })])).toThrow();
  expect(() => run([source({ scores: [source().scores[0], source().scores[0]] })])).toThrow();
  expect(() => run([source({ receivedAtUs: 120.5 })])).toThrow();
  expect(() => run([source({ version: 0 })])).toThrow();
  expect(() => run([], { endUs: 100 })).toThrow();
  expect(() => scoreCoW(window, [], participants, [])).toThrow();
  expect(() => scoreCoW(window, ['volume', 'volume'], participants, [])).toThrow();
  expect(() => run([], {}, [participants[0], participants[0]])).toThrow();
  expect(() => run([], {}, [{ memberId: 'a', endedAtUs: 99 }])).toThrow();
});
