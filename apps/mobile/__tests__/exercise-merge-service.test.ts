import NetInfo from '@react-native-community/netinfo';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { sessions, syncRuntimeState } from '@/src/data/schema';
import { readMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import { wipeLocalDatabaseRows } from '@/src/data/local-wipe';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { executeExerciseMerge, loadMergeReview, mergeConfirmationText, prepareExerciseMerge, recoverExerciseMerge, resolveMergeReview } from '@/src/exercise-catalog/merge';
import type { MergePreview, MergeReviewItem } from '@/src/exercise-core/merge-types';

let mockOwner: string | null = 'a';
let mockDatabase: LocalDatabase;
const mockCycle = jest.fn();
const mockRpc = jest.fn();
const mockRefresh = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockDatabase }));
jest.mock('@/src/auth/supabase', () => ({ getMobileAuthRuntimeConfig: () => ({ isConfigured: true }) }));
jest.mock('@/src/auth/session-user', () => ({ getSignedInUserId: async () => mockOwner }));
jest.mock('@/src/sync/cycle', () => ({ runSyncCycle: () => mockCycle() }));
jest.mock('@/src/sync/exercise-merge', () => ({
  mergeRpc: (...args: unknown[]) => mockRpc(...args),
  refreshMergeReview: (...args: unknown[]) => mockRefresh(...args),
  uploadMergePending: (...args: unknown[]) => mockUpload(...args),
}));
const preview: MergePreview = { sourceId: 'source', destinationId: 'destination', sourceName: 'Source',
  destinationName: 'Destination', setCount: 1, factor: 2, token: 'preview' };
let fixture: InMemoryDatabaseFixture;
beforeEach(() => {
  fixture = createInMemoryDatabase(); mockDatabase = fixture.database as unknown as LocalDatabase;
  mockOwner = 'a';
  mockDatabase.insert(syncRuntimeState).values({ id: 'primary', accountUserId: 'a' }).run();
  mockCycle.mockReset().mockResolvedValue('converged');
  mockRpc.mockReset(); mockUpload.mockReset().mockResolvedValue(undefined); mockRefresh.mockReset().mockResolvedValue(undefined);
  jest.spyOn(NetInfo, 'fetch').mockResolvedValue({ isConnected: true } as Awaited<ReturnType<typeof NetInfo.fetch>>);
});
afterEach(() => { jest.restoreAllMocks(); fixture.close(); });

it('requires sign-in, a connection and completed sync before showing a server preview', async () => {
  mockOwner = null;
  await expect(prepareExerciseMerge('source', 'destination')).rejects.toThrow(/Sign in/);
  mockOwner = 'a';
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  await expect(prepareExerciseMerge('source', 'destination')).rejects.toThrow(/Connect/);
  mockCycle.mockResolvedValueOnce('internal');
  await expect(prepareExerciseMerge('source', 'destination')).rejects.toThrow(/Sync could not finish/);
  expect(mockRpc).not.toHaveBeenCalled();
  mockRpc.mockResolvedValue(preview);
  await expect(prepareExerciseMerge('source', 'destination')).resolves.toEqual(preview);
});

it('keeps an uncertain operation durably and retries the same ID before a new merge can start', async () => {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'exercise_merge_status') return null;
    throw new Error('response lost');
  });
  await expect(executeExerciseMerge(preview)).rejects.toThrow('response lost');
  const pending = readMergeLocal<{ id: string }>(mockDatabase, 'a', 'operation')!;
  expect(pending.id).toMatch(/^[a-f0-9-]{36}$/);
  await expect(prepareExerciseMerge('source', 'destination')).rejects.toThrow(/previous merge result/);
  await expect(recoverExerciseMerge()).rejects.toThrow('response lost');
  const calls = mockRpc.mock.calls.filter(([name]) => name === 'exercise_merge_execute');
  expect(calls).toHaveLength(2);
  expect(calls.every(([, args]) => args.p_id === pending.id)).toBe(true);
});

it('checks a known receipt without executing again and clears only a confirmed refusal', async () => {
  mockRpc.mockImplementation(async (name: string) => name === 'exercise_merge_status' ? { id: 'committed' } : undefined);
  await executeExerciseMerge(preview);
  expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['exercise_merge_status']);
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'exercise_merge_status') return null;
    throw new Error('MERGE_STALE: changed');
  });
  await expect(recoverExerciseMerge()).rejects.toThrow(/MERGE_STALE/);
  expect(readMergeLocal(mockDatabase, 'a', 'operation')).toBeNull();
});

it('keeps offline review readable and account-private across a wipe and restart', async () => {
  mockDatabase.transaction(tx => {
    writeMergeLocal(tx, { ownerUserId: 'a', id: 'saved-a', kind: 'pending', payload: { secret: 'A' } });
    writeMergeLocal(tx, { ownerUserId: 'a', id: 'conflicts', kind: 'conflicts', payload: [{ id: 'review-a' }] });
  });
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  expect(await loadMergeReview()).toMatchObject({ items: [{ id: 'review-a' }], pending: 1 });
  expect(mockUpload).not.toHaveBeenCalled();
  wipeLocalDatabaseRows(mockDatabase, { accountUserId: 'b' }); mockOwner = 'b';
  expect(await loadMergeReview()).toMatchObject({ items: [], pending: 0 });
  expect(readMergeLocal(mockDatabase, 'a', 'saved-a')).toEqual({ secret: 'A' });
});

it('retains cached review on a failed refresh and refuses offline resolution', async () => {
  mockRefresh.mockRejectedValueOnce(new Error('offline during review'));
  expect(await loadMergeReview()).toMatchObject({ error: 'offline during review' });
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  await expect(resolveMergeReview({ id: 'r', token: 't' } as MergeReviewItem, false)).rejects.toThrow(/Connect/);
  expect(mockRpc).not.toHaveBeenCalled();
});

it.each([[0.5, 'Weights will be halved.'], [1, ''], [2, 'Weights will be doubled.']] as const)(
  'confirms affected rows and only the applicable conversion for %s', (factor, warning) => {
    const text = mergeConfirmationText({ ...preview, factor });
    expect(text).toContain('Move 1 set from Source to Destination and delete Source? This cannot be undone.');
    if (warning) expect(text).toContain(warning); else expect(text).not.toContain('Weights');
    expect(mergeConfirmationText({ ...preview, setCount: 0 })).toContain('0 sets');
  },
);

it('identifies an invalid-weight session with a readable local date instead of its database ID', async () => {
  mockDatabase.insert(sessions).values({ id: 'session-with-bad-weight', status: 'completed', startedAt: new Date(2026, 9, 27, 10),
    completedAt: new Date(2026, 9, 27, 11) }).run();
  mockRpc.mockRejectedValue(new Error('VALIDATION: correct stored weights in session session-with-bad-weight'));
  await expect(prepareExerciseMerge('source', 'destination')).rejects.toThrow(/Correct stored weights in the session on .*2026.* before merging/);
});
