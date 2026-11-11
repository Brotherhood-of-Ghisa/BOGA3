import { AppState } from 'react-native';

import { getAuthSnapshot, subscribeToAuthState } from '@/src/auth/service';
import { logEvent } from '@/src/logging';

import { healthImportApi, type HealthImportApi } from './api';
import { runHealthImport } from './importer';
import { HealthImportError } from './mapping';
import { getHealthStoreAdapter } from './native-adapter';
import { healthImportStore, type HealthImportStore } from './storage';

// The Apple Health import's state and triggers: on enabling (once the
// permission sheet closes) and on every app foreground while enabled. The
// switch is the person's choice in the app only; iOS never says whether
// reading was allowed, so nothing here claims a verified connection.

export type HealthImportSnapshot = {
  supported: boolean;
  signedIn: boolean;
  enabled: boolean;
  busy: boolean;
  /** The permission sheet is open or the first import is starting: the switch waits. */
  enabling: boolean;
  /** The last import's or enable's failure, until the next one succeeds; never a fake success. */
  error: string | null;
};

const initial = (): HealthImportSnapshot => ({
  supported: false, signedIn: false, enabled: false, busy: false, enabling: false, error: null,
});
let state = initial();
let deps: { api: HealthImportApi; store: HealthImportStore; now: () => Date } = {
  api: healthImportApi, store: healthImportStore, now: () => new Date(),
};
let accountRevision = 0;
/** Bumped by every turn on or off, so a run started before it can neither write nor report. */
let switchGeneration = 0;
let currentUserId: string | null = null;
let inFlight: Promise<void> | null = null;
let rerunQueued = false;
const listeners = new Set<() => void>();

const publish = (next: Partial<HealthImportSnapshot>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
export const getHealthImportSnapshot = (): HealthImportSnapshot => state;
export const subscribeHealthImport = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const failureMessage = (error: unknown): string => {
  if (error instanceof HealthImportError && error.code === 'READ_FAILED') return 'Apple Health could not be read.';
  if (error instanceof HealthImportError && error.code === 'INVALID_WORKOUT') return 'A workout could not be imported.';
  if (error instanceof HealthImportError && error.code === 'AUTH_REQUIRED') return 'Sign in again to send workouts.';
  return 'Workouts could not be sent.';
};

/** Follows the signed-in account. A change of account (or signing out) discards the saved anchor. */
const syncAccount = (): void => {
  const userId = getAuthSnapshot().user?.id ?? null;
  if (userId === currentUserId) return;
  if (currentUserId !== null) deps.store.clearAnchor();
  currentUserId = userId;
  accountRevision += 1;
  rerunQueued = false;
  const adapter = getHealthStoreAdapter();
  publish({
    supported: adapter.supported,
    signedIn: userId !== null,
    enabled: userId !== null && deps.store.readEnabled(userId),
    busy: false,
    enabling: false,
    error: null,
  });
};

const importOnce = async (): Promise<void> => {
  const userId = currentUserId;
  const adapter = getHealthStoreAdapter();
  if (userId === null || !adapter.supported || !deps.store.readEnabled(userId)) return;
  const revision = accountRevision;
  const generation = switchGeneration;
  const isCurrent = () => revision === accountRevision && generation === switchGeneration && deps.store.readEnabled(userId);
  publish({ busy: true });
  try {
    const outcome = await runHealthImport({ userId, adapter, api: deps.api, store: deps.store, now: deps.now(), isCurrent });
    if (outcome.status === 'imported' && isCurrent()) {
      publish({ error: null });
      void logEvent({ level: 'info', event: 'health_import.completed', userId,
        context: { backfill: outcome.backfill, upserted: outcome.upserted, deleted: outcome.deleted, pruned: outcome.pruned } });
    }
  } catch (error) {
    if (!isCurrent()) return;
    publish({ error: failureMessage(error) });
    void logEvent({ level: 'warn', event: 'health_import.failed', userId,
      message: error instanceof Error ? error.message : String(error),
      context: { code: error instanceof HealthImportError ? error.code : 'UNKNOWN' } });
  } finally {
    if (revision === accountRevision) publish({ busy: false });
  }
};

/** Runs one import, or queues one more behind the import already running. */
export const importHealthActivitiesNow = (): Promise<void> => {
  if (inFlight) { rerunQueued = true; return inFlight; }
  inFlight = (async () => {
    try {
      do {
        rerunQueued = false;
        await importOnce();
      } while (rerunQueued);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

/** Turns the import on: shows the permission sheet, then imports (a 90-day backfill the first time). */
export const enableHealthImport = async (): Promise<void> => {
  syncAccount();
  const userId = currentUserId;
  const adapter = getHealthStoreAdapter();
  if (userId === null || !adapter.supported || state.enabling) return;
  const revision = accountRevision;
  switchGeneration += 1;
  const generation = switchGeneration;
  publish({ enabling: true, error: null });
  try {
    await adapter.requestAuthorization();
  } catch (error) {
    if (revision === accountRevision && generation === switchGeneration) {
      publish({ enabling: false, error: 'Apple Health could not be opened.' });
    }
    void logEvent({ level: 'warn', event: 'health_import.authorization_failed', userId,
      message: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (revision !== accountRevision || generation !== switchGeneration) return;
  deps.store.writeEnabled(userId, true);
  publish({ enabled: true, enabling: false });
  await importHealthActivitiesNow();
};

/** Turns the import off. Imported activities stay on the server; turning it back on backfills afresh. */
export const disableHealthImport = (): void => {
  syncAccount();
  if (currentUserId === null) return;
  switchGeneration += 1;
  deps.store.writeEnabled(currentUserId, false);
  deps.store.clearAnchor();
  rerunQueued = false;
  publish({ enabled: false, enabling: false, error: null });
};

let stopLifecycle: (() => void) | null = null;
export const startHealthImportLifecycle = (): (() => void) => {
  if (stopLifecycle) return stopLifecycle;
  syncAccount();
  const stopAuth = subscribeToAuthState(() => {
    const before = currentUserId;
    syncAccount();
    if (currentUserId !== null && currentUserId !== before) void importHealthActivitiesNow();
  });
  // A foreground while an import runs (the launch's own 'active') adds nothing new to read.
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active' && !inFlight) void importHealthActivitiesNow();
  });
  void importHealthActivitiesNow();
  stopLifecycle = () => { stopAuth(); appState.remove(); stopLifecycle = null; };
  return stopLifecycle;
};

export const __setHealthImportDepsForTests = (next: Partial<typeof deps>): void => {
  deps = { ...deps, ...next };
};
export const __resetHealthImportForTests = (): void => {
  stopLifecycle?.();
  state = initial();
  deps = { api: healthImportApi, store: healthImportStore, now: () => new Date() };
  accountRevision = 0;
  switchGeneration = 0;
  currentUserId = null;
  inFlight = null;
  rerunQueued = false;
  listeners.clear();
};
