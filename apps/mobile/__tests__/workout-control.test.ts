import NetInfo from '@react-native-community/netinfo';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions, syncRuntimeState } from '@/src/data/schema';
import { assertWorkoutWritable, loadPendingWorkoutControl, pendingWorkoutControl } from '@/src/data/workout-control';
import { changeWorkoutControl } from '@/src/sync/workout-control';
import { MergeRpcError } from '@/src/sync/exercise-merge';
import type { ConnectedAgent } from '@/src/auth/connected-agents';

let mockOwner: string | null = 'owner';
let mockDatabase: LocalDatabase;
const mockCycle = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockDatabase }));
jest.mock('@/src/auth/session-user', () => ({ getSignedInUserId: async () => mockOwner }));
jest.mock('@/src/sync/cycle', () => ({ runSyncCycle: () => mockCycle() }));
jest.mock('@/src/sync/exercise-merge', () => {
  const actual = jest.requireActual('@/src/sync/exercise-merge');
  return { ...actual, mergeRpc: (...args: unknown[]) => mockRpc(...args) };
});

const agent: ConnectedAgent = { clientId: 'coach', grantedAt: '2026-11-10T12:00:00Z', name: 'Coach',
  lastAccessAt: null, scopes: [], planAccessEnabled: false, planEditEnabled: false, workoutLoggingEnabled: true };
let fixture: InMemoryDatabaseFixture;
beforeEach(() => {
  fixture = createInMemoryDatabase(); mockDatabase = fixture.database as unknown as LocalDatabase; mockOwner = 'owner';
  mockDatabase.insert(syncRuntimeState).values({ id: 'primary', accountUserId: mockOwner }).run();
  mockDatabase.insert(sessions).values({ id: 'workout', status: 'active', startedAt: new Date(1), mergeRevision: 1 }).run();
  mockDatabase.insert(exerciseDefinitions).values({ id: 'bench', name: 'Bench' }).run();
  mockDatabase.insert(sessionExercises).values({ id: 'block', sessionId: 'workout', exerciseDefinitionId: 'bench', name: 'Bench', orderIndex: 0 }).run();
  mockDatabase.insert(exerciseSets).values({ id: 'set', sessionExerciseId: 'block', orderIndex: 0, weightValue: '40', repsValue: '5' }).run();
  mockCycle.mockReset().mockResolvedValue('converged'); mockRpc.mockReset().mockResolvedValue({});
  jest.spyOn(NetInfo, 'fetch').mockResolvedValue({ isConnected: true } as Awaited<ReturnType<typeof NetInfo.fetch>>);
});
afterEach(() => { jest.restoreAllMocks(); fixture.close(); });

it('requires an authenticated connection, completed sync and an enabled independent grant', async () => {
  mockOwner = null;
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/Sign in/);
  mockOwner = 'owner';
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce({ isConnected: false } as Awaited<ReturnType<typeof NetInfo.fetch>>);
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/Connect/);
  mockCycle.mockResolvedValueOnce('internal');
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/finish syncing/);
  await expect(changeWorkoutControl('workout', { ...agent, workoutLoggingEnabled: false })).rejects.toThrow(/permission/);
  expect(mockRpc).not.toHaveBeenCalled();
});

it('hands over the same graph and keeps app writes locked until the response and canonical pull are confirmed', async () => {
  mockRpc.mockImplementation(async (_name, action) => {
    expect(action).toMatchObject({ p_session_id: 'workout', p_base_revision: 1, p_client_id: 'coach', p_granted_at: agent.grantedAt });
    expect(() => assertWorkoutWritable(mockDatabase, 'workout')).toThrow(/not confirmed/);
    mockDatabase.update(sessions).set({ loggingClientId: 'coach', loggingGrantedAt: agent.grantedAt, mergeRevision: 2 }).run();
    return {};
  });
  await changeWorkoutControl('workout', agent);
  expect(pendingWorkoutControl(mockDatabase, 'workout')).toBeNull();
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).toThrow(/AI is logging/);
  expect(mockDatabase.select().from(exerciseSets).all()).toMatchObject([{ id: 'set', weightValue: '40', repsValue: '5' }]);
  expect(mockCycle).toHaveBeenCalledTimes(2);
});

it('retries the identical durable request after a lost acknowledgement instead of granting a different client', async () => {
  mockRpc.mockRejectedValueOnce(new Error('lost response'));
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/not be confirmed/);
  const pending = pendingWorkoutControl(mockDatabase, 'workout');
  expect(pending?.p_id).toMatch(/^control:/);
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).toThrow(/not confirmed/);
  mockDatabase.update(sessions).set({ mergeRevision: 2, loggingClientId: 'coach', loggingGrantedAt: agent.grantedAt }).run();
  await changeWorkoutControl('workout', { ...agent, clientId: 'another-coach' });
  expect(mockRpc.mock.calls[1][1]).toEqual(pending);
  expect(pendingWorkoutControl(mockDatabase, 'workout')).toBeNull();
});

it('keeps an unconfirmed takeover locked until its canonical human-owned header is refreshed', async () => {
  mockDatabase.update(sessions).set({ loggingClientId: 'coach', loggingGrantedAt: agent.grantedAt }).run();
  mockRpc.mockImplementation(async () => {
    mockDatabase.update(sessions).set({ loggingClientId: null, loggingGrantedAt: null, mergeRevision: 2 }).run();
    return {};
  });
  mockCycle.mockResolvedValueOnce('converged').mockResolvedValueOnce('internal');
  await expect(changeWorkoutControl('workout', null)).rejects.toThrow(/confirm/);
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).toThrow(/not confirmed/);
  await changeWorkoutControl('workout', null);
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).not.toThrow();
});

it('removes only a confirmed SQL refusal after refresh, while retaining a refusal whose refresh failed', async () => {
  mockRpc.mockRejectedValue(new MergeRpcError('WORKOUT_PERMISSION_REQUIRED', 'P0001'));
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/no longer has workout logging permission/);
  expect(pendingWorkoutControl(mockDatabase, 'workout')).toBeNull();
  mockCycle.mockResolvedValueOnce('converged').mockResolvedValueOnce('internal');
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/confirm/);
  expect(pendingWorkoutControl(mockDatabase, 'workout')).not.toBeNull();
});

it('does not strand completed history when MCP finishes after an unconfirmed transfer', async () => {
  mockRpc.mockRejectedValueOnce(new Error('lost response'));
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/confirm/);
  mockDatabase.update(sessions).set({ status: 'completed', completedAt: new Date(1000), mergeRevision: 3, loggingClientId: null }).run();
  expect(await loadPendingWorkoutControl('workout')).toBeNull();
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).not.toThrow();
});

it('keeps dated completed history locked through an unconfirmed takeover and preserves its dates', async () => {
  const start = new Date(100), end = new Date(2100);
  mockDatabase.update(sessions).set({ status: 'completed', startedAt: start, completedAt: end, durationSec: 2,
    loggingClientId: 'coach', loggingGrantedAt: agent.grantedAt }).run();
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).toThrow(/AI is logging/);
  mockRpc.mockRejectedValueOnce(new Error('lost takeover response'));
  await expect(changeWorkoutControl('workout', null)).rejects.toThrow(/confirm/);
  mockDatabase.update(sessions).set({ mergeRevision: 2 }).run();
  expect(await loadPendingWorkoutControl('workout')).not.toBeNull();
  mockRpc.mockImplementation(async () => {
    mockDatabase.update(sessions).set({ loggingClientId: null, loggingGrantedAt: null, mergeRevision: 3 }).run();
    return {};
  });
  await changeWorkoutControl('workout', null);
  expect(() => assertWorkoutWritable(mockDatabase, 'workout')).not.toThrow();
  expect(mockDatabase.select().from(sessions).get()).toMatchObject({ status: 'completed', startedAt: start, completedAt: end, durationSec: 2 });
});

it('refuses transfer with any unsynced child, including a quarantined row, and does not cross an account switch', async () => {
  mockDatabase.update(exerciseSets).set({ localDirty: true }).where(eq(exerciseSets.id, 'set')).run();
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/pending changes/);
  mockDatabase.update(exerciseSets).set({ localDirty: false }).run();
  mockCycle.mockImplementationOnce(async () => { mockOwner = 'other'; return 'converged'; });
  await expect(changeWorkoutControl('workout', agent)).rejects.toThrow(/account changed/);
  expect(mockRpc).not.toHaveBeenCalled();
});
