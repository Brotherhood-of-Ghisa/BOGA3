/* eslint-disable import/first */

/**
 * M25-T09 board reads (card AC1; groups contract §4.5): `getGroupBoardPodiums`,
 * `getGroupBoard`, and `getGroupBoardHistory` send every `p_*` arg with the
 * pinned defaults, reject malformed payloads as INTERNAL, map server tokens and
 * transport failures, and `isGroupExerciseNotFound` separates the two
 * `NOT_FOUND` messages. Supabase is mocked.
 */

const mockGetRequiredSupabaseMobileClient = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredSupabaseMobileClient(),
}));

import {
  GroupApiError,
  getGroupBoard,
  getGroupBoardHistory,
  getGroupBoardPodiums,
  isGroupExerciseNotFound,
  type GroupErrorCode,
} from '@/src/groups';

const exercise = {
  group_exercise_id: 'ge1',
  name: 'Bench',
  load_input_mode: 'total_load' as const,
  source_exercise_id: null,
  archived_at_ms: null,
};

const view = { groupId: 'g1', groupExerciseId: 'ge1', metric: 'weight' as const, certified: false };

describe('group board reads', () => {
  const mockRpc = jest.fn();
  const mockSchema = jest.fn();

  beforeEach(() => {
    mockRpc.mockReset();
    mockSchema.mockReset();
    mockSchema.mockReturnValue({ rpc: mockRpc });
    mockGetRequiredSupabaseMobileClient.mockReturnValue({ schema: mockSchema });
  });

  const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });

  const rejection = async (promise: Promise<unknown>): Promise<GroupApiError> => {
    const error = await promise.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GroupApiError);
    return error as GroupApiError;
  };

  const expectCode = async (promise: Promise<unknown>, code: GroupErrorCode) => {
    expect((await rejection(promise)).code).toBe(code);
  };

  it('podiums: always Certified · e1RM', async () => {
    const payload = { metric: 'e1rm', certified: true, exercises: [] };
    respond(payload);
    await expect(getGroupBoardPodiums('g1')).resolves.toEqual(payload);
    expect(mockSchema).toHaveBeenCalledWith('app_public');
    expect(mockRpc).toHaveBeenCalledWith('group_board_podiums', { p_group_id: 'g1', p_metric: 'e1rm', p_certified: true });
  });

  it('board: first page sends a null cursor and limit 50', async () => {
    const payload = { exercise, metric: 'weight', certified: false, rows: [], next_cursor: null, has_more: false };
    respond(payload);
    await expect(getGroupBoard(view)).resolves.toEqual(payload);
    expect(mockRpc).toHaveBeenCalledWith('group_board', {
      p_group_id: 'g1',
      p_group_exercise_id: 'ge1',
      p_metric: 'weight',
      p_certified: false,
      p_after: null,
      p_limit: 50,
    });
  });

  it('board: a later page sends the cursor verbatim', async () => {
    const cursor = { value_kg: 142.5, achieved_at_ms: 1000, member_user_id: 'u2' };
    respond({ exercise, metric: 'e1rm', certified: true, rows: [], next_cursor: null, has_more: false });
    await getGroupBoard({ ...view, metric: 'e1rm', certified: true, after: cursor, limit: 10 });
    expect(mockRpc).toHaveBeenCalledWith('group_board', {
      p_group_id: 'g1',
      p_group_exercise_id: 'ge1',
      p_metric: 'e1rm',
      p_certified: true,
      p_after: cursor,
      p_limit: 10,
    });
  });

  it('history: first page sends a null cursor and limit 20; a later page sends { seq }', async () => {
    const payload = { items: [], next_cursor: null, has_more: false };
    respond(payload);
    await expect(getGroupBoardHistory(view)).resolves.toEqual(payload);
    expect(mockRpc).toHaveBeenLastCalledWith('group_board_history', {
      p_group_id: 'g1',
      p_group_exercise_id: 'ge1',
      p_metric: 'weight',
      p_certified: false,
      p_before: null,
      p_limit: 20,
    });

    respond(payload);
    await getGroupBoardHistory({ ...view, before: { seq: 41 } });
    expect(mockRpc).toHaveBeenLastCalledWith('group_board_history', expect.objectContaining({ p_before: { seq: 41 } }));
  });

  it.each([
    ['podiums without exercises', () => getGroupBoardPodiums('g1'), { metric: 'e1rm' }],
    ['board without rows', () => getGroupBoard(view), { exercise, has_more: false }],
    ['board without exercise', () => getGroupBoard(view), { rows: [], has_more: false }],
    ['board without has_more', () => getGroupBoard(view), { exercise, rows: [] }],
    ['history without items', () => getGroupBoardHistory(view), { has_more: false }],
    ['history without has_more', () => getGroupBoardHistory(view), { items: [] }],
    ['a null payload', () => getGroupBoardHistory(view), null],
  ])('a malformed payload is INTERNAL: %s', async (_label, invoke, data) => {
    respond(data);
    await expectCode(invoke(), 'INTERNAL');
  });

  it('maps server tokens, transport failures, and thrown calls', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: group not found' }, status: 400 });
    await expectCode(getGroupBoard(view), 'NOT_FOUND');

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'VALIDATION: p_after must be a cursor from next_cursor' },
      status: 400,
    });
    await expectCode(getGroupBoard(view), 'VALIDATION');

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 });
    await expectCode(getGroupBoardHistory(view), 'NETWORK');

    mockRpc.mockRejectedValueOnce(new Error('socket hang up'));
    await expectCode(getGroupBoardPodiums('g1'), 'NETWORK');
  });

  it('isGroupExerciseNotFound tells the exercise NOT_FOUND from the group NOT_FOUND', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: group exercise not found' }, status: 400 });
    const exerciseMissing = await rejection(getGroupBoard(view));
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NOT_FOUND: group not found' }, status: 400 });
    const groupMissing = await rejection(getGroupBoard(view));

    expect(isGroupExerciseNotFound(exerciseMissing)).toBe(true);
    expect(isGroupExerciseNotFound(groupMissing)).toBe(false);
    expect(isGroupExerciseNotFound(new GroupApiError('VALIDATION', 'group exercise not found'))).toBe(false);
    expect(isGroupExerciseNotFound(new Error('group exercise not found'))).toBe(false);
  });
});
