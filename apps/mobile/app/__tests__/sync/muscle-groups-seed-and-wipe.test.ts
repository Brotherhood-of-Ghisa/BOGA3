/* eslint-disable import/first */

/**
 * The muscle-group taxonomy is seeded and wiped through the same generic
 * synced-entity machinery as every other starter-catalog entity — no bespoke
 * muscle-group path remains:
 *
 *   1. `seedSystemExerciseCatalog` writes the muscle-group rows `local_dirty = 1`
 *      (so a fresh account's taxonomy pushes to the server on the next cycle),
 *      gated by the existing applied-version marker.
 *   2. There is no standalone every-boot muscle-group seed: the boot path seeds
 *      the taxonomy only through `seedSystemExerciseCatalog`, and no
 *      `seedMuscleGroups` export survives in the data layer.
 *   3. The local account wipe clears `muscle_groups` like the other eight entity
 *      tables (it is recovered for the next account via the generic first-sign-in
 *      pull) and issues no server delete.
 *   4. Foreign-key enforcement is LIVE before the taxonomy is seeded — the app
 *      opens its SQLite connection with `PRAGMA foreign_keys = ON`, so the pragma
 *      is active across migrations AND seeding, and a post-seed
 *      `PRAGMA foreign_key_check` reports no violations. The seed inserts the
 *      Layer 0 muscle-group parents before the Layer 1 mapping child, so the
 *      enforced FK is satisfied throughout. (The guarantee is that enforcement is
 *      live before seeding, not a specific call site.)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import {
  createBootstrapMockState,
  createClientMockState,
} from '../helpers/sync-cycle-mocks';

// The account wipe resolves its DB handle through `bootstrapLocalDataLayer`;
// point it at the per-test in-memory database. The hoisted factory may only
// close over `mock`-prefixed names.
const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState();

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
);

// Guard rail: a local wipe must never reach for the Supabase client. The factory
// records any call so the test can assert none happened.
jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { type LocalDatabase } from '@/src/data/bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  readSeedsAppliedMarker,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import { muscleGroups, syncRuntimeState } from '@/src/data/schema';
import { wipeLocalForAccountSwitch } from '@/src/sync/account-wipe';

const DATA_DIR = join(__dirname, '..', '..', '..', 'src', 'data');

// `seedSystemExerciseCatalog` is typed against the production `ExpoSQLiteDatabase`
// handle. The better-sqlite3 fixture handle is structurally identical at the
// query-builder level (only the driver `RunResult` generic differs), so a single
// bridging cast keeps the seeder call honest without leaking `any`.
const seedInto = (db: InMemoryTestDatabase): void => {
  seedSystemExerciseCatalog(db as unknown as LocalDatabase);
};

interface ForeignKeyPragmaRow {
  foreign_keys: number;
}
interface ForeignKeyViolationRow {
  table?: string;
}

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

beforeEach(() => {
  // FK enforcement ON — the same as the production expo-sqlite handle, which
  // opens its connection with `PRAGMA foreign_keys = ON`. The seed must satisfy
  // the enforced muscle-group FK on the Layer 1 mapping child.
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockClientState.client = null;
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  mockClientState.client = null;
});

describe('the starter-catalog seed writes muscle_groups dirty and is marker-gated', () => {
  it('seeds every muscle group local_dirty = 1 so a fresh account pushes the taxonomy', () => {
    seedInto(database);

    const rows = database.select().from(muscleGroups).all();
    expect(rows).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(rows.every((row) => row.localDirty === true)).toBe(true);
    // Every seeded group carries a monotonic stamp (> 0) so the push leg can
    // order it; a zero stamp would mean the dirty contract was skipped.
    expect(rows.every((row) => row.localUpdatedAtMs > 0)).toBe(true);
  });

  it('advances the applied-version marker so a second seed is a no-op', () => {
    seedInto(database);
    expect(readSeedsAppliedMarker(database as unknown as LocalDatabase)).toBe(
      SEED_CATALOG_BUNDLE_VERSION,
    );

    // Clear the dirty bits as a push would, then re-seed: the marker gate stops
    // the seeder re-dirtying the unchanged taxonomy on a later launch.
    database.update(muscleGroups).set({ localDirty: false }).run();
    seedInto(database);
    const rows = database.select().from(muscleGroups).all();
    expect(rows.every((row) => row.localDirty === false)).toBe(true);
  });
});

describe('there is no standalone muscle-group boot seed', () => {
  it('exposes no standalone muscle-group seed export from the catalog-seeds module', () => {
    const catalogSeeds = jest.requireActual('@/src/data/exercise-catalog-seeds') as Record<
      string,
      unknown
    >;
    expect(catalogSeeds).not.toHaveProperty('seedMuscleGroups');
    // The generic catalog seeder is the only seed export the boot path uses.
    expect(catalogSeeds).toHaveProperty('seedSystemExerciseCatalog');
  });

  it('routes the boot starter-catalog seed only through the generic catalog seeder', () => {
    // The boot path seeds the whole starter catalog via `seedSystemExerciseCatalog`
    // and nothing else — no separate every-boot muscle-group call.
    const bootstrapSource = readFileSync(join(DATA_DIR, 'bootstrap.ts'), 'utf8');
    expect(bootstrapSource).toContain('seedSystemExerciseCatalog');
    expect(bootstrapSource).not.toMatch(/seedMuscleGroups/);
  });
});

describe('foreign-key enforcement is live before the taxonomy is seeded', () => {
  it('seeds the Layer 0 parents before the Layer 1 mapping child under an enforced FK', () => {
    // Enforcement is live up front (the harness opens with it ON, mirroring the
    // app's connection-open pragma): a row read confirms the pragma is set.
    const pragma = fixture.client.pragma('foreign_keys') as ForeignKeyPragmaRow[];
    expect(pragma[0]?.foreign_keys).toBe(1);

    // The seed inserts the muscle-group parents before the mapping child within
    // one transaction; under enforcement the mapping insert would throw if its
    // muscle-group parent were not already present. A clean seed is the proof.
    expect(() => seedInto(database)).not.toThrow();

    // Post-seed integrity check — the same check boot runs — reports no
    // violations.
    const violations = fixture.client.pragma('foreign_key_check') as ForeignKeyViolationRow[];
    expect(violations).toHaveLength(0);
  });
});

describe('the local account wipe clears muscle_groups generically', () => {
  it('clears the seeded taxonomy and resets sync accounting without any server call', async () => {
    seedInto(database);
    expect(database.select().from(muscleGroups).all().length).toBeGreaterThan(0);

    await wipeLocalForAccountSwitch();

    // The taxonomy is gone, recovered for the next account via the generic pull.
    expect(database.select().from(muscleGroups).all()).toHaveLength(0);

    // The seed marker is reset so any pending bundle migration re-applies to the
    // next account's pulled rows.
    const runtime = database
      .select()
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    expect(runtime?.appliedSeedMigrationAppVersion).toBe(0);

    // The wipe is local-only: it never resolves the Supabase client, so no
    // server delete can be issued from this path.
    expect(getRequiredSupabaseMobileClient).not.toHaveBeenCalled();
  });
});
