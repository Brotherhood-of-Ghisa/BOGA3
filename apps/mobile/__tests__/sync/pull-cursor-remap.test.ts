/**
 * Outcome: upgrading a client from the 12-entity to the 16-entity Sync v2
 * topology RESETS its per-layer pull cursors, so the next sync re-drains every
 * layer from its earliest position instead of orphaning rows.
 *
 * Migration `0017_session_plan_cursor_reset` sets `pull_cursor` to `{}`. The
 * strategy is locked in docs/specs/tech/session-planning-contract.md §3.2:
 * cursor remapping is rejected because Layers 0–3 each gain a new entity type
 * and the old Layer-4 bodyweight cursor must survive, so no arithmetic preserves
 * every entity's unread range. This suite drives the shipped SQL against a real
 * better-sqlite3 database: it applies the schema migrations up to `0016`, plants
 * a representative 12-entity cursor map, then applies `0017` and asserts the
 * reset.
 */

import Database from 'better-sqlite3';

import { generatedMigrationBundle } from '@/drizzle/migrations.generated';

const keyFor = (idx: number): string => `m${String(idx).padStart(4, '0')}`;

const migrationSql = (idx: number): string =>
  (generatedMigrationBundle.migrations as Record<string, string | undefined>)[keyFor(idx)] ?? '';

/** Applies every bundled migration with fromIdx <= idx <= maxIdx, in order. */
const applyRange = (client: Database.Database, fromIdx: number, maxIdx: number): void => {
  const entries = [...generatedMigrationBundle.journal.entries].sort((a, b) => a.idx - b.idx);
  for (const entry of entries) {
    if (entry.idx < fromIdx) continue;
    if (entry.idx > maxIdx) break;
    for (const raw of migrationSql(entry.idx).split('--> statement-breakpoint')) {
      const statement = raw.trim();
      if (statement.length > 0) client.exec(statement);
    }
  }
};

const cursorOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  server_received_at: '2026-09-01T00:00:00.000Z',
  owner_user_id: '00000000-0000-0000-0000-000000000001',
  type: 'gyms',
  id: 'g',
  ...overrides,
});

const reset = (oldCursor: unknown): string => {
  const client = new Database(':memory:');
  try {
    applyRange(client, 0, 16);
    client
      .prepare(`insert into sync_runtime_state (id, pull_cursor) values ('primary', ?)`)
      .run(typeof oldCursor === 'string' ? oldCursor : JSON.stringify(oldCursor));
    applyRange(client, 17, 17);
    const row = client
      .prepare(`select pull_cursor from sync_runtime_state where id = 'primary'`)
      .get() as { pull_cursor: string };
    return row.pull_cursor;
  } finally {
    client.close();
  }
};

describe('m0017 pull-cursor reset', () => {
  it('resets a populated 12-entity cursor map to an empty object', () => {
    const old = {
      '0': cursorOf({ type: 'gyms', id: 'g0' }),
      '1': cursorOf({ type: 'sessions', id: 's1' }),
      '2': cursorOf({ type: 'session_exercises', id: 'e2' }),
      '3': cursorOf({ type: 'exercise_sets', id: 's3' }),
      '4': cursorOf({ type: 'body_weight_measurements', id: 'b4' }),
    };
    expect(JSON.parse(reset(old))).toEqual({});
  });

  it('leaves an already-empty cursor map empty', () => {
    expect(JSON.parse(reset({}))).toEqual({});
  });

  it('normalises a malformed cursor value to an empty object', () => {
    expect(JSON.parse(reset('not json'))).toEqual({});
  });
});
