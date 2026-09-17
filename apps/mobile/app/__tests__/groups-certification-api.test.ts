/* eslint-disable import/first */

/**
 * M25-T10 certification wrappers (card AC1; groups contract §4, §4.6):
 * `group_certify`, `group_certification_withdraw`, `group_certification_cancel`
 * send every `p_*` arg and are shape-checked; `CONFLICT` maps from its token;
 * the `NOT_FOUND` message helpers tell the four cases apart. Supabase is mocked.
 */

const mockGetRequiredSupabaseMobileClient = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredSupabaseMobileClient(),
}));

import {
  GroupApiError,
  cancelGroupCertification,
  certifyGroupSet,
  isCertificationNotFound,
  isGroupExerciseNotFound,
  isGroupMemberNotFound,
  isGroupNotFound,
  isRecordSetNotFound,
  withdrawGroupCertification,
  type GroupCertification,
  type GroupErrorCode,
} from '@/src/groups';

const certification: GroupCertification = {
  certification_id: 'c1',
  group_id: 'g1',
  group_exercise_id: 'ge1',
  member: { user_id: 'lifter', username: 'dave' },
  set_id: 'set1',
  session_id: 's1',
  certified_by: { user_id: 'me', username: 'sam' },
  certified_at_ms: 1_757_500_000_000,
  pinned: { weight_value: '140', reps_value: '1', performance_status: 'performed', weight_kg: 140, reps: 1, e1rm_kg: 140 },
  ended_at_ms: null,
  end_reason: null,
  ended_by: null,
};

describe('certification api (M25-T10)', () => {
  const mockRpc = jest.fn();
  const mockSchema = jest.fn();

  beforeEach(() => {
    mockRpc.mockReset();
    mockSchema.mockReset();
    mockSchema.mockReturnValue({ rpc: mockRpc });
    mockGetRequiredSupabaseMobileClient.mockReturnValue({ schema: mockSchema });
  });

  const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });
  const fail = (message: string, status = 400) => mockRpc.mockResolvedValueOnce({ data: null, error: { message }, status });

  const rejection = async (promise: Promise<unknown>): Promise<GroupApiError> => {
    const caught = await promise.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(GroupApiError);
    return caught as GroupApiError;
  };

  const expectCode = async (promise: Promise<unknown>, code: GroupErrorCode) => {
    expect((await rejection(promise)).code).toBe(code);
  };

  it('certifies with every p_* arg and returns { certification, created }', async () => {
    respond({ certification, created: true });
    await expect(
      certifyGroupSet({ groupId: 'g1', groupExerciseId: 'ge1', memberUserId: 'lifter', setId: 'set1' }),
    ).resolves.toEqual({ certification, created: true });
    expect(mockSchema).toHaveBeenCalledWith('app_public');
    expect(mockRpc).toHaveBeenCalledWith('group_certify', {
      p_group_id: 'g1',
      p_group_exercise_id: 'ge1',
      p_member_user_id: 'lifter',
      p_set_id: 'set1',
    });
  });

  it('withdraws and cancels with the group and certification ids', async () => {
    const ended = { ...certification, ended_at_ms: 1, end_reason: 'withdrawn' as const, ended_by: certification.certified_by };
    respond({ certification: ended });
    await expect(withdrawGroupCertification('g1', 'c1')).resolves.toEqual({ certification: ended });
    expect(mockRpc).toHaveBeenLastCalledWith('group_certification_withdraw', { p_group_id: 'g1', p_certification_id: 'c1' });

    respond({ certification: ended });
    await expect(cancelGroupCertification('g1', 'c1')).resolves.toEqual({ certification: ended });
    expect(mockRpc).toHaveBeenLastCalledWith('group_certification_cancel', { p_group_id: 'g1', p_certification_id: 'c1' });
  });

  it('rejects malformed payloads as INTERNAL', async () => {
    respond({ certification });
    await expectCode(certifyGroupSet({ groupId: 'g1', groupExerciseId: 'ge1', memberUserId: 'l', setId: 's' }), 'INTERNAL');
    respond({ certification: { certification_id: 7 }, created: true });
    await expectCode(certifyGroupSet({ groupId: 'g1', groupExerciseId: 'ge1', memberUserId: 'l', setId: 's' }), 'INTERNAL');
    respond({ created: false });
    await expectCode(withdrawGroupCertification('g1', 'c1'), 'INTERNAL');
    respond(null);
    await expectCode(cancelGroupCertification('g1', 'c1'), 'INTERNAL');
  });

  it('maps CONFLICT, VALIDATION, FORBIDDEN, and transport failures', async () => {
    fail('CONFLICT: the set changed; refresh and try again');
    const conflict = await rejection(
      certifyGroupSet({ groupId: 'g1', groupExerciseId: 'ge1', memberUserId: 'l', setId: 's' }),
    );
    expect(conflict.code).toBe('CONFLICT');
    expect(conflict.message).toBe('the set changed; refresh and try again');

    fail('VALIDATION: you cannot certify your own set');
    await expectCode(certifyGroupSet({ groupId: 'g1', groupExerciseId: 'ge1', memberUserId: 'l', setId: 's' }), 'VALIDATION');
    fail('FORBIDDEN: only the owner or an admin can cancel a certification');
    await expectCode(cancelGroupCertification('g1', 'c1'), 'FORBIDDEN');
    fail('Failed to fetch', 0);
    await expectCode(withdrawGroupCertification('g1', 'c1'), 'NETWORK');
    mockRpc.mockRejectedValueOnce(new Error('socket hang up'));
    await expectCode(withdrawGroupCertification('g1', 'c1'), 'NETWORK');
  });

  it('tells the NOT_FOUND messages apart; only "group not found" is a group loss', () => {
    const notFound = (message: string) => new GroupApiError('NOT_FOUND', message);
    const cases = [
      ['group not found', isGroupNotFound],
      ['group exercise not found', isGroupExerciseNotFound],
      ['record set not found', isRecordSetNotFound],
      ['certification not found', isCertificationNotFound],
      ['member not found', isGroupMemberNotFound],
    ] as const;
    for (const [message, matches] of cases) {
      for (const [other, otherMatches] of cases) {
        expect(otherMatches(notFound(message))).toBe(other === message);
      }
      expect(matches(new GroupApiError('VALIDATION', message))).toBe(false);
    }
    expect(isGroupNotFound(new Error('group not found'))).toBe(false);
  });
});
