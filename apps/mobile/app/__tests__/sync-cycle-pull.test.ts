/**
 * Pull-leg coverage for the sync cycle: per-row last-write-wins on apply
 * (insert-when-absent, incoming-wins, incoming-loses), whole-page rollback when
 * a row violates a foreign key, and cursor advance only after a successful page
 * commit.
 *
 * Driver: a real in-memory better-sqlite3 database with the full migrated
 * schema applied. FK enforcement is toggled per test.
 */

import { eq } from 'drizzle-orm';

import { applyPullPage, type WireEntity } from '@/src/sync/cycle';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import { gyms, sessions, syncRuntimeState } from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

afterEach(() => {
  fixture.close();
});

const gymWire = (id: string, ms: number, name: string): WireEntity => ({
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

describe('applyPullPage last-write-wins', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  it('inserts a row that is absent locally and lands it clean', () => {
    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [gymWire('gym-1', 100, 'Iron Temple')], 'gyms');
    });

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Iron Temple');
    expect(row?.localDirty).toBe(false);
    expect(row?.localUpdatedAtMs).toBe(100);
  });

  it('overwrites a local row when the incoming timestamp is strictly newer', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Old', localDirty: true, localUpdatedAtMs: 100 }).run();

    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'New')], 'gyms');
    });

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('New');
    expect(row?.localDirty).toBe(false);
    expect(row?.localUpdatedAtMs).toBe(200);
  });

  it('no-ops when the incoming timestamp is older-or-equal and keeps the row dirty', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Local Newer', localDirty: true, localUpdatedAtMs: 300 }).run();

    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'Server Stale')], 'gyms');
    });

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Local Newer');
    // The local edit is newer, so the dirty bit stays set for the next push.
    expect(row?.localDirty).toBe(true);
    expect(row?.localUpdatedAtMs).toBe(300);
  });

  it('treats an equal timestamp as incoming-loses (no clear of the dirty bit)', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Local', localDirty: true, localUpdatedAtMs: 200 }).run();

    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [gymWire('gym-1', 200, 'Server')], 'gyms');
    });

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.name).toBe('Local');
    expect(row?.localDirty).toBe(true);
  });

  it('applies an incoming soft delete as a normal LWW column write', () => {
    database.insert(gyms).values({ id: 'gym-1', name: 'Live', localDirty: false, localUpdatedAtMs: 100 }).run();
    const deletePage = gymWire('gym-1', 200, 'Live');
    deletePage.fields.deleted_at = 250;

    database.transaction((tx) => {
      applyPullPage(tx as Transaction, [deletePage], 'gyms');
    });

    const row = database.select().from(gyms).where(eq(gyms.id, 'gym-1')).get();
    expect(row?.deletedAt?.getTime()).toBe(250);
  });
});

describe('applyPullPage page atomicity under FK enforcement', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;
  });

  it('rolls the whole page back when a row violates a foreign key', () => {
    // A session referencing a non-existent gym fails the FK check. Because the
    // whole page applies in one transaction, the valid row alongside it must
    // also roll back.
    const validSession: WireEntity = {
      type: 'sessions',
      id: 'sess-ok',
      client_updated_at_ms: 100,
      fields: {
        gym_id: null,
        status: 'active',
        started_at: 100,
        completed_at: null,
        duration_sec: null,
        created_at: 100,
        updated_at: 100,
        deleted_at: null,
      },
    };
    const orphanSession: WireEntity = {
      ...validSession,
      id: 'sess-orphan',
      fields: { ...validSession.fields, gym_id: 'gym-does-not-exist' },
    };

    expect(() => {
      database.transaction((tx) => {
        applyPullPage(tx as Transaction, [validSession, orphanSession], 'sessions');
      });
    }).toThrow();

    // Neither row landed: the page rolled back as a unit.
    expect(database.select().from(sessions).all()).toHaveLength(0);
  });
});

describe('pull cursor advances only after a committed page', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    database = fixture.database;
  });

  const readCursorJson = (): Record<string, unknown> => {
    const row = database
      .select({ pullCursor: syncRuntimeState.pullCursor })
      .from(syncRuntimeState)
      .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
      .get();
    const raw = row?.pullCursor;
    if (!raw) {
      return {};
    }
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  };

  it('does not persist the cursor when the page apply throws', () => {
    fixture.close();
    fixture = createInMemoryDatabase({ foreignKeys: true });
    database = fixture.database;

    const orphan: WireEntity = {
      type: 'sessions',
      id: 'sess-orphan',
      client_updated_at_ms: 100,
      fields: {
        gym_id: 'missing',
        status: 'active',
        started_at: 100,
        completed_at: null,
        duration_sec: null,
        created_at: 100,
        updated_at: 100,
        deleted_at: null,
      },
    };

    expect(() => {
      database.transaction((tx) => {
        const transaction = tx as Transaction;
        applyPullPage(transaction, [orphan], 'sessions');
        // Cursor write is in the same transaction; it must roll back too.
        transaction
          .insert(syncRuntimeState)
          .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: { '1': { server_received_at: 'x' } } as never })
          .onConflictDoUpdate({
            target: syncRuntimeState.id,
            set: { pullCursor: { '1': { server_received_at: 'x' } } as never },
          })
          .run();
      });
    }).toThrow();

    expect(readCursorJson()).toEqual({});
  });

  it('persists the cursor in the same transaction as a clean page apply', () => {
    database.transaction((tx) => {
      const transaction = tx as Transaction;
      applyPullPage(transaction, [gymWire('gym-1', 100, 'Iron Temple')], 'gyms');
      const cursor = { server_received_at: '2026-05-29T10:00:00.000Z', owner_user_id: 'u', type: 'gyms', id: 'gym-1' };
      transaction
        .insert(syncRuntimeState)
        .values({ id: PRIMARY_RUNTIME_STATE_ID, pullCursor: { '0': cursor } as never })
        .onConflictDoUpdate({
          target: syncRuntimeState.id,
          set: { pullCursor: { '0': cursor } as never },
        })
        .run();
    });

    expect(readCursorJson()).toMatchObject({ '0': { type: 'gyms', id: 'gym-1' } });
    expect(database.select().from(gyms).all()).toHaveLength(1);
  });
});
