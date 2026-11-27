/* eslint-disable import/first */
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: (...args: unknown[]) => {
  const result = mockRpc(...args); return Object.assign(result, { setHeader: () => result });
} }) }) }));
import * as api from '@/src/groups/api';
import { isMeetChallengeWire, isMeetDetailWire, isMeetListWire, isMeetStreamItemWire, isMeetWire } from '@/src/groups/meet-wire';
import { meetDetailFixture, meetFixture, meetStreamFixture } from './helpers/meet-fixtures';
const fields: api.MeetFields = { title: null, starts_at_ms: 1800000000000, ends_at_ms: 1800010800000, venue_name: 'Gym', address: null, latitude: null, longitude: null, entry_note: null };
const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });
beforeEach(() => mockRpc.mockReset());
it('sends exact fields, stable identities and expected versions for meet writes', async () => {
  respond({ meet: meetFixture() }); await api.createMeet('g1', 'm1', fields);
  expect(mockRpc).toHaveBeenLastCalledWith('group_meet_create', { p_group_id: 'g1', p_meet_id: 'm1', ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`p_${key}`, value])) });
  respond({ meet: meetFixture() }); await api.updateMeet('g1', 'm1', 3, fields);
  expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_expected_version: 3 });
  respond({ meet: meetFixture() }); await api.cancelMeet('g1', 'm1', 3);
  expect(mockRpc).toHaveBeenLastCalledWith('group_meet_cancel', { p_group_id: 'g1', p_meet_id: 'm1', p_expected_version: 3 });
});
it('decodes reads, opaque past cursors, roster and challenge writes', async () => {
  const detail = meetDetailFixture(); respond(detail); expect(await api.getMeet('g1', 'm1')).toEqual(detail);
  const list = { upcoming: [detail.meet], past: [], next_cursor: 'opaque' }; respond(list); expect(await api.listMeets('g1', 'opaque')).toEqual(list);
  expect(mockRpc).toHaveBeenLastCalledWith('group_meet_list', { p_group_id: 'g1', p_before: 'opaque', p_limit: 20 });
  for (const joined of [true, false]) { respond({ meet_id: 'm1', joined }); await api.setMeetJoined('g1', 'm1', joined); expect(mockRpc.mock.calls.at(-1)[0]).toBe(joined ? 'group_meet_join' : 'group_meet_leave'); }
  for (const version of [null, 2]) { respond({ challenge: detail.challenges[0] }); await api.saveMeetChallenge({ groupId: 'g1', meetId: 'm1', challengeId: 'c1', exerciseId: 'ge1', metric: 'e1rm', version });
    expect(mockRpc.mock.calls.at(-1)[0]).toBe(version === null ? 'group_meet_challenge_add' : 'group_meet_challenge_update'); }
  respond({ challenge_id: 'c1', removed: true }); await api.removeMeetChallenge('g1', 'm1', 'c1', 2);
  expect(mockRpc).toHaveBeenLastCalledWith('group_meet_challenge_remove', { p_group_id: 'g1', p_meet_id: 'm1', p_challenge_id: 'c1', p_expected_version: 2 });
});
it.each([null, {}, { ...meetFixture(), private: true }, { ...meetFixture(), latitude: 4 }, { ...meetFixture(), time_zone: 'Bogus/Zone' },
  { ...meetFixture(), cutoff_at_ms: 1 }, { ...meetFixture(), version: 0 }, { ...meetFixture(), starts_at_ms: Infinity }, { ...meetFixture(), state: 'cancelled' }])('rejects invalid or extended meet %j', value => expect(isMeetWire(value)).toBe(false));
it('guards nested scope and private fields before a read can enter cache', async () => {
  const detail = meetDetailFixture(); expect(isMeetDetailWire(detail)).toBe(true);
  expect(isMeetDetailWire({ ...detail, challenges: [{ ...detail.challenges[0], meet_id: 'other' }] })).toBe(false);
  expect(isMeetChallengeWire({ ...detail.challenges[0], metric: 'improvement' })).toBe(false);
  const row = detail.roster[0];
  const rosterOf = (r: object) => ({ ...detail, roster: [{ ...row, ...r }] });
  expect(isMeetDetailWire(rosterOf({ joined: false, joined_at_ms: null, linked: true }))).toBe(true);
  expect(isMeetDetailWire(rosterOf({ joined: false, joined_at_ms: 5 }))).toBe(false);
  expect(isMeetDetailWire(rosterOf({ joined: true, joined_at_ms: null }))).toBe(false);
  expect(isMeetDetailWire(rosterOf({ linked: 'yes' }))).toBe(false);
  expect(isMeetListWire({ upcoming: [detail.meet], past: [], next_cursor: null })).toBe(true);
  respond({ ...detail, meet: { ...detail.meet, group_id: 'other' } }); await expect(api.getMeet('g1', 'm1')).rejects.toMatchObject({ code: 'INTERNAL', invalidPayload: true });
  respond({ meet: { ...detail.meet, meet_id: 'other' } }); await expect(api.updateMeet('g1', 'm1', 1, fields)).rejects.toMatchObject({ code: 'INTERNAL' });
});
it.each(['scheduled', 'on', 'results', 'cancelled', 'results_refreshed', 'challenge_changed'] as const)('decodes stream %s and rejects private extensions', async event => {
  const item = meetStreamFixture(event); expect(isMeetStreamItemWire(item)).toBe(true);
  expect(isMeetStreamItemWire({ ...item, meet: { ...item.meet, entry_note: 'private extension' } })).toBe(false);
  const page = { contract_version: 4, items: [item], has_more: false, next_cursor: null }; respond(page);
  expect(await api.getCompetitionStream('g1')).toEqual(page); expect(mockRpc.mock.calls[0][0]).toBe('group_competition_stream_v7');
});
it('preserves conflict/duplicate tokens and does not retry a failed write', async () => {
  for (const token of ['CONFLICT', 'DUPLICATE']) { mockRpc.mockResolvedValueOnce({ data: null, error: { message: `${token}: changed` }, status: 400 });
    await expect(api.createMeet('g1', 'm1', fields)).rejects.toMatchObject({ code: token }); }
  expect(mockRpc).toHaveBeenCalledTimes(2);
});
