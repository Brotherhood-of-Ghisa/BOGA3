/**
 * Bundle-migration → sync push, end-to-end (single-device base case).
 *
 * `runSyncCycle` runs `runBundleMigrations` between the bootstrapper and the
 * convergence loop. A catalog-bundle migration revises/inserts rows through a
 * dirty-routing repo handle, so the migrated rows are supposed to ride the very
 * next push leg to the server. `bundle-migrations.test.ts` proves the loop's
 * ordering/idempotency in isolation; nothing proves the dirtied rows actually
 * make it onto the wire through the real cycle. This closes that seam.
 *
 * A migration that dirtied a row the cycle then failed to push (or a cycle that
 * skipped the migration) would fail here.
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { exerciseDefinitions, syncRuntimeState } from '@/src/data/schema';
import {
  __setBundleMigrationsForTests,
  __setCurrentAppVersionForTests,
} from '@/src/data/bundle-migrations';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

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

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;
let pushedEntities: WireEntity[];

const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};
const emptyPage = { entities: [], next_cursor: null, has_more: false };

const markBootstrapDone = (): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: new Date(1_700_000_000_000) },
    })
    .run();
};

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
  pushedEntities = [];
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (name: string, args: { entities?: WireEntity[] }) => {
    if (name === 'sync_pull') {
      return { data: emptyPage, error: null };
    }
    if (args.entities) {
      pushedEntities.push(...args.entities);
    }
    return pushOk;
  });
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  // Always clear the test-only overrides so a later suite sees the shipped lists.
  __setBundleMigrationsForTests(null);
  __setCurrentAppVersionForTests(null);
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('bundle migration dirties a row that the cycle then pushes', () => {
  it('revises a seeded exercise name and pushes the migrated row to convergence', async () => {
    // A seeded, clean exercise still holding the prior bundle's name.
    database
      .insert(exerciseDefinitions)
      .values({ id: 'seed_squat', name: 'Squat', localDirty: false, localUpdatedAtMs: 100 })
      .run();

    // A future bundle generation revises that name. The repo handle the loop
    // passes dirties the row and stamps the monotonic clock.
    __setBundleMigrationsForTests([
      {
        appVersion: 2,
        apply: (repo) => repo.reviseExerciseDefinitionName('seed_squat', 'Squat', 'Barbell Squat'),
      },
    ]);
    __setCurrentAppVersionForTests(2);

    await expect(runSyncCycle()).resolves.toBe('converged');

    // The migration ran inside the cycle: the local row carries the new name.
    const row = database
      .select({
        name: exerciseDefinitions.name,
        localDirty: exerciseDefinitions.localDirty,
      })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, 'seed_squat'))
      .get();
    expect(row?.name).toBe('Barbell Squat');
    // ...and the migrated row pushed and cleared, rather than staying stuck dirty.
    expect(row?.localDirty).toBe(false);

    const pushed = pushedEntities.filter(
      (entity) => entity.type === 'exercise_definitions' && entity.id === 'seed_squat',
    );
    expect(pushed).toHaveLength(1);
    expect(pushed[0].fields.name).toBe('Barbell Squat');

    // The applied-generation marker advanced so the migration never re-runs.
    const marker = database
      .select({ applied: syncRuntimeState.appliedSeedMigrationAppVersion })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    expect(marker?.applied).toBe(2);
  });
});
