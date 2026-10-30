/* eslint-disable import/first */
const mockRpc = jest.fn();
const mockHeader = jest.fn();
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({ schema: () => ({
  rpc: (...args: unknown[]) => { const result = mockRpc(...args); return Object.assign(result, {
    setHeader: (...header: unknown[]) => { mockHeader(...header); return result; },
  }); },
}) }) }));

import { getCoWResults, getCoWSummary, getPreviousCoWSummary, cancelCoW, createCoW, createGroup, getCoW, getCoWCalendar, listCoWs, setCoWCalendar, updateCoW } from '@/src/groups/api';
import { isCoWCalendarWire, isCoWDefinitionWire, isCoWListWire, isCoWWriteWire } from '@/src/groups/cow-wire';

import { cowResult, cowSummary, previousCowSummary } from './helpers/cow-fixtures';

const cow = { cow_id: 'c', group_id: 'g', group_exercise_id: 'e', week_start: '2026-11-02', time_zone: 'Europe/London',
  starts_at_us: 1793577600000000, ends_at_us: 1794182400000000, metrics: ['e1rm', 'volume'], revision: 1, state: 'scheduled' };
const calendar = { time_zone: 'Europe/London', revision: 1, next_week_start: '2026-11-02' };
beforeEach(() => { mockRpc.mockReset(); mockHeader.mockReset(); });
const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });

it.each([
  ['group_cow_calendar_get', () => getCoWCalendar('g'), { p_group_id: 'g' }, calendar],
  ['group_cow_calendar_set', () => setCoWCalendar('g', 1, 'UTC'),
    { p_group_id: 'g', p_expected_revision: 1, p_time_zone: 'UTC' }, calendar],
  ['group_cow_create', () => createCoW('g', { cowId: 'c', groupExerciseId: 'e', metrics: ['e1rm'], calendarRevision: 1, weekStart: '2026-11-02' }),
    { p_group_id: 'g', p_cow_id: 'c', p_group_exercise_id: 'e', p_metrics: ['e1rm'], p_calendar_revision: 1, p_week_start: '2026-11-02' }, { cow }],
  ['group_cow_update', () => updateCoW('g', 'c', { revision: 1, groupExerciseId: 'e', metrics: ['volume'] }),
    { p_group_id: 'g', p_cow_id: 'c', p_expected_revision: 1, p_group_exercise_id: 'e', p_metrics: ['volume'] }, { cow }],
  ['group_cow_cancel', () => cancelCoW('g', 'c', 1), { p_group_id: 'g', p_cow_id: 'c', p_expected_revision: 1 }, { cow }],
  ['group_cow_get', () => getCoW('g', 'c'), { p_group_id: 'g', p_cow_id: 'c' }, { cow }],
  ['group_cow_list', () => listCoWs('g'), { p_group_id: 'g', p_before: null, p_limit: 20 }, { cows: [cow], next_cursor: null }],
] as const)('%s uses request-local protocol headers and exact wire decoding', async (name, invoke, args, data) => {
  respond(data);
  expect(await invoke()).toEqual(data);
  expect(mockRpc).toHaveBeenCalledWith(name, args);
  expect(mockHeader.mock.calls).toEqual([['x-boga-group-contract', '4'], ['x-boga-group-set-metrics', '1']]);
});

it('passes opaque paging and retry identities unchanged; createGroup supplies its creator device zone', async () => {
  respond({ cows: [], next_cursor: 'opaque' });
  await listCoWs('g', 'opaque', 1);
  expect(mockRpc).toHaveBeenLastCalledWith('group_cow_list', { p_group_id: 'g', p_before: 'opaque', p_limit: 1 });
  respond({ group_id: 'g' });
  await createGroup({ name: 'Crew', description: null });
  expect(mockRpc).toHaveBeenLastCalledWith('group_create', { p_name: 'Crew', p_description: null, p_time_zone: 'Europe/London' });
  respond({ group_id: 'g' });
  await createGroup({ name: 'Crew', description: null, timeZone: 'America/New_York' });
  expect(mockRpc.mock.calls[2][1].p_time_zone).toBe('America/New_York');
});

it.each([null, [], {}, { cow: { ...cow, body_weight_kg: 80 } }, { cow, private: true },
  { cow: { ...cow, metrics: ['e1rm', 'e1rm'] } }, { cow: { ...cow, starts_at_us: Infinity } },
  { cow: { ...cow, ends_at_us: cow.starts_at_us } }, { cow: { ...cow, starts_at_us: 1.5 } },
  { cow: { ...cow, week_start: '2026-02-31' } }, { cow: { ...cow, time_zone: 'GMT+3' } },
  { cow: { ...cow, state: 'unknown' } }])('rejects malformed/private CoW responses %j', async value => {
  respond(value);
  await expect(getCoW('g', 'c')).rejects.toMatchObject({ code: 'INTERNAL', invalidPayload: true });
  expect(isCoWWriteWire(value)).toBe(false);
});

it('decodes absent legacy calendars, known states, calendar zones and list envelopes without private extensions', () => {
  expect(isCoWCalendarWire({ time_zone: null, revision: 1, next_week_start: null })).toBe(true);
  for (const state of ['scheduled', 'active', 'finalizing', 'final', 'unavailable', 'cancelled']) {
    expect(isCoWDefinitionWire({ ...cow, state })).toBe(true);
  }
  for (const patch of [{ time_zone: null }, { time_zone: 'Area/Invented' }, { revision: 0 }, { next_week_start: null }, { extra: true }]) {
    expect(isCoWCalendarWire({ ...calendar, ...patch })).toBe(false);
  }
  expect(isCoWListWire({ cows: [cow], next_cursor: 'opaque' })).toBe(true);
  expect(isCoWListWire({ cows: [cow], next_cursor: null, body_weight_kg: 80 })).toBe(false);
  expect(isCoWListWire({ cows: [{ ...cow, metrics: [] }], next_cursor: null })).toBe(false);
  expect(isCoWListWire({ cows: [], next_cursor: 4 })).toBe(false);
});

it('preserves server conflict and network errors without retrying mutations', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'CONFLICT: CoW changed' }, status: 400 });
  await expect(cancelCoW('g', 'c', 1)).rejects.toMatchObject({ code: 'CONFLICT' });
  mockRpc.mockRejectedValueOnce(new Error('offline'));
  await expect(setCoWCalendar('g', 1, 'UTC')).rejects.toMatchObject({ code: 'NETWORK' });
  expect(mockRpc).toHaveBeenCalledTimes(2);
});

it('rejects response identities from another group or CoW before a caller can cache them', async () => {
  respond({ cow: { ...cow, group_id: 'other-group' } });
  await expect(getCoW('g', 'c')).rejects.toMatchObject({ code: 'INTERNAL', invalidPayload: true });
  respond({ cow: { ...cow, cow_id: 'other-cow' } });
  await expect(cancelCoW('g', 'c', 1)).rejects.toMatchObject({ code: 'INTERNAL', invalidPayload: true });
  respond({ cows: [{ ...cow, group_id: 'other-group' }], next_cursor: null });
  await expect(listCoWs('g')).rejects.toMatchObject({ code: 'INTERNAL', invalidPayload: true });
});


it('reads scoped result pages and summaries through the same protocol and rejects crossed identities', async () => {
  const result = cowResult(); result.rankings = [result.rankings[0]];
  respond(result);
  expect(await getCoWResults('g1', 'cow1', 'e1rm', 'opaque', 2)).toEqual(result);
  expect(mockRpc).toHaveBeenLastCalledWith('group_cow_results', { p_group_id: 'g1', p_cow_id: 'cow1', p_metric: 'e1rm', p_before: 'opaque', p_limit: 2 });
  respond(cowSummary());
  expect(await getCoWSummary('g1')).toEqual(cowSummary());
  respond(result);
  await expect(getCoWResults('g1', 'cow2', 'e1rm')).rejects.toMatchObject({ invalidPayload: true });
  respond(result);
  await expect(getCoWResults('g1', 'cow1', 'volume')).rejects.toMatchObject({ invalidPayload: true });
  respond(cowSummary());
  await expect(getCoWSummary('g2')).rejects.toMatchObject({ invalidPayload: true });
});

it('reads last week independently and rejects a response for the other summary view', async () => {
  const previous = previousCowSummary();
  respond(previous);
  expect(await getPreviousCoWSummary('g1')).toEqual(previous);
  expect(mockRpc).toHaveBeenLastCalledWith('group_cow_previous_summary', { p_group_id: 'g1' });
  respond(previous);
  await expect(getPreviousCoWSummary('g2')).rejects.toMatchObject({ invalidPayload: true });
  respond(cowSummary());
  await expect(getPreviousCoWSummary('g1')).rejects.toMatchObject({ invalidPayload: true });
  respond({ ...previous, selection: 'previous_final' });
  await expect(getPreviousCoWSummary('g1')).rejects.toMatchObject({ invalidPayload: true });
  respond(previous);
  await expect(getCoWSummary('g1')).rejects.toMatchObject({ invalidPayload: true });
});
