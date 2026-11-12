import { buildRecordsLog, type RecordsLogEntry } from '@/src/groups/records-history-view-model';
import type { CompetitionEventWire, CompetitionHistoryValueWire, CompetitionRecordsHistoryItemWire } from '@/src/groups/competition-wire';
import { competitionEvent, competitionRow } from './helpers/competition-fixtures';

const me = { user_id: 'me', username: 'Me' };
const sam = { user_id: 'sam', username: 'Sam' };
const kg = (role: CompetitionHistoryValueWire['role'], value: number, member = me): CompetitionHistoryValueWire =>
  ({ role, metric: 'e1rm', unit: 'kg', value, unavailable: false, member });
const ordinary = { ...competitionRow.performance, visibility: 'ordinary' as const, weight_value: '100' };
const event = (overrides: Partial<CompetitionEventWire> = {}): CompetitionEventWire => ({ ...competitionEvent, visibility: 'ordinary',
  member: me, record_context: null, sort_at_ms: Date.UTC(2026, 10, 12), values: [kg('record', 120)], ...overrides });
const record = (overrides: Partial<CompetitionRecordsHistoryItemWire> = {}, groupRecord = false, previous: CompetitionHistoryValueWire[] = []) =>
  ({ event: event(), previous_best: null,
    record: { performance: ordinary, group_record_metrics: groupRecord ? ['e1rm' as const] : [], previous: previous.map(value => ({ value, performance: null })) },
    ...overrides });
const options = { metric: 'e1rm' as const, userId: 'me', currentRevision: 2, dateFormat: 'DD-MM-YYYY' as const };
const entries = (items: CompetitionRecordsHistoryItemWire[]) => buildRecordsLog(items, options) as RecordsLogEntry[];

describe('records log', () => {
  it('raising your own #1 reads as #1 with the gain on your best, not as taking it', () => {
    const [row] = entries([record({ previous_best: kg('previous', 115) }, true, [kg('previous', 115)])]);
    expect(row).toMatchObject({ mark: 'lead', title: 'You · #1', figure: '120.0', detail: '100.0 × 5 · +5.0 on best' });
  });
  it('a first #1 on an empty board takes it without passing anyone; a first entry says so', () => {
    expect(entries([record({}, true)])[0]).toMatchObject({ title: 'You took #1', detail: '100.0 × 5' });
    expect(entries([record()])[0]).toMatchObject({ mark: 'best', title: 'You', detail: '100.0 × 5 · first entry' });
  });
  it('draws no gain across units, from an unavailable figure or without a gain', () => {
    expect(entries([record({ previous_best: { ...kg('previous', 1), unit: 'percent_bw' } })])[0].detail).toBe('100.0 × 5');
    expect(entries([record({ previous_best: { ...kg('previous', 1), value: null, unavailable: true } })])[0].detail).toBe('100.0 × 5');
    expect(entries([record({ previous_best: kg('previous', 120) })])[0].detail).toBe('100.0 × 5');
  });
  it('marks an in-progress session and an unavailable figure', () => {
    const [row] = entries([record({ event: event({ provisional: true, values: [] }) })]);
    expect(row).toMatchObject({ figure: 'Score unavailable', date: '12-11-2026 · Session in progress' });
  });
  it('a Certified lead change names the new holder and who they passed', () => {
    const lead = { event: event({ kind: 'lead_change', certified: true, member: null,
      values: [kg('leader', 130, sam), kg('previous', 120, me)] }), record: null, previous_best: null };
    expect(entries([lead])[0]).toMatchObject({ mark: 'lead', title: 'Sam took #1', figure: '130.0', detail: 'passed you' });
    const kept = { ...lead, event: event({ kind: 'lead_change', certified: true, member: null,
      values: [kg('leader', 130, sam), kg('previous', 125, sam)] }) };
    expect(entries([kept])[0]).toMatchObject({ title: 'Sam · #1', detail: '' });
  });
  it('an All #1 no record explains names its cause: a link passes, an unlink or correction only hands on', () => {
    const lead = (reason: string, actor: typeof me) => ({ event: event({ kind: 'lead_change', certified: false, reason, member: actor,
      values: [kg('leader', 130, sam), kg('previous', 140, me)] }), record: null, previous_best: null });
    expect(entries([lead('link', sam)])[0]).toMatchObject({ mark: 'lead', title: 'Sam took #1', detail: 'linked sets · passed you' });
    expect(entries([lead('link', me)])[0]).toMatchObject({ title: 'Sam took #1', detail: 'you unlinked' });
    expect(entries([{ ...lead('link', { user_id: 'kim', username: 'Kim' }) }])[0].detail).toBe('Kim unlinked');
    expect(entries([lead('void', me)])[0]).toMatchObject({ title: 'Sam took #1', detail: 'record corrected' });
  });
  it('a Certified #1 never names an All cause', () => {
    const lead = { event: event({ kind: 'lead_change', certified: true, reason: 'link', member: me,
      values: [kg('leader', 130, sam), kg('previous', 120, me)] }), record: null, previous_best: null };
    expect(entries([lead])[0].detail).toBe('passed you');
  });
  it('splits entries into one card per run between rules changes, dimming earlier rules', () => {
    const rules = { event: event({ kind: 'rules_change', event_id: 'rc', values: [], sort_at_ms: Date.UTC(2026, 10, 3) }), record: null, previous_best: null };
    const rows = buildRecordsLog([record({ event: event({ event_id: 'a' }) }), record({ event: event({ event_id: 'b' }) }), rules,
      record({ event: event({ event_id: 'c', rules_revision: 1 }) })], options);
    expect(rows.map(row => row.kind === 'entry' ? [row.key, row.index, row.count, row.earlierRules] : [row.key, row.label])).toEqual([
      ['a', 0, 2, false], ['b', 1, 2, false], ['rc', 'Rules changed · 03-11-2026'], ['c', 0, 1, true]]);
  });
});
