/* eslint-disable import/first */

/**
 * The typed group RPC client (groups contract §4, §6.1): one wrapper per RPC
 * called as `schema('app_public').rpc(name, p_* args)`, and error mapping —
 * every server token by prefix, transport failure → NETWORK, anything else →
 * INTERNAL. Supabase is mocked (the backend lands in M22-T01).
 */

const mockGetRequiredSupabaseMobileClient = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredSupabaseMobileClient(),
}));

import {
  GROUP_SERVER_ERROR_CODES,
  GroupApiError,
  createGroup,
  getGroup,
  getGroupInviteCode,
  getGroupSessionDetail,
  getGroupStream,
  joinGroup,
  leaveGroup,
  listMyGroups,
  previewGroupInvite,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  toGroupApiError,
  transferGroupOwnership,
  updateGroup,
  type GroupErrorCode,
} from '@/src/groups';

const summary = { group_id: 'g1', name: 'Crew', description: null, member_count: 2, my_role: 'owner' as const };
const groupGetPayload = {
  group: summary,
  members: [
    { user_id: 'u1', username: 'dino', role: 'owner' as const },
    { user_id: 'u2', username: null, role: 'admin' as const },
  ],
};

describe('groups api client', () => {
  const mockRpc = jest.fn();
  const mockSchema = jest.fn();

  beforeEach(() => {
    mockRpc.mockReset();
    mockSchema.mockReset();
    mockGetRequiredSupabaseMobileClient.mockReset();
    mockSchema.mockReturnValue({ rpc: mockRpc });
    mockGetRequiredSupabaseMobileClient.mockReturnValue({ schema: mockSchema });
  });

  const respond = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null, status: 200 });

  const expectRejectsWith = async (promise: Promise<unknown>, code: GroupErrorCode, message?: string) => {
    const error = await promise.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GroupApiError);
    expect((error as GroupApiError).code).toBe(code);
    if (message !== undefined) {
      expect((error as GroupApiError).message).toBe(message);
    }
  };

  describe('one typed wrapper per RPC', () => {
    const cases: {
      rpc: string;
      invoke: () => Promise<unknown>;
      args: Record<string, unknown>;
      data: unknown;
      expected: unknown;
    }[] = [
      { rpc: 'group_list_mine', invoke: () => listMyGroups(), args: {}, data: { groups: [summary] }, expected: { groups: [summary] } },
      {
        rpc: 'group_get',
        invoke: () => getGroup('g1'),
        args: { p_group_id: 'g1' },
        data: { group: summary, members: [] },
        expected: { group: summary, members: [] },
      },
      {
        rpc: 'group_stream',
        invoke: () => getGroupStream({ groupId: null }),
        args: { p_group_id: null, p_before: null, p_limit: 20 },
        data: { items: [], next_cursor: null, has_more: false },
        expected: { items: [], next_cursor: null, has_more: false },
      },
      {
        rpc: 'group_stream',
        invoke: () =>
          getGroupStream({ groupId: 'g1', before: { sort_at_ms: 5, kind: 'session', key: 'u:s' }, limit: 50 }),
        args: { p_group_id: 'g1', p_before: { sort_at_ms: 5, kind: 'session', key: 'u:s' }, p_limit: 50 },
        data: { items: [], next_cursor: null, has_more: false },
        expected: { items: [], next_cursor: null, has_more: false },
      },
      {
        rpc: 'group_session_detail',
        invoke: () => getGroupSessionDetail('u2', 's1'),
        args: { p_member_user_id: 'u2', p_session_id: 's1' },
        data: { session: { session_id: 's1' } },
        expected: { session: { session_id: 's1' } },
      },
      {
        rpc: 'group_invite_preview',
        invoke: () => previewGroupInvite('ABCD2345'),
        args: { p_code: 'ABCD2345' },
        data: { group_id: 'g1', name: 'Crew', member_count: 2, already_member: false },
        expected: { group_id: 'g1', name: 'Crew', member_count: 2, already_member: false },
      },
      {
        rpc: 'group_create',
        invoke: () => createGroup({ name: 'Crew', description: null }),
        args: { p_name: 'Crew', p_description: null },
        data: { group_id: 'g1' },
        expected: { group_id: 'g1' },
      },
      {
        rpc: 'group_update',
        invoke: () => updateGroup('g1', { name: 'Crew 2', description: 'Lifts' }),
        args: { p_group_id: 'g1', p_name: 'Crew 2', p_description: 'Lifts' },
        data: { group: summary },
        expected: { group: summary },
      },
      {
        rpc: 'group_invite_get',
        invoke: () => getGroupInviteCode('g1'),
        args: { p_group_id: 'g1' },
        data: { code: 'ABCD2345' },
        expected: { code: 'ABCD2345' },
      },
      {
        rpc: 'group_invite_regenerate',
        invoke: () => regenerateGroupInviteCode('g1'),
        args: { p_group_id: 'g1' },
        data: { code: 'WXYZ6789' },
        expected: { code: 'WXYZ6789' },
      },
      {
        rpc: 'group_join',
        invoke: () => joinGroup('ABCD2345'),
        args: { p_code: 'ABCD2345' },
        data: { group_id: 'g1', joined: true },
        expected: { group_id: 'g1', joined: true },
      },
      {
        rpc: 'group_leave',
        invoke: () => leaveGroup('g1'),
        args: { p_group_id: 'g1' },
        data: { group_id: 'g1' },
        expected: { group_id: 'g1' },
      },
      {
        rpc: 'group_remove_member',
        invoke: () => removeGroupMember('g1', 'u2'),
        args: { p_group_id: 'g1', p_user_id: 'u2' },
        data: groupGetPayload,
        expected: groupGetPayload,
      },
      {
        rpc: 'group_set_role',
        invoke: () => setGroupMemberRole('g1', 'u2', 'admin'),
        args: { p_group_id: 'g1', p_user_id: 'u2', p_role: 'admin' },
        data: groupGetPayload,
        expected: groupGetPayload,
      },
      {
        rpc: 'group_transfer_ownership',
        invoke: () => transferGroupOwnership('g1', 'u2'),
        args: { p_group_id: 'g1', p_user_id: 'u2' },
        data: groupGetPayload,
        expected: groupGetPayload,
      },
    ];

    it.each(cases)('$rpc calls app_public.$rpc with its p_* args', async ({ rpc, invoke, args, data, expected }) => {
      respond(data);

      await expect(invoke()).resolves.toEqual(expected);

      expect(mockSchema).toHaveBeenCalledWith('app_public');
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith(rpc, args);
    });
  });

  describe('error mapping', () => {
    it.each(GROUP_SERVER_ERROR_CODES.map((token) => [token]))(
      'maps a P0001 "%s: …" PostgREST error to that code by token prefix',
      async (token) => {
        mockRpc.mockResolvedValueOnce({
          data: null,
          error: { code: 'P0001', message: `${token}: server detail`, details: null, hint: null },
          status: 400,
        });

        await expectRejectsWith(listMyGroups(), token, 'server detail');
      },
    );

    it('uses the token as the message when the server sends no detail', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'NOT_FOUND' }, status: 400 });

      await expectRejectsWith(getGroup('g1'), 'NOT_FOUND', 'NOT_FOUND');
    });

    it('matches the token only as a prefix, never inside the message', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'unexpected: NOT_FOUND somewhere' },
        status: 400,
      });

      await expectRejectsWith(getGroup('g1'), 'INTERNAL');
    });

    it('maps an unknown token-shaped prefix to INTERNAL', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'FK_VIOLATION: nope' }, status: 400 });

      await expectRejectsWith(listMyGroups(), 'INTERNAL', 'FK_VIOLATION: nope');
    });

    it('maps a postgrest-js transport failure (status 0) to NETWORK', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { code: '', message: 'TypeError: Network request failed', details: '', hint: '' },
        status: 0,
      });

      await expectRejectsWith(listMyGroups(), 'NETWORK', 'TypeError: Network request failed');
    });

    it('maps a thrown rpc call to NETWORK', async () => {
      mockRpc.mockRejectedValueOnce(new TypeError('Network request failed'));

      await expectRejectsWith(joinGroup('ABCD2345'), 'NETWORK', 'Network request failed');
    });

    it('maps any other PostgREST error to INTERNAL', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'function not found' }, status: 404 });

      await expectRejectsWith(listMyGroups(), 'INTERNAL', 'function not found');
    });

    it('maps an unconfigured backend (client getter throws) to INTERNAL without calling rpc', async () => {
      mockGetRequiredSupabaseMobileClient.mockImplementationOnce(() => {
        throw new Error('Supabase is not configured.');
      });

      await expectRejectsWith(listMyGroups(), 'INTERNAL', 'Supabase is not configured.');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('fails loud with INTERNAL when a read payload is missing its contract keys', async () => {
      respond({ unexpected: true });
      await expectRejectsWith(listMyGroups(), 'INTERNAL', 'group_list_mine returned an unexpected payload.');

      respond(null);
      await expectRejectsWith(getGroupStream({ groupId: null }), 'INTERNAL');

      respond({ group_id: 'g1' });
      await expectRejectsWith(joinGroup('ABCD2345'), 'INTERNAL');
    });

    it('fails loud with INTERNAL when a membership-write payload is missing its contract keys', async () => {
      respond(null);
      await expectRejectsWith(leaveGroup('g1'), 'INTERNAL', 'group_leave returned an unexpected payload.');

      respond({ group: summary });
      await expectRejectsWith(removeGroupMember('g1', 'u2'), 'INTERNAL');

      respond({ members: [] });
      await expectRejectsWith(setGroupMemberRole('g1', 'u2', 'member'), 'INTERNAL');

      respond({ group_id: 'g1' });
      await expectRejectsWith(transferGroupOwnership('g1', 'u2'), 'INTERNAL');
    });
  });

  describe('toGroupApiError', () => {
    it('passes a GroupApiError through and wraps anything else as INTERNAL', () => {
      const mapped = new GroupApiError('FORBIDDEN', 'no');
      expect(toGroupApiError(mapped)).toBe(mapped);

      const wrapped = toGroupApiError(new Error('boom'));
      expect(wrapped.code).toBe('INTERNAL');
      expect(wrapped.message).toBe('boom');

      expect(toGroupApiError(undefined).code).toBe('INTERNAL');
    });
  });
});
