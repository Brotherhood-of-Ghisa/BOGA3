import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { getAuthSnapshot, subscribeToAuthState } from '@/src/auth/service';
import { subscribeToLocalDataReset } from '@/src/sync/account-wipe';
import { getSyncGateStateSnapshot, subscribeToSyncGateState } from '@/src/sync/sync-gate-state';
import { runBodyWeightImport } from './bodyweight-importer';
import { bodyWeightImportStore } from './bodyweight-storage';
import { getBodyWeightHealthStoreAdapter } from './native-adapter';
import type { HealthImportSnapshot } from './lifecycle';

const initial = (): HealthImportSnapshot => ({ supported: false, signedIn: false, enabled: false,
  busy: false, enabling: false, error: null });
let state = initial();
let userId: string | null = null;
let generation = 0;
let inFlight: Promise<void> | null = null;
let queued = false;
let stopLifecycle: (() => void) | null = null;
let deps = { store: bodyWeightImportStore, adapter: getBodyWeightHealthStoreAdapter,
  run: runBodyWeightImport, now: () => new Date() };
const listeners = new Set<() => void>();
const publish = (patch: Partial<HealthImportSnapshot>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
export const getBodyWeightImportSnapshot = (): HealthImportSnapshot => state;
export const subscribeBodyWeightImport = (listener: () => void): (() => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export const useBodyWeightImport = (): HealthImportSnapshot => useSyncExternalStore(
  subscribeBodyWeightImport, getBodyWeightImportSnapshot, getBodyWeightImportSnapshot,
);
const clearAnchor = () => {
  if (userId !== null) deps.store.write(userId, { ...deps.store.read(userId), anchor: null });
};
const syncAccount = () => {
  const next = getAuthSnapshot().user?.id ?? null;
  if (next === userId && state.supported === deps.adapter().supported) return;
  clearAnchor();
  userId = next;
  generation += 1;
  queued = false;
  publish({ ...initial(), supported: deps.adapter().supported, signedIn: next !== null,
    enabled: next !== null && deps.store.read(next).enabled });
};
const importOnce = async () => {
  const owner = userId;
  const revision = generation;
  const adapter = deps.adapter();
  if (owner === null || !adapter.supported || !deps.store.read(owner).enabled) return;
  const isCurrent = () => generation === revision && getAuthSnapshot().user?.id === owner && deps.store.read(owner).enabled;
  publish({ busy: true });
  try {
    const imported = await deps.run({ userId: owner, adapter, store: deps.store, now: deps.now, isCurrent });
    if (imported && isCurrent()) publish({ error: null });
  } catch {
    if (isCurrent()) publish({ error: 'Weight readings could not be imported from Apple Health.' });
  } finally {
    if (generation === revision) publish({ busy: false });
  }
};
export const importBodyWeightsNow = (): Promise<void> => {
  if (inFlight) { queued = true; return inFlight; }
  inFlight = (async () => {
    try {
      do { queued = false; await importOnce(); } while (queued);
    } finally { inFlight = null; }
  })();
  return inFlight;
};
export const enableBodyWeightImport = async (): Promise<void> => {
  syncAccount();
  const owner = userId;
  const adapter = deps.adapter();
  if (owner === null || !adapter.supported || state.enabling) return;
  const revision = ++generation;
  // Capture the choice instant, before the permission sheet; retries retain it.
  const settings = deps.store.read(owner);
  publish({ enabling: true, error: null });
  try {
    deps.store.write(owner, { ...settings, since: settings.since ?? deps.now().toISOString() });
    await adapter.requestAuthorization();
  }
  catch {
    if (generation === revision) publish({ enabling: false, error: 'Apple Health could not be opened.' });
    return;
  }
  if (generation !== revision || getAuthSnapshot().user?.id !== owner) return;
  deps.store.write(owner, { ...deps.store.read(owner), enabled: true });
  publish({ enabled: true, enabling: false });
  await importBodyWeightsNow();
};
export const disableBodyWeightImport = (): void => {
  syncAccount();
  if (userId === null) return;
  generation += 1;
  queued = false;
  deps.store.write(userId, { ...deps.store.read(userId), enabled: false });
  publish({ enabled: false, busy: false, enabling: false, error: null });
};
export const startBodyWeightImportLifecycle = (): (() => void) => {
  if (stopLifecycle) return stopLifecycle;
  syncAccount();
  const stopAuth = subscribeToAuthState(() => { syncAccount(); void importBodyWeightsNow(); });
  const foreground = AppState.addEventListener('change', next => {
    if (next === 'active') void importBodyWeightsNow();
  });
  let ready = getSyncGateStateSnapshot().bootstrapCompletedAt?.getTime() ?? null;
  const stopReset = subscribeToLocalDataReset(() => {
    generation += 1; clearAnchor(); ready = null; publish({ busy: false, enabling: false });
  });
  const stopGate = subscribeToSyncGateState(() => {
    const next = getSyncGateStateSnapshot().bootstrapCompletedAt?.getTime() ?? null;
    if (next !== null && next !== ready) void importBodyWeightsNow();
    ready = next;
  });
  void importBodyWeightsNow();
  stopLifecycle = () => {
    stopAuth(); foreground.remove(); stopReset(); stopGate(); stopLifecycle = null;
  };
  return stopLifecycle;
};
export const __setBodyWeightImportDepsForTests = (next: Partial<typeof deps>): void => { deps = { ...deps, ...next }; };
export const __resetBodyWeightImportForTests = (): void => {
  stopLifecycle?.(); state = initial(); userId = null; generation += 1; inFlight = null; queued = false;
  deps = { store: bodyWeightImportStore, adapter: getBodyWeightHealthStoreAdapter, run: runBodyWeightImport, now: () => new Date() };
  listeners.clear();
};
