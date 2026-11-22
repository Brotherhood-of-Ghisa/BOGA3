import { AppState, type AppStateStatus } from 'react-native';
import { __resetBodyWeightImportForTests, __setBodyWeightImportDepsForTests, disableBodyWeightImport,
  enableBodyWeightImport, getBodyWeightImportSnapshot, importBodyWeightsNow,
  startBodyWeightImportLifecycle } from '@/src/health-import/bodyweight-lifecycle';
import { bodyWeightImportStore } from '@/src/health-import/bodyweight-storage';
import type { runBodyWeightImport } from '@/src/health-import/bodyweight-importer';

const mockAuth = { id: 'owner' as string | null, listeners: new Set<() => void>() };
const mockResetListeners = new Set<() => void>();
const mockGate = { bootstrapCompletedAt: null as Date | null, listeners: new Set<() => void>() };
jest.mock('@/src/auth/service', () => ({
  getAuthSnapshot: () => ({ user: mockAuth.id ? { id: mockAuth.id } : null }),
  subscribeToAuthState: (listener: () => void) => {
    mockAuth.listeners.add(listener); return () => { mockAuth.listeners.delete(listener); };
  },
}));
jest.mock('@/src/sync/account-wipe', () => ({
  subscribeToLocalDataReset: (listener: () => void) => {
    mockResetListeners.add(listener); return () => { mockResetListeners.delete(listener); };
  },
}));
jest.mock('@/src/sync/sync-gate-state', () => ({
  getSyncGateStateSnapshot: () => mockGate,
  subscribeToSyncGateState: (listener: () => void) => {
    mockGate.listeners.add(listener); return () => { mockGate.listeners.delete(listener); };
  },
}));
let foreground: ((state: AppStateStatus) => void) | null = null;
const now = new Date('2026-11-22T12:00:00.123Z');
const authorize = jest.fn(async (): Promise<void> => undefined);
const run = jest.fn(async (_input: Parameters<typeof runBodyWeightImport>[0]) => true);
const setup = (supported = true) => {
  __setBodyWeightImportDepsForTests({ now: () => now, run,
    adapter: () => ({ supported, requestAuthorization: authorize,
      readChanges: async () => ({ samples: [], deletedIds: [], newAnchor: 'next' }) }),
  });
  return startBodyWeightImportLifecycle();
};
beforeEach(() => {
  __resetBodyWeightImportForTests(); mockAuth.id = 'owner'; mockAuth.listeners.clear();
  mockResetListeners.clear(); mockGate.listeners.clear(); mockGate.bootstrapCompletedAt = null;
  authorize.mockReset().mockResolvedValue(undefined); run.mockReset().mockResolvedValue(true);
  bodyWeightImportStore.write('owner', { enabled: false, since: null, anchor: null });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener as (state: AppStateStatus) => void;
    return { remove: () => { foreground = null; } } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => { __resetBodyWeightImportForTests(); jest.restoreAllMocks(); });

it('starts disabled and captures the first enable instant, retaining it across disable/re-enable', async () => {
  setup(); await importBodyWeightsNow(); expect(run).not.toHaveBeenCalled();
  await enableBodyWeightImport();
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(bodyWeightImportStore.read('owner')).toEqual({ enabled: true, since: now.toISOString(), anchor: null });
  expect(getBodyWeightImportSnapshot()).toMatchObject({ enabled: true, enabling: false, busy: false, error: null });
  disableBodyWeightImport();
  __setBodyWeightImportDepsForTests({ now: () => new Date(now.getTime() + 60_000) });
  await enableBodyWeightImport();
  expect(bodyWeightImportStore.read('owner').since).toBe(now.toISOString());
});

it('foreground and first-sync completion retry the import independently of workouts', async () => {
  setup(); await enableBodyWeightImport(); run.mockClear();
  foreground?.('active'); await importBodyWeightsNow();
  expect(run).toHaveBeenCalled(); run.mockClear();
  mockGate.bootstrapCompletedAt = now;
  for (const listener of mockGate.listeners) listener();
  await importBodyWeightsNow(); expect(run).toHaveBeenCalled();
});

it('keeps failures visible until success and handles permission failures without enabling', async () => {
  setup(); authorize.mockRejectedValueOnce(new Error('permission sheet failed'));
  await enableBodyWeightImport();
  expect(getBodyWeightImportSnapshot()).toMatchObject({ enabled: false, error: 'Apple Health could not be opened.' });
  run.mockRejectedValueOnce(new Error('read failed'));
  await enableBodyWeightImport();
  expect(getBodyWeightImportSnapshot().error).toContain('could not be imported');
  await importBodyWeightsNow(); expect(getBodyWeightImportSnapshot().error).toBeNull();
});

it('cancels in-flight writes and clears only the cursor on reset or account switch', async () => {
  setup(); await enableBodyWeightImport();
  bodyWeightImportStore.write('owner', { ...bodyWeightImportStore.read('owner'), anchor: 'old' });
  for (const listener of mockResetListeners) listener();
  expect(bodyWeightImportStore.read('owner')).toMatchObject({ anchor: null, since: now.toISOString() });
  const input = run.mock.calls.at(-1)?.[0] as { isCurrent: () => boolean };
  expect(input.isCurrent()).toBe(false);
  mockAuth.id = 'other';
  for (const listener of mockAuth.listeners) listener();
  await importBodyWeightsNow();
  expect(getBodyWeightImportSnapshot()).toMatchObject({ enabled: false, signedIn: true });
});

it('cannot enable on Android or while signed out', async () => {
  setup(false); await enableBodyWeightImport(); expect(authorize).not.toHaveBeenCalled();
  mockAuth.id = null;
  for (const listener of mockAuth.listeners) listener();
  await enableBodyWeightImport(); expect(run).not.toHaveBeenCalled();
});

it('a database reset cancels a pending permission prompt and leaves retry available', async () => {
  setup();
  let finish!: () => void;
  authorize.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const enabling = enableBodyWeightImport();
  expect(getBodyWeightImportSnapshot().enabling).toBe(true);
  for (const listener of mockResetListeners) listener();
  finish(); await enabling;
  expect(getBodyWeightImportSnapshot()).toMatchObject({ enabled: false, enabling: false, busy: false });
  await enableBodyWeightImport();
  expect(getBodyWeightImportSnapshot().enabled).toBe(true);
});
