/**
 * Regression: an empty local SQLite database that connects to a remote account
 * already holding personal gyms must restore those gyms into the local `gyms`
 * table on the first authenticated sync.
 *
 * This is the concrete bug behind the M13 sync-restore/FK-hardening series
 * (task cards T-20260606-01..05): a reinstalled or fresh device starts with no
 * local rows, signs in, and must end up holding the user's remote gyms locally
 * — otherwise the recorder can never surface them.
 *
 * Scope of THIS test (the data/sync layer): prove the authenticated sync cycle
 * drains the remote layer-0 gyms into local SQLite, clean, with the data shape
 * the gym picker will read (id + name, non-deleted). The cycle's only outbound
 * dependency is the Supabase RPC, stubbed here exactly as the rest of the
 * stubbed-cycle suite does, so this runs in the fast lane with no live endpoint.
 *
 * Explicitly OUT of scope here (deferred to T-20260517-01-personal-gym-list-sync):
 * the recorder gym picker today seeds its list from the hardcoded
 * `SEEDED_LOCATIONS` constant and never lists the local `gyms` table, so even a
 * correctly-restored gym is not yet displayed. Wiring the picker to read this
 * table (a `listLocalGyms` repository surface + recorder hydration) is the whole
 * deliverable of that still-planned card. This test asserts the data is present
 * and queryable for that wiring; the picker-visibility assertion lands with
 * T-20260517-01. See docs/tasks/T-20260606-06-...-final-verification.md.
 */

import { asc, eq, isNull } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests } from '@/src/data/clock';
import { gyms } from '@/src/data/schema';
import {
  __resetAuthRequiredSignalForTests,
  getAuthRequiredSignal,
} from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

const mockRpc = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const emptyPage = { entities: [], next_cursor: null, has_more: false };
const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};

const remoteGym = (id: string, name: string, ms: number) => ({
  type: 'gyms',
  id,
  client_updated_at_ms: ms,
  fields: {
    name,
    latitude: null,
    longitude: null,
    coordinate_accuracy_m: null,
    coordinates_updated_at: null,
    created_at: ms,
    updated_at: ms,
    deleted_at: null,
  },
});

const REMOTE_GYMS = [
  remoteGym('gym-remote-1', 'Iron Temple', 100),
  remoteGym('gym-remote-2', 'Westside Barbell', 101),
  remoteGym('gym-remote-3', 'Strength Lab', 102),
];

describe('empty local DB restores remote gyms on first authenticated sync', () => {
  it('drains the remote layer-0 gyms into local SQLite, clean and queryable', async () => {
    // The store starts empty: a fresh install / reinstall before its first sync.
    expect(database.select().from(gyms).all()).toHaveLength(0);

    // The remote account already holds the user's gyms. Serve them on the first
    // layer-0 pull; every later pull is empty and every push acks. (The fresh,
    // never-bootstrapped store runs the first-sign-in bootstrapper, whose full
    // pull absorbs this page before the convergence loop.)
    let servedGyms = false;
    mockRpc.mockImplementation(async (name: string, args: { layer?: number }) => {
      if (name === 'sync_pull') {
        if (args.layer === 0 && !servedGyms) {
          servedGyms = true;
          return {
            data: {
              entities: REMOTE_GYMS,
              next_cursor: {
                server_received_at: '2026-05-29T10:00:00.000Z',
                owner_user_id: 'u',
                type: 'gyms',
                id: 'gym-remote-3',
              },
              has_more: false,
            },
            error: null,
          };
        }
        return { data: emptyPage, error: null };
      }
      return pushOk;
    });

    await expect(runSyncCycle()).resolves.toBe('converged');

    // An authenticated, converged cycle does not raise the route-to-sign-in
    // signal.
    expect(getAuthRequiredSignal()).toBe(false);

    // The picker reads active gyms (id + name, non-deleted) ordered by name.
    // This is exactly the row shape T-20260517-01 will hydrate the picker from;
    // assert all three remote gyms are now present, clean, and undeleted.
    const restored = database
      .select({
        id: gyms.id,
        name: gyms.name,
        localDirty: gyms.localDirty,
      })
      .from(gyms)
      .where(isNull(gyms.deletedAt))
      .orderBy(asc(gyms.name))
      .all();

    expect(restored).toEqual([
      { id: 'gym-remote-1', name: 'Iron Temple', localDirty: false },
      { id: 'gym-remote-3', name: 'Strength Lab', localDirty: false },
      { id: 'gym-remote-2', name: 'Westside Barbell', localDirty: false },
    ]);

    // None of the remote rows were re-marked dirty (nothing to push back).
    expect(
      database.select().from(gyms).where(eq(gyms.localDirty, true)).all(),
    ).toHaveLength(0);
  });
});
