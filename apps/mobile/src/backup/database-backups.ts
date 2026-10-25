import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppState, type AppStateStatus } from 'react-native';

import { copyLocalDatabaseTo } from '@/src/data/bootstrap';
import { logEvent } from '@/src/logging/logEvent';

import {
  listSnapshots,
  takeSnapshot,
  takeSnapshotIfDue,
  type Snapshot,
  type SnapshotDeps,
  type SnapshotStore,
} from './snapshots';

// The device side of database snapshots (rules: `./snapshots.ts`). Snapshots
// live in the app's Documents directory, which iCloud / device backups include
// and the account wipe never touches; Export hands the newest to the share
// sheet. Neither needs a permission.

const BACKUP_DIRECTORY = 'backups';

export type SnapshotReason = 'scheduled' | 'session-completed' | 'export';

export type ShareClient = {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(url: string, options?: { mimeType?: string; UTI?: string; dialogTitle?: string }): Promise<void>;
};

export type AppStateSource = {
  addEventListener(type: 'change', listener: (status: AppStateStatus) => void): { remove(): void };
};

const fileSystemPath = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** The snapshot directory under Documents. */
export const createDocumentsSnapshotStore = (): SnapshotStore => {
  const directory = () => new Directory(Paths.document, BACKUP_DIRECTORY);
  const file = (name: string) => new File(directory(), name);
  return {
    ensure: () => directory().create({ intermediates: true, idempotent: true }),
    list: () => directory().list().map((entry) => entry.name),
    pathOf: (name) => fileSystemPath(file(name).uri),
    uriOf: (name) => file(name).uri,
    rename: (from, to) => file(from).rename(to),
    remove: (name) => file(name).delete(),
  };
};

const deviceSnapshotDeps = (): SnapshotDeps => ({
  store: createDocumentsSnapshotStore(),
  copyDatabaseTo: copyLocalDatabaseTo,
  now: () => new Date(),
});

export type DatabaseBackups = ReturnType<typeof createDatabaseBackups>;

export const createDatabaseBackups = (
  deps: SnapshotDeps,
  { share = Sharing as ShareClient, appState = AppState as AppStateSource } = {},
) => {
  const listeners = new Set<() => void>();
  // One write at a time: a request made while one runs waits for it.
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const record = async <T>(reason: SnapshotReason, run: () => Promise<T>): Promise<T> => {
    try {
      const result = await enqueue(run);
      notify();
      return result;
    } catch (error) {
      void logEvent({
        level: 'warn',
        source: 'database',
        event: 'database_snapshot_failed',
        message: error instanceof Error ? error.message : String(error),
        context: { reason },
      });
      throw error;
    }
  };

  /** Snapshot now, whatever the newest's age. */
  const snapshotNow = (reason: Exclude<SnapshotReason, 'scheduled'>): Promise<Snapshot> =>
    record(reason, () => takeSnapshot(deps));

  const snapshotIfDue = (): Promise<Snapshot | null> => record('scheduled', () => takeSnapshotIfDue(deps));

  /** Snapshots on start and whenever the app comes back to the foreground. */
  const start = (): (() => void) => {
    const runDue = () => {
      snapshotIfDue().catch(() => {
        // Logged in `record`; the next launch or foreground retries.
      });
    };
    runDue();
    const subscription = appState.addEventListener('change', (status) => {
      if (status === 'active') runDue();
    });
    return () => subscription.remove();
  };

  /** Takes a fresh snapshot and opens the share sheet with it. */
  const exportDatabase = async (): Promise<void> => {
    if (!(await share.isAvailableAsync())) {
      throw new Error('Sharing is unavailable on this device.');
    }
    const snapshot = await snapshotNow('export');
    await share.shareAsync(deps.store.uriOf(snapshot.name), {
      dialogTitle: 'Export BOGA database',
      mimeType: 'application/vnd.sqlite3',
      UTI: 'public.database',
    });
  };

  const list = (): Snapshot[] => {
    deps.store.ensure();
    return listSnapshots(deps.store);
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { start, snapshotNow, snapshotIfDue, exportDatabase, list, subscribe };
};

let deviceBackups: DatabaseBackups | null = null;

/** The app's backups over the device's files and database. */
export const getDatabaseBackups = (): DatabaseBackups => {
  deviceBackups ??= createDatabaseBackups(deviceSnapshotDeps());
  return deviceBackups;
};

/**
 * A snapshot after a finished workout. Never throws: a failed snapshot must
 * not fail the completion that asked for it.
 */
export const snapshotAfterSessionCompleted = (): void => {
  getDatabaseBackups()
    .snapshotNow('session-completed')
    .catch(() => {
      // Logged in `record`.
    });
};
