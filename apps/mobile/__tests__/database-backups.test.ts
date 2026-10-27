import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createDatabaseBackups,
  createDocumentsSnapshotStore,
  getDatabaseBackups,
  snapshotAfterSessionCompleted,
  type AppStateSource,
  type ShareClient,
} from '@/src/backup/database-backups';
import {
  SCHEDULED_SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_RETENTION,
  listSnapshots,
  snapshotFileName,
  snapshotTakenAtMs,
  type SnapshotDeps,
} from '@/src/backup/snapshots';
import { __resetLocalDataLayerForTests } from '@/src/data/bootstrap';
import { Platform } from 'react-native';
import { logEvent } from '@/src/logging/logEvent';

// The real module (jest.setup.ts stubs it for every other suite), over a
// temporary Documents directory and a real SQLite database.
jest.unmock('@/src/backup/database-backups');

let mockDocuments = '';
let mockDatabase: Database.Database;
let mockOwner: string | null = null;
let mockAfterExportCopy: (() => void) | null = null;

// expo-file-system's Directory/File over node's fs, rooted at `mockDocuments`.
jest.mock('expo-file-system', () => {
  const nodeFs = jest.requireActual<typeof import('node:fs')>('node:fs');
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path');
  const pathOf = (parent: { path: string } | string, name: string) =>
    nodePath.join(typeof parent === 'string' ? parent : parent.path, name);
  class Directory {
    path: string;
    constructor(parent: { path: string } | string, name: string) {
      this.path = pathOf(parent, name);
    }
    get uri() {
      return `file://${encodeURI(this.path)}`;
    }
    create(options: { intermediates?: boolean; idempotent?: boolean }) {
      if (options.idempotent && nodeFs.existsSync(this.path)) return;
      nodeFs.mkdirSync(this.path, { recursive: options.intermediates });
    }
    list() {
      return nodeFs.readdirSync(this.path).map((name: string) => ({ name }));
    }
  }
  class File {
    path: string;
    constructor(parent: { path: string }, name: string) {
      this.path = pathOf(parent, name);
    }
    get uri() {
      return `file://${encodeURI(this.path)}`;
    }
    rename(name: string) {
      nodeFs.renameSync(this.path, nodePath.join(nodePath.dirname(this.path), name));
    }
    delete() {
      nodeFs.unlinkSync(this.path);
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return { path: mockDocuments };
      },
    },
  };
});

// Exercise the production export SQL over real SQLite, including VACUUM's free-page cleanup.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (name: string, _options: unknown, directory: string) => {
    const Sqlite = jest.requireActual('better-sqlite3');
    const db = name === 'scaffolding-local.db' ? mockDatabase : new Sqlite(require('node:path').join(directory, name));
    return {
      execSync: (sql: string) => db.exec(sql),
      getFirstSync: (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params),
      runAsync: async (sql: string, ...params: unknown[]) => {
        const result = db.prepare(sql).run(...params); mockAfterExportCopy?.(); return result;
      },
      runSync: (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params),
      closeSync: () => db.close(),
    };
  },
}));
jest.mock('@/src/data/bootstrap', () => jest.requireActual('@/src/data/bootstrap'));
jest.mock('@/src/auth/session-user', () => ({ getSignedInUserId: async () => mockOwner }));
jest.mock('@/src/auth/supabase', () => ({ getMobileAuthRuntimeConfig: () => ({ isConfigured: true }) }));
jest.mock('@/src/sync/account-wipe', () => ({ withLocalDataLock: async (run: () => Promise<unknown>) => run() }));

jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));

const backupsDir = () => path.join(mockDocuments, 'backups');
const files = () => fs.readdirSync(backupsDir()).sort();

const shareClient = (available = true): ShareClient & { shareAsync: jest.Mock } => ({
  isAvailableAsync: jest.fn(async () => available),
  shareAsync: jest.fn(async () => undefined),
});

const appStateSource = () => {
  const listeners = new Set<(status: string) => void>();
  const remove = jest.fn();
  const source: AppStateSource = {
    addEventListener: (_type, listener) => {
      listeners.add(listener as (status: string) => void);
      return {
        remove: () => {
          remove();
          listeners.delete(listener as (status: string) => void);
        },
      };
    },
  };
  return { source, remove, emit: (status: string) => listeners.forEach((listener) => listener(status)) };
};

let clockMs = Date.UTC(2026, 9, 25, 14, 3, 9, 123);

const deviceDeps = (overrides: Partial<SnapshotDeps> = {}): SnapshotDeps => ({
  store: createDocumentsSnapshotStore(),
  copyDatabaseTo: async (target) => {
    await mockDatabase.prepare('VACUUM INTO ?').run(target);
  },
  now: () => new Date(clockMs),
  ...overrides,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  // A space in the path: the store must decode the URI SQLite writes to.
  mockDocuments = fs.mkdtempSync(path.join(os.tmpdir(), 'boga backups '));
  mockDatabase = new Database(':memory:');
  __resetLocalDataLayerForTests();
  mockOwner = null; mockAfterExportCopy = null;
  mockDatabase.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('s1'), ('s2');
    CREATE TABLE sync_runtime_state(id TEXT PRIMARY KEY, account_user_id TEXT);
    INSERT INTO sync_runtime_state VALUES('primary', null);
    CREATE TABLE exercise_merge_local(owner_user_id TEXT, payload TEXT);`);
  clockMs = Date.UTC(2026, 9, 25, 14, 3, 9, 123);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
  mockDatabase.close();
  fs.rmSync(mockDocuments, { recursive: true, force: true });
});

describe('snapshot names', () => {
  it('names a snapshot by its UTC instant and reads the instant back', () => {
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    expect(snapshotFileName(at)).toBe('boga-backup-20260102-030405-006Z.db');
    expect(snapshotTakenAtMs(snapshotFileName(at))).toBe(at.getTime());
  });

  it.each(['notes.txt', 'boga-backup-20260102-030405-006Z.db.partial', 'boga-backup-2026.db'])(
    'does not take %s for a snapshot',
    (name) => {
      expect(snapshotTakenAtMs(name)).toBeNull();
    },
  );
});

describe('taking a snapshot', () => {
  it('writes a readable copy of the database under Documents/backups', async () => {
    const backups = createDatabaseBackups(deviceDeps());
    const snapshot = await backups.snapshotNow('export');

    expect(files()).toEqual(['boga-backup-20261025-140309-123Z.db']);
    expect(snapshot).toEqual({ name: 'boga-backup-20261025-140309-123Z.db', takenAtMs: clockMs });
    const copy = new Database(path.join(backupsDir(), snapshot.name), { readonly: true });
    expect(copy.prepare('SELECT id FROM sessions ORDER BY id').all()).toEqual([{ id: 's1' }, { id: 's2' }]);
    copy.close();
  });

  it('copies through the app database', async () => {
    const backups = getDatabaseBackups();
    await backups.snapshotNow('export');
    const [name] = files();
    const copy = new Database(path.join(backupsDir(), name), { readonly: true });
    expect(copy.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    copy.close();
  });

  it('keeps the newest 30, leaving other files alone', async () => {
    const backups = createDatabaseBackups(deviceDeps());
    fs.mkdirSync(backupsDir());
    fs.writeFileSync(path.join(backupsDir(), 'notes.txt'), 'mine');
    for (let i = 0; i < SNAPSHOT_RETENTION + 2; i += 1) {
      await backups.snapshotNow('session-completed');
      clockMs += 60_000;
    }

    const kept = listSnapshots(createDocumentsSnapshotStore());
    expect(kept).toHaveLength(SNAPSHOT_RETENTION);
    expect(kept[0].takenAtMs).toBe(clockMs - 60_000);
    expect(kept.at(-1)?.takenAtMs).toBe(clockMs - 60_000 * SNAPSHOT_RETENTION);
    expect(files()).toContain('notes.txt');
  });

  it('removes a partial copy left by an interrupted write on the next snapshot', async () => {
    fs.mkdirSync(backupsDir());
    fs.writeFileSync(path.join(backupsDir(), 'boga-backup-20261024-000000-000Z.db.partial'), 'cut short');

    await createDatabaseBackups(deviceDeps()).snapshotNow('export');

    expect(files()).toEqual(['boga-backup-20261025-140309-123Z.db']);
  });

  it('leaves no file and logs the failure when the copy fails', async () => {
    const backups = createDatabaseBackups(
      deviceDeps({
        copyDatabaseTo: async (target) => {
          fs.writeFileSync(target, 'half');
          throw new Error('disk full');
        },
      }),
    );

    await expect(backups.snapshotNow('session-completed')).rejects.toThrow('disk full');
    expect(files()).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'database_snapshot_failed',
        message: 'disk full',
        context: { reason: 'session-completed' },
      }),
    );
  });

  it('runs one copy at a time', async () => {
    let running = 0;
    let overlapped = false;
    const backups = createDatabaseBackups(
      deviceDeps({
        copyDatabaseTo: async (target) => {
          running += 1;
          overlapped ||= running > 1;
          await flush();
          await mockDatabase.prepare('VACUUM INTO ?').run(target);
          running -= 1;
        },
        now: () => new Date((clockMs += 1)),
      }),
    );

    await Promise.all([backups.snapshotNow('export'), backups.snapshotNow('session-completed')]);

    expect(overlapped).toBe(false);
    expect(files()).toHaveLength(2);
  });

  it('tells subscribers after each snapshot', async () => {
    const backups = createDatabaseBackups(deviceDeps());
    const listener = jest.fn();
    const unsubscribe = backups.subscribe(listener);
    await backups.snapshotNow('export');
    unsubscribe();
    clockMs += 1;
    await backups.snapshotNow('export');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('the schedule', () => {
  it('takes one when there is none, then waits a day', async () => {
    const backups = createDatabaseBackups(deviceDeps());

    expect(await backups.snapshotIfDue()).not.toBeNull();
    clockMs += SCHEDULED_SNAPSHOT_INTERVAL_MS - 1;
    expect(await backups.snapshotIfDue()).toBeNull();
    clockMs += 1;
    expect(await backups.snapshotIfDue()).not.toBeNull();
    expect(files()).toHaveLength(2);
  });

  it('checks on start and on each return to the foreground until stopped', async () => {
    const appState = appStateSource();
    const backups = createDatabaseBackups(deviceDeps(), { appState: appState.source });

    const stop = backups.start();
    await flush();
    expect(files()).toHaveLength(1);

    clockMs += SCHEDULED_SNAPSHOT_INTERVAL_MS;
    appState.emit('background');
    await flush();
    expect(files()).toHaveLength(1);
    appState.emit('active');
    await flush();
    expect(files()).toHaveLength(2);

    stop();
    expect(appState.remove).toHaveBeenCalledTimes(1);
    clockMs += SCHEDULED_SNAPSHOT_INTERVAL_MS;
    appState.emit('active');
    await flush();
    expect(files()).toHaveLength(2);
  });

  it('does not throw from start when the snapshot fails', async () => {
    const appState = appStateSource();
    const backups = createDatabaseBackups(
      deviceDeps({
        copyDatabaseTo: async () => {
          throw new Error('locked');
        },
      }),
      { appState: appState.source },
    );

    backups.start();
    await flush();

    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ context: { reason: 'scheduled' } }));
  });
});

describe('export', () => {
  it('shares a temporary SQLite export and keeps the emergency snapshot', async () => {
    const share = shareClient();
    const backups = createDatabaseBackups(deviceDeps(), { share });

    await backups.exportDatabase();

    const [name] = files();
    expect(share.shareAsync).toHaveBeenCalledWith(`file://${encodeURI(path.join(backupsDir(), name + '.export'))}`, {
      dialogTitle: 'Export BOGA database',
      mimeType: 'application/vnd.sqlite3',
      UTI: 'public.database',
    });
  });

  it('never shares another account recovery payload, even in freed pages, and preserves local recovery', async () => {
    mockOwner = 'account-b';
    mockDatabase.prepare('UPDATE sync_runtime_state SET account_user_id = ?').run(mockOwner);
    const secret = 'ACCOUNT_A_PRIVATE_SAVED_EDIT_' + 'x'.repeat(9000);
    mockDatabase.prepare('INSERT INTO exercise_merge_local VALUES(?,?)').run('account-a', secret);
    mockDatabase.prepare('INSERT INTO exercise_merge_local VALUES(?,?)').run('account-b', 'B_SAVED_EDIT');
    const share = shareClient();
    share.shareAsync.mockImplementation(async (uri: string) => {
      const target = decodeURI(uri.replace('file://', ''));
      const exported = new Database(target);
      expect(exported.prepare('SELECT * FROM exercise_merge_local').all()).toEqual([
        { owner_user_id: 'account-b', payload: 'B_SAVED_EDIT' },
      ]);
      exported.close();
      expect(fs.readFileSync(target).includes(Buffer.from('ACCOUNT_A_PRIVATE_SAVED_EDIT'))).toBe(false);
    });
    await createDatabaseBackups(deviceDeps(), { share }).exportDatabase();
    expect(mockDatabase.prepare('SELECT count(*) AS n FROM exercise_merge_local').get()).toEqual({ n: 2 });
    const snapshot = new Database(path.join(backupsDir(), files()[0]));
    expect(snapshot.prepare('SELECT count(*) AS n FROM exercise_merge_local').get()).toEqual({ n: 2 });
    snapshot.close();
    expect(files()).toHaveLength(1);
  });

  it('refuses an export while the signed-in and local owners differ', async () => {
    mockOwner = 'new-account';
    const share = shareClient();
    await expect(createDatabaseBackups(deviceDeps(), { share }).exportDatabase()).rejects.toThrow(/finish syncing/);
    expect(share.shareAsync).not.toHaveBeenCalled();
    expect(files()).toHaveLength(1);
  });

  it('removes the temporary file after share cancellation or failure', async () => {
    const share = shareClient();
    share.shareAsync.mockRejectedValue(new Error('cancelled'));
    await expect(createDatabaseBackups(deviceDeps(), { share }).exportDatabase()).rejects.toThrow('cancelled');
    expect(files()).toHaveLength(1);
  });

  it('does not share a prepared copy if the account changes before the share sheet opens', async () => {
    mockOwner = 'a';
    mockDatabase.prepare('UPDATE sync_runtime_state SET account_user_id = ?').run(mockOwner);
    mockAfterExportCopy = () => { mockOwner = 'b'; };
    const share = shareClient();
    await expect(createDatabaseBackups(deviceDeps(), { share }).exportDatabase()).rejects.toThrow(/account changed/);
    expect(share.shareAsync).not.toHaveBeenCalled();
    expect(files().some(name => name.endsWith('.export'))).toBe(false);
  });

  it('keeps Android FileProvider exports readable after choosing a recipient and purges them after a day', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const share = shareClient();
    const backups = createDatabaseBackups(deviceDeps(), { share });
    await backups.exportDatabase();
    const shared = decodeURI(share.shareAsync.mock.calls[0][0].replace('file://', ''));
    expect(fs.existsSync(shared)).toBe(true);
    const copy = new Database(shared);
    expect(copy.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    copy.close();
    clockMs += 24 * 60 * 60 * 1000 + 1;
    const stop = backups.start(); await flush(); stop();
    expect(fs.existsSync(shared)).toBe(false);
  });

  it('fails without a snapshot when sharing is unavailable' , async () => {
    const share = shareClient(false);
    const backups = createDatabaseBackups(deviceDeps(), { share });

    await expect(backups.exportDatabase()).rejects.toThrow('Sharing is unavailable on this device.');
    expect(backups.list()).toEqual([]);
    expect(share.shareAsync).not.toHaveBeenCalled();
  });
});

it('a snapshot after a finished workout never throws', async () => {
  mockDatabase.close();
  expect(() => snapshotAfterSessionCompleted()).not.toThrow();
  await flush();
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'database_snapshot_failed', context: { reason: 'session-completed' } }),
  );
  mockDatabase = new Database(':memory:');
});
