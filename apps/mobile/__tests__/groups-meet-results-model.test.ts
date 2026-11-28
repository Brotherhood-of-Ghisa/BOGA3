/* eslint-disable import/first */
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: (...args: unknown[]) => {
  const result = mockRpc(...args); return Object.assign(result, { setHeader: () => result });
} }) }) }));
import * as api from '@/src/groups/api';
import { isCompetitionCachePayload } from '@/src/groups/competition-cache-guards';
import { groupCacheKeys } from '@/src/groups/cache';
import { buildMeetLeaderboard, buildMeetRecordRows, buildMeetSessionRows, buildMeetStandingRows, meetResultsCaption, meetResultsRefreshMessage,
  meetSetFigure, splitMeetStandings } from '@/src/groups/meet-results-view-model';
import { GROUP_OFFLINE_ACTION_MESSAGE } from '@/src/groups/use-group-action';
import { isMeetLeaderboardWire, isMeetResultsWire, isMeetTrophiesWire } from '@/src/groups/meet-results-wire';
import { isTodayMeet, pickTodayMeet, TODAY_MEET_WINDOW_MS } from '@/src/groups/meet-today';
import { meetPermissions } from '@/src/groups/meet-presentation';
import { leaderboardFixture, meetFixture, meetResultsFixture, standingFixture, trophiesFixture } from './helpers/meet-fixtures';

const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });
beforeEach(() => mockRpc.mockReset());

describe('results captions', () => {
  const caption = (state: Parameters<typeof meetResultsFixture>[0]) => meetResultsCaption(meetResultsFixture(state), 'dd/mm/yyyy' as never);
  it.each([['scheduled', 'Scheduled'], ['live', 'Live'], ['final', 'Final'], ['cancelled', 'Cancelled']] as const)('%s reads %s', (state, label) => {
    expect(caption({ state })).toBe(label);
  });
  it('names the final time while standings are so far, and the refresh time once refreshed', () => {
    expect(caption({ state: 'so_far' })).toMatch(/^Standings so far · final at .*\d\d:\d\d$/);
    expect(caption({ state: 'refreshed', refreshed_at_ms: 1800200000000, refreshed_by: { user_id: 'u1', username: 'Alex' } })).toMatch(/^Results refreshed .*\d\d:\d\d$/);
    expect(caption({ state: 'refreshed' })).toBe('Results refreshed');
  });
});

describe('standing rows', () => {
  const results = meetResultsFixture();
  const rows = buildMeetStandingRows(results, results.challenges[0].standings, 'e1rm', 'u1', 'dd/mm/yyyy' as never);
  it('keeps server places, ties sharing a place, and marks a former member', () => {
    expect(rows.map(r => [r.rank, r.memberLabel])).toEqual([[1, 'You'], [2, 'Blake'], [2, 'Casey'], [4, 'Dana (former)']]);
    expect(rows.map(r => r.valueLabel)).toEqual(['142.5', '130.0', '130.0', '100.0']);
  });
  it('marks only certified sets, with the set behind the score and its session date', () => {
    expect(rows.map(r => r.certification)).toEqual(['certified', null, null, null]);
    expect(rows[0].detailLabel).toBe('140.0 × 1');
    expect(rows[0].dateLabel).not.toBe(''); expect(rows[0].accessibilityLabel).toContain('certified');
  });
  it('splits the podium (places 1–3, ties together) from the rest', () => {
    const split = splitMeetStandings(rows);
    expect(split.podium.map(r => r.rank)).toEqual([1, 2, 2]); expect(split.rest.map(r => r.rank)).toEqual([4]);
  });
  it('shows a hidden figure as unavailable with the place kept and the load withheld', () => {
    const hidden = standingFixture({ value: null, unavailable: true, set: { set_id: 's', session_id: 'zz', recording_mode: 'reps', reps_value: '5', duration_sec: null, weight_value: null } });
    const [row] = buildMeetStandingRows(results, [hidden], 'e1rm', 'u9', 'dd/mm/yyyy' as never);
    expect(row).toMatchObject({ rank: 1, valueLabel: 'Unavailable', detailLabel: '5 reps', dateLabel: '' });
  });
  it.each([
    [{ unit: 'reps' as const, value: 12 }, '12 reps'], [{ unit: 'seconds' as const, value: 45 }, '45 s'],
    [{ unit: 'percent_bw' as const, value: 120 }, '120.0 %BW'],
  ])('formats %j as %s', (patch, label) => {
    expect(buildMeetStandingRows(results, [standingFixture(patch)], 'e1rm', 'u9', 'dd/mm/yyyy' as never)[0].valueLabel).toBe(label);
  });
  it('describes weighted, bodyweight and hold sets', () => {
    expect(meetSetFigure({ set_id: 'a', session_id: 'b', recording_mode: 'hold', reps_value: null, duration_sec: 30, weight_value: '20' })).toBe('20.0 × 30 s');
    expect(meetSetFigure({ set_id: 'a', session_id: 'b', recording_mode: 'hold', reps_value: null, duration_sec: 30, weight_value: null })).toBe('30 s');
    expect(meetSetFigure({ set_id: 'a', session_id: 'b', recording_mode: 'reps', reps_value: '8', duration_sec: null, weight_value: ' ' })).toBe('8 reps');
    expect(meetSetFigure({ set_id: 'a', session_id: 'b', recording_mode: 'reps', reps_value: null, duration_sec: null, weight_value: null })).toBe('0 reps');
  });
});

describe('sessions and records', () => {
  const results = meetResultsFixture();
  it('lists each counting session with its member and a link target', () => {
    const rows = buildMeetSessionRows(results, 'dd/mm/yyyy' as never, 'u1');
    expect(rows.map(r => [r.memberUserId, r.sessionId])).toEqual([['u1', 'x-u1'], ['u2', 'x-u2']]);
    expect(rows[0].label).toMatch(/^You · /);
  });
  it('lists records with their figures, hiding kg that is withheld', () => {
    expect(buildMeetRecordRows(results, 'u9')[0]).toMatchObject({ title: 'Squat · Alex', figures: '1RM 142.5' });
    const hidden = { ...results, records: [{ ...results.records[0], boards: [{ metric: 'volume', unit: 'kg_reps', value: null, unavailable: true }] }] };
    expect(buildMeetRecordRows(hidden, 'u9')[0].figures).toBe('Volume Unavailable');
  });
});

describe('leaderboard', () => {
  it('keeps the server order and shared ranks, marking former members and me', () => {
    const board = buildMeetLeaderboard(leaderboardFixture(), 'u2');
    expect(board.rows.map(r => [r.rank, r.name, r.former])).toEqual([[1, 'Alex', false], [2, 'Blake', false], [2, 'Casey', false], [4, 'Dana', true]]);
    expect(board.me?.userId).toBe('u2'); expect(board.rows[3].memberLabel).toBe('Dana (former)');
    expect(board.rows[0].accessibilityLabel).toBe('1st, Alex, Gold 2, Silver 0, Bronze 1');
  });
  it('has no me when the viewer holds no trophy', () => expect(buildMeetLeaderboard(leaderboardFixture(), 'u9').me).toBeNull());
});

describe('refresh visibility and messages', () => {
  const meet = meetFixture(); const cutoff = meet.cutoff_at_ms;
  it('offers Refresh results to managers only from the cutoff', () => {
    expect(meetPermissions(meet, 'owner', meet.ends_at_ms + 1).refreshResults).toBe(false);
    expect(meetPermissions(meet, 'owner', cutoff - 1).refreshResults).toBe(false);
    expect(meetPermissions(meet, 'owner', cutoff).refreshResults).toBe(true);
    expect(meetPermissions(meet, 'admin', cutoff + 1).refreshResults).toBe(true);
    expect(meetPermissions(meet, 'member', cutoff + 1).refreshResults).toBe(false);
    expect(meetPermissions(meetFixture({ cancelled_at_ms: 1, state: 'cancelled' }), 'owner', cutoff + 1).refreshResults).toBe(false);
  });
  it('words its refusals', () => {
    expect(meetResultsRefreshMessage('NETWORK', true)).toBe(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(meetResultsRefreshMessage('CONFLICT', false)).toMatch(/not ready/);
    expect(meetResultsRefreshMessage('FORBIDDEN', false)).toMatch(/can't refresh/);
    expect(meetResultsRefreshMessage('INTERNAL', false)).toMatch(/Couldn't refresh/);
  });
});

describe('Today meet selection', () => {
  const week = TODAY_MEET_WINDOW_MS; const at = 1_800_000_000_000;
  const meet = (id: string, starts: number, patch = {}) => meetFixture({ meet_id: id, starts_at_ms: starts, ends_at_ms: starts + 3 * 3600_000, cutoff_at_ms: starts + 27 * 3600_000, ...patch });
  it('opens exactly 7 days before the start and closes exactly 7 days after the end', () => {
    const m = meet('a', at);
    expect(isTodayMeet(m, at - week - 1)).toBe(false); expect(isTodayMeet(m, at - week)).toBe(true);
    expect(isTodayMeet(m, m.ends_at_ms + week)).toBe(true); expect(isTodayMeet(m, m.ends_at_ms + week + 1)).toBe(false);
  });
  it('hides a cancelled meet', () => expect(isTodayMeet(meet('a', at, { cancelled_at_ms: 1, state: 'cancelled' }), at)).toBe(false));
  it('prefers the live meet, then the nearest, upcoming before past at a tie', () => {
    const live = meet('live', at - 3600_000); const soon = meet('soon', at + 3600_000); const past = meet('past', at - 5 * 24 * 3600_000);
    expect(pickTodayMeet({ upcoming: [soon, live], past: [past], next_cursor: null }, at)?.meet_id).toBe('live');
    expect(pickTodayMeet({ upcoming: [meet('far', at + 5 * 24 * 3600_000)], past: [past], next_cursor: null }, at)?.meet_id).toBe('past');
    const before = meet('before', at + 3600_000); const after = meet('after', at - 3600_000 - 3 * 3600_000);
    expect(pickTodayMeet({ upcoming: [before], past: [after], next_cursor: null }, at)?.meet_id).toBe('before');
    expect(pickTodayMeet({ upcoming: [meet('b', at + 3600_000), meet('a', at + 3600_000)], past: [], next_cursor: null }, at)?.meet_id).toBe('a');
    expect(pickTodayMeet({ upcoming: [meet('late', at + 8 * 24 * 3600_000)], past: [], next_cursor: null }, at)).toBeNull();
  });
});

describe('wire guards and RPCs', () => {
  it('accepts the closed shapes and rejects extra, missing or inconsistent fields', () => {
    expect(isMeetResultsWire(meetResultsFixture())).toBe(true); expect(isMeetLeaderboardWire(leaderboardFixture())).toBe(true);
    expect(isMeetTrophiesWire(trophiesFixture('c'))).toBe(true);
    const base = meetResultsFixture();
    for (const bad of [null, { ...base, extra: 1 }, { ...base, results: { ...base.results, state: 'bogus' } },
      { ...base, challenges: [{ ...base.challenges[0], standings: [{ ...base.challenges[0].standings[0], value: null }] }] },
      { ...base, challenges: [{ ...base.challenges[0], standings: [{ ...base.challenges[0].standings[0], unit: 'lb' }] }] },
      { ...base, challenges: [base.challenges[0], base.challenges[0]] }, { ...base, sessions: [{ session_id: 'x' }] }, { ...base, records: [{}] }]) {
      expect(isMeetResultsWire(bad)).toBe(false);
    }
    expect(isMeetLeaderboardWire({ rows: [{ rank: 0 }] })).toBe(false);
    expect(isMeetTrophiesWire({ trophies: [{ ...trophiesFixture().trophies[0], place: 4 }], next_cursor: null })).toBe(false);
    expect(isMeetTrophiesWire({ trophies: [], next_cursor: '' })).toBe(false);
    expect(isMeetTrophiesWire({ trophies: [{ ...trophiesFixture().trophies[0], place: '1' }], next_cursor: null })).toBe(false);
    expect(isMeetResultsWire({ ...base, results: { ...base.results, state: ['live'] } })).toBe(false);
  });
  it('calls the readers and Refresh with their exact arguments and matches the target', async () => {
    respond(meetResultsFixture()); await api.getMeetResults('g1', 'm1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_meet_results', { p_group_id: 'g1', p_meet_id: 'm1' });
    respond(meetResultsFixture()); await api.refreshMeetResults('g1', 'm1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_meet_refresh_results', { p_group_id: 'g1', p_meet_id: 'm1' });
    respond(leaderboardFixture()); await api.getMeetLeaderboard('g1');
    expect(mockRpc).toHaveBeenLastCalledWith('group_meet_leaderboard', { p_group_id: 'g1' });
    respond(trophiesFixture('n')); await api.listMeetTrophies('g1', 'u1', 'cursor');
    expect(mockRpc).toHaveBeenLastCalledWith('group_meet_trophies', { p_group_id: 'g1', p_member_user_id: 'u1', p_before: 'cursor', p_limit: 20 });
    respond(meetResultsFixture({}, meetFixture({ meet_id: 'other' }))); await expect(api.getMeetResults('g1', 'm1')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('caches only the leaderboard, under its own key', () => {
    const key = groupCacheKeys.meetLeaderboard('g1');
    expect(isCompetitionCachePayload(key, leaderboardFixture())).toBe(true);
    expect(isCompetitionCachePayload(key, { rows: [{}] })).toBe(false);
    expect(isCompetitionCachePayload('meet-leaderboard:v10:g1:v1:extra', leaderboardFixture())).toBe(false);
    expect(isCompetitionCachePayload('meet-results:v10:g1:m1:v1', meetResultsFixture())).toBe(false);
  });
});
