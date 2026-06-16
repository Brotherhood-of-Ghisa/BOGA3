/* eslint-disable import/first */

/**
 * Outcome: a future-dated write is silently clamped by the server, and the
 * client reconciles the clamped value cleanly — it clears the dirty bit against
 * the value it SENT, and a later cycle that pulls the smaller clamped value back
 * is a no-op (no re-dirty, no spin), so the cycle still converges.
 *
 * The push RPC clamps `client_updated_at_ms` to `min(incoming, now + 5min)` so a
 * fast-clock client cannot write an unbeatable LWW value (contract A.1). The
 * backend contract suite proves the SERVER clamps; nothing proved the CLIENT
 * side of the bargain: the push ack clears the dirty bit against the unclamped
 * value the client sent, so the server then holds a STRICTLY SMALLER timestamp
 * than the client's local `local_updated_at_ms`. The next pull hands that smaller
 * value back — which must lose the local LWW and leave the row untouched, not
 * re-dirty it or loop. This runs the real cycle against a real endpoint to prove
 * that reconciliation end to end.
 */

import { eq } from 'drizzle-orm';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from '../helpers/in-memory-db';
import { createBootstrapMockState, createClientMockState } from '../helpers/sync-cycle-mocks';
import {
  createAuthedTestClient,
  readSyncTestEndpoint,
  SYNC_RPC_SCHEMA,
  type AuthedTestClient,
} from './helpers/sync-test-endpoint';

const mockBootstrapState = createBootstrapMockState<InMemoryTestDatabase>();
const mockClientState = createClientMockState<unknown>();

jest.mock('@/src/data/bootstrap', () => ({
  ...(jest.requireActual('@/src/data/bootstrap') as typeof import('@/src/data/bootstrap')),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  ...(require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).bootstrapMockFactory(
    () => mockBootstrapState,
  ),
}));

jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { gyms, muscleGroups } from '@/src/data/schema';
import { runSyncCycle } from '@/src/sync/cycle';

const config = readSyncTestEndpoint();

const FIVE_MIN_MS = 5 * 60 * 1000;

let seq = 0;
const uniqueId = (prefix: string): string => {
  seq += 1;
  return `clamp-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${seq}-${prefix}`;
};

interface PulledEntity {
  type: string;
  id: string;
  client_updated_at_ms: number;
}

describe('future-clock clamp reconciliation against a live endpoint', () => {
  let fixture: InMemoryDatabaseFixture;
  let database: InMemoryTestDatabase;
  let authed: AuthedTestClient;

  const seedFixtureDatabase = (): void => {
    const now = new Date();
    for (const muscleGroup of SYSTEM_MUSCLE_GROUP_SEEDS) {
      database
        .insert(muscleGroups)
        .values({ ...muscleGroup, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: muscleGroups.id })
        .run();
    }
  };

  // Drains a layer page by page through the authed client and returns the
  // server's stored envelope for one id (the server accumulates the fixture
  // user's rows, so a single page is not guaranteed to contain it).
  const findServerEntity = async (
    layer: number,
    type: string,
    id: string,
  ): Promise<PulledEntity | undefined> => {
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA);
    let cursor: unknown = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page = (await scoped.rpc('sync_pull', { layer, cursor, limit: 200 })) as {
        data?: { entities?: PulledEntity[]; next_cursor?: unknown; has_more?: boolean };
      };
      for (const entity of page.data?.entities ?? []) {
        if (entity.type === type && entity.id === id) {
          return entity;
        }
      }
      if (!page.data?.has_more) {
        break;
      }
      cursor = page.data?.next_cursor ?? null;
    }
    return undefined;
  };

  beforeAll(async () => {
    authed = await createAuthedTestClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
    mockBootstrapState.database = database;
    seedFixtureDatabase();
    mockClientState.client = authed.client;
  });

  afterEach(() => {
    fixture?.close();
    mockBootstrapState.database = null;
    mockClientState.client = null;
  });

  it('clamps a far-future push, clears dirty on the sent value, and reconciles the clamped pull as a no-op', async () => {
    const gymId = uniqueId('gym');
    // One hour ahead — well past the server's now + 5min clamp ceiling.
    const futureMs = Date.now() + 60 * 60 * 1000;

    database
      .insert(gyms)
      .values({ id: gymId, name: 'Fast Clock Gym', localDirty: true, localUpdatedAtMs: futureMs })
      .run();

    await expect(runSyncCycle()).resolves.toBe('converged');

    // The push acked against the SENT (unclamped) value, so the local row is
    // clean and still carries its future timestamp.
    const afterPush = database.select().from(gyms).where(eq(gyms.id, gymId)).get();
    expect(afterPush?.localDirty).toBe(false);
    expect(afterPush?.localUpdatedAtMs).toBe(futureMs);

    // The SERVER stored a clamped value: in the future (~now + 5min) but strictly
    // below the hour-ahead value the client sent.
    const serverEntity = await findServerEntity(0, 'gyms', gymId);
    expect(serverEntity).toBeDefined();
    const clampedMs = serverEntity!.client_updated_at_ms;
    expect(clampedMs).toBeLessThan(futureMs);
    expect(clampedMs).toBeGreaterThan(Date.now());
    expect(clampedMs).toBeLessThanOrEqual(Date.now() + FIVE_MIN_MS + 30_000);

    // A later cycle pulls that smaller clamped value back. It must LOSE the local
    // LWW (clamped < local future ts), leaving the row clean and unchanged — not
    // re-dirtied, and the cycle still converges (no spin).
    await expect(runSyncCycle()).resolves.toBe('converged');
    const afterReconcile = database.select().from(gyms).where(eq(gyms.id, gymId)).get();
    expect(afterReconcile?.localDirty).toBe(false);
    expect(afterReconcile?.localUpdatedAtMs).toBe(futureMs);
    expect(afterReconcile?.name).toBe('Fast Clock Gym');
  }, 60_000);
});
