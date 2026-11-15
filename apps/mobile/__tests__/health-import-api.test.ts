/** The import's RPC client: argument names, the result guard, and how server errors are classified. */
import { healthImportApi } from '@/src/health-import/api';

const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({ schema: (name: string) => ({ rpc: (fn: string, args: unknown) => mockRpc(name, fn, args) }) }),
}));

beforeEach(() => mockRpc.mockReset());

it('calls app_public.health_activities_apply as apple_health', async () => {
  mockRpc.mockResolvedValueOnce({ data: { upserted: 1, deleted: 0, pruned: 0 }, error: null });
  await expect(healthImportApi.apply({ upserts: [], deletes: ['x'] })).resolves.toEqual({ upserted: 1, deleted: 0, pruned: 0 });
  expect(mockRpc).toHaveBeenCalledWith('app_public', 'health_activities_apply', { p_source: 'apple_health', p_upserts: [], p_deletes: ['x'] });
});

it('sends the complete window and ids only on a closing backfill call', async () => {
  mockRpc.mockResolvedValueOnce({ data: { upserted: 0, deleted: 0, pruned: 2 }, error: null });
  await healthImportApi.apply({ upserts: [], deletes: [], completeSince: '2026-08-12T12:00:00.000Z', completeIds: ['a'] });
  expect(mockRpc.mock.calls[0][2]).toMatchObject({ p_complete_since: '2026-08-12T12:00:00.000Z', p_complete_ids: ['a'] });
});

it.each([
  ['AUTH_REQUIRED: sign in to import activities', 'AUTH_REQUIRED'],
  ['AGENT_FORBIDDEN: OAuth clients cannot import activities', 'AUTH_REQUIRED'],
  ['INVALID_ARGUMENT: unknown activity field route', 'UPLOAD_FAILED'],
  ['Failed to fetch', 'UPLOAD_FAILED'],
])('classifies %s as %s', async (message, code) => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } });
  await expect(healthImportApi.apply({ upserts: [], deletes: [] })).rejects.toMatchObject({ code, message });
});

it('rejects a result it does not recognise instead of counting it', async () => {
  mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
  await expect(healthImportApi.apply({ upserts: [], deletes: [] })).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
});
