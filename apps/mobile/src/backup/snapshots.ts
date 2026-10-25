// Database snapshots: whole-file copies of the local SQLite database, kept on
// the device so training data survives a wipe, a bad migration or a sync bug.
// This module owns the rules (names, retention, when one is due); the device
// adapters (files, SQLite, share sheet) are injected so Jest runs it against a
// real SQLite file in a temporary directory.

/** Snapshots kept on the device; the oldest go first. */
export const SNAPSHOT_RETENTION = 30;

/** A launch or return to the app takes a snapshot when the newest is older. */
export const SCHEDULED_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_PREFIX = 'boga-backup-';
const SNAPSHOT_EXTENSION = '.db';
// A snapshot is written under this suffix and renamed when complete, so a
// copy cut short (the app killed mid-write) is never mistaken for a snapshot.
const PARTIAL_SUFFIX = '.partial';
// boga-backup-20261025-140309-123Z.db: UTC, so names sort by time.
const SNAPSHOT_NAME = /^boga-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})Z\.db$/;

/** The snapshot directory, as the device adapter exposes it. */
export type SnapshotStore = {
  /** Creates the directory if it is missing. */
  ensure(): void;
  /** File names in the directory. */
  list(): string[];
  /** The absolute file-system path (no `file://`) SQLite writes to. */
  pathOf(name: string): string;
  /** The URI the share sheet takes. */
  uriOf(name: string): string;
  rename(from: string, to: string): void;
  remove(name: string): void;
};

export type SnapshotDeps = {
  store: SnapshotStore;
  /** Writes a consistent copy of the live database to `path` (`VACUUM INTO`). */
  copyDatabaseTo(path: string): Promise<void>;
  now(): Date;
};

export type Snapshot = { name: string; takenAtMs: number };

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export const snapshotFileName = (at: Date): string =>
  `${SNAPSHOT_PREFIX}${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
  `-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}` +
  `-${pad(at.getUTCMilliseconds(), 3)}Z${SNAPSHOT_EXTENSION}`;

/** When the snapshot `name` was taken, or `null` for any other file. */
export const snapshotTakenAtMs = (name: string): number | null => {
  const match = SNAPSHOT_NAME.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second, ms] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second, ms);
};

/** The directory's snapshots, newest first. */
export const listSnapshots = (store: SnapshotStore): Snapshot[] =>
  store
    .list()
    .flatMap((name) => {
      const takenAtMs = snapshotTakenAtMs(name);
      return takenAtMs === null ? [] : [{ name, takenAtMs }];
    })
    .sort((a, b) => b.takenAtMs - a.takenAtMs);

export const isSnapshotDue = (newest: Snapshot | undefined, nowMs: number): boolean =>
  newest === undefined || nowMs - newest.takenAtMs >= SCHEDULED_SNAPSHOT_INTERVAL_MS;

/**
 * Deletes snapshots beyond the newest `keep`, and partial copies left by an
 * interrupted write. Other files in the directory are left alone.
 */
export const pruneSnapshots = (store: SnapshotStore, keep = SNAPSHOT_RETENTION): void => {
  for (const name of store.list()) {
    if (name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(PARTIAL_SUFFIX)) store.remove(name);
  }
  for (const stale of listSnapshots(store).slice(keep)) store.remove(stale.name);
};

/** Takes a snapshot now, then prunes to the retention. */
export const takeSnapshot = async ({ store, copyDatabaseTo, now }: SnapshotDeps): Promise<Snapshot> => {
  const takenAt = now();
  const name = snapshotFileName(takenAt);
  const partial = `${name}${PARTIAL_SUFFIX}`;
  store.ensure();
  try {
    await copyDatabaseTo(store.pathOf(partial));
    store.rename(partial, name);
  } catch (error) {
    try {
      store.remove(partial);
    } catch {
      // Nothing written, or not removable now: the next prune retries it.
    }
    throw error;
  }
  pruneSnapshots(store);
  return { name, takenAtMs: takenAt.getTime() };
};

/** Takes a snapshot when the newest is a day old or there is none. */
export const takeSnapshotIfDue = async (deps: SnapshotDeps): Promise<Snapshot | null> => {
  deps.store.ensure();
  return isSnapshotDue(listSnapshots(deps.store)[0], deps.now().getTime()) ? takeSnapshot(deps) : null;
};
