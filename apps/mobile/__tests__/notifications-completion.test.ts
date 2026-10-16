/* eslint-disable import/first */
const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockHeaders: [string, string][] = [];
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => ({ auth: { getSession: mockGetSession },
  schema: () => ({ rpc: (...args: unknown[]) => ({ abortSignal: () => ({ setHeader: (key: string, value: string) => {
    mockHeaders.push([key, value]); return mockRpc(...args);
  } }) }) }),
}) }));
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { exerciseGroupLinkId } from '@/src/data/exercise-group-links';
import { exerciseDefinitions, exerciseGroupLinks, exerciseSets, sessionExercises, sessions } from '@/src/data/schema';
import { entityToWire } from '@/src/sync/cycle';
import { getPendingNotificationCompletions } from '@/src/notifications/api';
import { __resetNotificationCompletionCursorForTests, confirmSyncedNotificationCompletions, readCompletedNotificationGraphs } from '@/src/notifications/completion';

const deletedLinkId = exerciseGroupLinkId('group', 'definition');
let fixture: InMemoryDatabaseFixture;
const db = () => fixture.database as unknown as LocalDatabase;
beforeEach(() => {
  fixture = createInMemoryDatabase(); __resetNotificationCompletionCursorForTests(); mockRpc.mockReset(); mockGetSession.mockReset(); mockHeaders.length = 0;
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user' }, access_token: 'captured-session' } }, error: null });
});
afterEach(() => fixture.close());
const seed = () => {
  const database = fixture.database;
  database.insert(exerciseDefinitions).values({ id: 'definition', name: 'Bench' }).run();
  database.insert(sessions).values({ id: 'session', status: 'completed', startedAt: new Date(10), completedAt: new Date(20) }).run();
  database.insert(sessionExercises).values({ id: 'exercise', sessionId: 'session', exerciseDefinitionId: 'definition', name: 'Bench', orderIndex: 0 }).run();
  database.insert(exerciseSets).values({ id: 'set', sessionExerciseId: 'exercise', orderIndex: 0, weightValue: '100', repsValue: '5' }).run();
  database.insert(exerciseSets).values({ id: 'deleted-set', sessionExerciseId: 'exercise', orderIndex: 1, deletedAt: new Date(30) }).run();
  database.insert(exerciseGroupLinks).values({ id: deletedLinkId, exerciseDefinitionId: 'definition', groupId: 'group', groupExerciseId: 'comparison', deletedAt: new Date(30) }).run();
};
test('manifest uses all exact domain rows including tombstones, without clocks and local bookkeeping', () => {
  seed();
  const [graph] = readCompletedNotificationGraphs(db(), entityToWire, ['session']);
  expect(graph.map(row => `${row.type}:${row.id}`)).toEqual(['exercise_definitions:definition', `exercise_group_links:${deletedLinkId}`,
    'exercise_sets:deleted-set', 'exercise_sets:set', 'session_exercises:exercise', 'sessions:session']);
  expect(graph.find(row => row.id === 'deleted-set')?.fields.deleted_at).toBe(30);
  expect(graph.find(row => row.id === deletedLinkId)?.fields.deleted_at).toBe(30);
  expect(graph.find(row => row.id === 'session')?.fields.completed_at).toBe(20);
  for (const row of graph) expect(Object.keys(row)).toEqual(['type', 'id', 'fields']);
});
test('dirty quarantined rows prevent false completion proof without affecting other selected sources', () => {
  seed(); fixture.database.update(exerciseSets).set({ localDirty: true }).where(eq(exerciseSets.id, 'deleted-set')).run();
  expect(readCompletedNotificationGraphs(db(), entityToWire, ['session'])).toEqual([]);
});
test('uses original server candidates despite backdated local timestamp, pins token and advances a bounded cursor', async () => {
  seed();
  mockRpc.mockImplementation(async name => ({ data: name === 'notification_pending_completions'
    ? { session_ids: ['session'], next_session_id: 'session' } : { confirmed: true }, error: null }));
  await confirmSyncedNotificationCompletions(db(), entityToWire, 'user');
  expect(mockRpc).toHaveBeenCalledWith('notification_confirm_completion', { p_session_id: 'session',
    p_entities: readCompletedNotificationGraphs(db(), entityToWire, ['session'])[0] });
  expect(mockHeaders).toEqual([['Authorization', 'Bearer captured-session'], ['Authorization', 'Bearer captured-session']]);
  await confirmSyncedNotificationCompletions(db(), entityToWire, 'user');
  expect(mockRpc).toHaveBeenCalledWith('notification_pending_completions', { p_after_session_id: 'session' });
});
test('transport, malformed replies and missing auth remain optional and do not throw into sync', async () => {
  mockRpc.mockRejectedValueOnce(new Error('offline'));
  await expect(confirmSyncedNotificationCompletions(db(), entityToWire, 'user')).resolves.toBeUndefined();
  mockRpc.mockResolvedValueOnce({ data: { session_ids: ['x', 'x'], next_session_id: 'x' }, error: null });
  await expect(getPendingNotificationCompletions(null, 'token')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  mockGetSession.mockResolvedValueOnce({ data: { session: { user: { id: 'other' } } }, error: null });
  const calls = mockRpc.mock.calls.length;
  await confirmSyncedNotificationCompletions(db(), entityToWire, 'user');
  expect(mockRpc).toHaveBeenCalledTimes(calls);
});
test.each([{ session_ids: ['x'], next_session_id: 'y' }, { session_ids: Array(11).fill('x'), next_session_id: null },
  { session_ids: [''], next_session_id: null }, { session_ids: [], next_session_id: null, extra: true }])('rejects candidate page shape %j', async value => {
  mockRpc.mockResolvedValueOnce({ data: value, error: null });
  await expect(getPendingNotificationCompletions(null, 'token')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
