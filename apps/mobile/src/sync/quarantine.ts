// Local sync quarantine: persisted bookkeeping for dirty rows the push-side FK
// closure preflight found to be structurally orphaned. Quarantining a row keeps
// one structural defect from permanently wedging an otherwise-valid offline
// backlog: the orphan is recorded here, skipped by future push selection, and
// the valid rows beside it keep pushing.
//
// All state lives in the `sync_quarantine` table (see the schema for why it is
// FK-free local bookkeeping, never synced). This module is the only writer/reader
// of that table; the push leg drives it and the status surface reads the count.

import { and, count, eq, sql } from 'drizzle-orm';

import type { Transaction } from '@/src/data/clock';
import { syncQuarantine } from '@/src/data/schema';
import type { EntityTableName } from '@/src/sync/topo-order';

/** One row to quarantine, as derived from a push FK preflight violation. */
export interface QuarantineRecordInput {
  readonly entityType: EntityTableName;
  readonly entityId: string;
  /** The classification that caused the quarantine (e.g. `LOCAL_FK_VIOLATION`). */
  readonly errorCode: string;
  readonly parentType: string | null;
  readonly parentIdField: string | null;
  readonly parentId: string | null;
}

/** The outcome of persisting one quarantine record. */
export interface QuarantineWriteResult {
  readonly input: QuarantineRecordInput;
  /** True when the row was newly inserted; false when an existing row was bumped. */
  readonly created: boolean;
}

/** Stable identity key for a quarantined row: `${type} ${id}`. */
export const quarantineKey = (type: string, id: string): string => `${type} ${id}`;

/**
 * Persists the given orphan rows into the quarantine table, idempotently. A
 * first detection inserts the row with `occurrence_count = 1` and equal
 * first/last-seen timestamps; a repeated detection of the same `(type, id)`
 * preserves `first_seen_at_ms`, advances `last_seen_at_ms`, increments
 * `occurrence_count`, and refreshes the diagnostic context — so a persistent
 * defect never accumulates unbounded duplicate rows. Returns one result per
 * input recording whether it was a fresh insert.
 *
 * Runs inside the caller's transaction so persistence commits atomically with
 * the push-batch selection that detected the orphan.
 */
export const quarantineRows = (
  tx: Transaction,
  records: readonly QuarantineRecordInput[],
  nowMs: number,
): QuarantineWriteResult[] => {
  const results: QuarantineWriteResult[] = [];

  for (const record of records) {
    const existing = tx
      .select({ entityId: syncQuarantine.entityId })
      .from(syncQuarantine)
      .where(
        and(
          eq(syncQuarantine.entityType, record.entityType),
          eq(syncQuarantine.entityId, record.entityId),
        ),
      )
      .get();

    tx.insert(syncQuarantine)
      .values({
        entityType: record.entityType,
        entityId: record.entityId,
        errorCode: record.errorCode,
        parentType: record.parentType,
        parentIdField: record.parentIdField,
        parentId: record.parentId,
        firstSeenAtMs: nowMs,
        lastSeenAtMs: nowMs,
        occurrenceCount: 1,
      })
      .onConflictDoUpdate({
        target: [syncQuarantine.entityType, syncQuarantine.entityId],
        set: {
          errorCode: record.errorCode,
          parentType: record.parentType,
          parentIdField: record.parentIdField,
          parentId: record.parentId,
          lastSeenAtMs: nowMs,
          occurrenceCount: sql`${syncQuarantine.occurrenceCount} + 1`,
        },
      })
      .run();

    results.push({ input: record, created: !existing });
  }

  return results;
};

/** The quarantined identities, ready for both batch exclusion and preflight. */
export interface QuarantineSnapshot {
  /** Every quarantined row as a `${type} ${id}` key, for the preflight check. */
  readonly keys: Set<string>;
  /** Quarantined ids grouped by entity type, for push-batch selection exclusion. */
  readonly idsByType: Map<EntityTableName, string[]>;
}

/** Reads the current quarantine table into a snapshot for selection + preflight. */
export const readQuarantine = (tx: Transaction): QuarantineSnapshot => {
  const rows = tx
    .select({ entityType: syncQuarantine.entityType, entityId: syncQuarantine.entityId })
    .from(syncQuarantine)
    .all();

  const keys = new Set<string>();
  const idsByType = new Map<EntityTableName, string[]>();

  for (const row of rows) {
    const type = row.entityType as EntityTableName;
    keys.add(quarantineKey(type, row.entityId));
    const ids = idsByType.get(type);
    if (ids) {
      ids.push(row.entityId);
    } else {
      idsByType.set(type, [row.entityId]);
    }
  }

  return { keys, idsByType };
};

/** Counts the rows currently quarantined — the "blocked sync rows" status signal. */
export const countQuarantinedRows = (tx: Transaction): number => {
  const row = tx.select({ value: count() }).from(syncQuarantine).get();
  return row?.value ?? 0;
};
