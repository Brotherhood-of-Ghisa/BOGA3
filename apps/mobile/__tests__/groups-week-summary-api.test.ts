/* eslint-disable import/first */

/**
 * The group week summary read (groups contract): `getGroupWeekSummary`
 * sends the caller's window, passes a well-formed payload through, rejects a malformed one as INTERNAL,
 * and maps server tokens and transport failures. Supabase is mocked; the wire
 * itself is proven by groups-api-live.
 */

const mockGetRequiredSupabaseMobileClient = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredSupabaseMobileClient(),
}));

import { GroupApiError, getGroupWeekSummary, type GroupErrorCode, type GroupWeekSummaryResult } from '@/src/groups';

const WINDOW = { groupId: 'g1', windowStartMs: 1_790_380_800_000, windowEndMs: 1_790_985_600_000 };

const member = (id: string) => ({ user_id: id, username: `user-${id}` });

const payload: GroupWeekSummaryResult = {
  members: [
    { rank: 1, member: member('u1'), working_sets: 12, group_records: 1 },
    { rank: 1, member: member('u2'), working_sets: 12, group_records: 1 },
    { rank: 3, member: { user_id: 'u3', username: null }, working_sets: 0, group_records: 0 },
  ],
  training_now: [
    { member: member('u2'), session_id: 's2', started_at_ms: 1_790_900_000_000, gym_name: 'Iron Temple', working_sets: 4, exercise_count: 2 },
  ],
  latest_completed: {
    member: member('u1'),
    session_id: 's1',
    started_at_ms: 1_790_800_000_000,
    completed_at_ms: 1_790_803_600_000,
    duration_sec: 3600,
    gym_name: null,
    working_sets: 12,
    exercise_count: 4,
    group_records: [
      {
        key: 'e1',
        group_exercise: { group_exercise_id: 'gx1', name: 'Bench' },
        set_id: 'set1',
        boards: [{ metric: 'weight', value: 140, unit: 'kg' }],
      },
    ],
  },
};

describe('group week summary read', () => {
  const mockRpc = jest.fn();
  const mockSchema = jest.fn();

  beforeEach(() => {
    mockRpc.mockReset();
    mockSchema.mockReset();
    mockSchema.mockReturnValue({ rpc: mockRpc });
    mockGetRequiredSupabaseMobileClient.mockReturnValue({ schema: mockSchema });
  });

  const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });

  const expectCode = async (promise: Promise<unknown>, code: GroupErrorCode) => {
    const error = await promise.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GroupApiError);
    expect((error as GroupApiError).code).toBe(code);
  };

  it('sends the group and window, and returns the payload', async () => {
    respond(payload);
    await expect(getGroupWeekSummary(WINDOW)).resolves.toEqual(payload);
    expect(mockSchema).toHaveBeenCalledWith('app_public');
    expect(mockRpc).toHaveBeenCalledWith('group_week_summary', {
      p_group_id: 'g1',
      p_window_start_ms: WINDOW.windowStartMs,
      p_window_end_ms: WINDOW.windowEndMs,
    });
  });

  it('accepts a group with nothing yet: no training, no latest session', async () => {
    const empty = { members: [payload.members[2]], training_now: [], latest_completed: null };
    respond(empty);
    await expect(getGroupWeekSummary(WINDOW)).resolves.toEqual(empty);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no members', { training_now: [], latest_completed: null }],
    ['members not an array', { members: {}, training_now: [], latest_completed: null }],
    ['no training_now', { members: [], latest_completed: null }],
    ['latest_completed missing', { members: [], training_now: [] }],
    ['latest_completed not an object', { members: [], training_now: [], latest_completed: 's1' }],
  ])('rejects a malformed payload (%s) as INTERNAL', async (_label, data) => {
    respond(data);
    await expectCode(getGroupWeekSummary(WINDOW), 'INTERNAL');
  });

  it.each([
    ['NOT_FOUND: group not found', 'NOT_FOUND'],
    ['VALIDATION: the window must be 0 <= p_window_start_ms < p_window_end_ms, at most 8 days long', 'VALIDATION'],
    ['AUTH_REQUIRED: group access requires an authenticated user', 'AUTH_REQUIRED'],
  ] as const)('maps the server token of %s', async (message, code) => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message }, status: 400 });
    await expectCode(getGroupWeekSummary(WINDOW), code);
  });

  it('maps a transport failure to NETWORK', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 });
    await expectCode(getGroupWeekSummary(WINDOW), 'NETWORK');
  });
});
