import { and, eq, inArray } from 'drizzle-orm';

import { getSignedInUserId } from '@/src/auth/session-user';
import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { nowMonotonic, type Transaction } from '@/src/data/clock';
import { clearProvenanceClaimsInTransaction } from '@/src/data/session-drafts';
import {
  deleteMergeLocal, listMergeLocal, preserveMergeEntity, readMergeLocal, writeMergeLocal,
} from '@/src/data/exercise-merge-store';
import { exerciseMergeLocal, exerciseSets, sessionExercises, sessionExerciseTags } from '@/src/data/schema';
import { MERGE_ENTITY_TYPES, mergeBlockId, type MergeReviewItem, type MergeWireEntity } from '@/src/exercise-core/merge-types';

type MergeAdapter = {
  toWire: (row: Record<string, unknown>, type: string) => MergeWireEntity;
  apply: (tx: Transaction, rows: MergeWireEntity[], force?: boolean) => number;
};
type SnapshotPage = { sequence: number; token: string; rows: MergeWireEntity[]; nextOffset: number; hasMore: boolean };
type Stage = { after: number; token: string | null; nextOffset: number; sequence: number; complete: boolean };

export async function mergeRpc<T>(name: string, args: Record<string, unknown>, expectedOwner: string): Promise<T> {
  const client = getRequiredSupabaseMobileClient();
  const { data: auth } = await client.auth.getSession();
  const session = auth.session;
  if (!session || session.user.id !== expectedOwner) throw new Error('Your account changed. Open the exercise again.');
  const { data, error } = await client.schema('app_public').rpc(name, args)
    .setHeader('Authorization', 'Bearer ' + session.access_token);
  if (await getSignedInUserId() !== expectedOwner) throw new Error('Your account changed. Open the exercise again.');
  if (error) throw new Error(error.message || 'Unable to update exercise history.');
  return data as T;
}

export function mergePullCanApply(tx: Transaction, entity: MergeWireEntity, existing?: Record<string, unknown>): boolean {
  const blockId = mergeBlockId(entity);
  if (!blockId) return true;
  const incoming = Number(entity.fields.merge_revision ?? 0);
  const local = entity.type === 'session_exercises' ? existing
    : tx.select().from(sessionExercises).where(eq(sessionExercises.id, blockId)).get();
  // Keep the complete old graph until the canonical higher-revision snapshot lands.
  return incoming === Number(local?.mergeRevision ?? 0);
}

function validatePage(value: SnapshotPage): void {
  if (!value || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      typeof value.token !== 'string' || !Array.isArray(value.rows) ||
      !Number.isSafeInteger(value.nextOffset) || typeof value.hasMore !== 'boolean') {
    throw new Error('Invalid exercise history snapshot.');
  }
  for (const row of value.rows) {
    if (!row || typeof row.id !== 'string' || !row.fields || typeof row.fields !== 'object' ||
        !Number.isSafeInteger(row.client_updated_at_ms) || typeof row.type !== 'string') {
      throw new Error('Invalid exercise history row.');
    }
  }
}

function clearStage(tx: Transaction, owner: string): void {
  tx.delete(exerciseMergeLocal).where(and(
    eq(exerciseMergeLocal.ownerUserId, owner), eq(exerciseMergeLocal.kind, 'stage'),
  )).run();
}

async function stageSnapshot(database: LocalDatabase, owner: string, after: number): Promise<Stage> {
  let stage = readMergeLocal<Stage>(database, owner, 'stage');
  if (stage?.complete && stage.after === after) {
    const checked = await mergeRpc<SnapshotPage>('exercise_merge_snapshot', {
      p_after: after, p_offset: stage.nextOffset, p_token: stage.token,
    }, owner);
    validatePage(checked);
    if (checked.token !== stage.token || checked.sequence !== stage.sequence || checked.hasMore || checked.rows.length) {
      throw new Error('MERGE_STALE: staged history changed.');
    }
  }
  if (!stage || stage.after !== after) {
    stage = { after, token: null, nextOffset: 0, sequence: after, complete: false };
    database.transaction(tx => clearStage(tx, owner));
  }
  while (!stage.complete) {
    const page: SnapshotPage = await mergeRpc<SnapshotPage>('exercise_merge_snapshot', {
      p_after: after, p_offset: stage.nextOffset, p_token: stage.token,
    }, owner);
    validatePage(page);
    if (page.nextOffset !== stage.nextOffset + page.rows.length || (page.hasMore && !page.rows.length)) {
      throw new Error('Exercise history snapshot made no progress.');
    }
    const offset = stage.nextOffset;
    stage = { after, token: page.token, nextOffset: page.nextOffset, sequence: page.sequence, complete: !page.hasMore };
    const next = stage;
    database.transaction(tx => {
      writeMergeLocal(tx, { ownerUserId: owner, id: 'stage:' + offset, kind: 'stage', payload: page.rows });
      writeMergeLocal(tx, { ownerUserId: owner, id: 'stage', kind: 'stage', payload: next });
    });
  }
  return stage;
}

type LocalRow = Record<string, unknown> & { id: string; localDirty: boolean; localUpdatedAtMs: number; mergeRevision: number };
type Chosen = { entity: MergeWireEntity; dirty: boolean };

function chooseGraphRows(input: {
  tx: Transaction; owner: string; incoming: MergeWireEntity[]; local: LocalRow[]; type: string; adapter: MergeAdapter;
  revisions: Map<string, number>;
}): Chosen[] {
  const { tx, owner, incoming, local, type, adapter, revisions } = input;
  const byId = new Map(incoming.map(row => [row.id, row]));
  const chosen = new Map(incoming.map(entity => [entity.id, { entity, dirty: false }]));
  for (const row of local) {
    const wire = adapter.toWire(row, type);
    const block = mergeBlockId(wire)!;
    const nextRevision = revisions.get(block) ?? 0;
    if (row.mergeRevision < nextRevision) {
      if (row.localDirty) preserveMergeEntity(tx, owner, wire);
      continue;
    }
    const remote = byId.get(row.id);
    if (!remote || row.localUpdatedAtMs >= remote.client_updated_at_ms) {
      // Unsent additions outside the fenced membership remain ordinary user data.
      if (remote || row.localDirty) chosen.set(row.id, { entity: wire, dirty: row.localDirty });
    }
  }
  return [...chosen.values()];
}

function restoreUniqueOrder(rows: Chosen[], parentKey: string): void {
  const used = new Map<string, Set<number>>();
  // Canonical slots win over unsent additions that were made from older membership.
  for (const row of [...rows].sort((a, b) => Number(a.dirty) - Number(b.dirty))) {
    const parent = String(row.entity.fields[parentKey]);
    const slots = used.get(parent) ?? new Set<number>();
    let position = Number(row.entity.fields.order_index);
    if (slots.has(position)) {
      position = Math.max(-1, ...slots) + 1;
      row.entity.fields.order_index = position;
      row.dirty = true;
    }
    slots.add(position);
    used.set(parent, slots);
  }
}

function installSnapshot(database: LocalDatabase, owner: string, stage: Stage, adapter: MergeAdapter): number {
  let applied = 0;
  database.transaction(tx => {
    const rows = listMergeLocal(tx, owner, 'stage').filter(row => row.id !== 'stage')
      .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)))
      .flatMap(row => JSON.parse(row.payload) as MergeWireEntity[]);
    const blocks = rows.filter(row => row.type === 'session_exercises');
    const sessionIds = [...new Set(blocks.map(row => String(row.fields.session_id)))];
    applied += adapter.apply(tx, rows.filter(row => !(MERGE_ENTITY_TYPES as readonly string[]).includes(row.type)));
    const live = rows.filter(row => !row.fields.deleted_at);
    clearProvenanceClaimsInTransaction(tx, {
      blocks: new Set(live.filter(row => row.type === 'session_exercises' && row.fields.source_plan_exercise_id)
        .map(row => String(row.fields.source_plan_exercise_id))),
      targets: new Set(live.filter(row => row.type === 'exercise_sets' && row.fields.source_plan_set_id)
        .map(row => String(row.fields.source_plan_set_id))),
    }, new Date(), nowMonotonic(tx), new Set(rows.map(row => row.id)));

    const localBlocks = sessionIds.length ? tx.select().from(sessionExercises)
      .where(inArray(sessionExercises.sessionId, sessionIds)).all() : [];
    const blockIds = [...new Set([...blocks.map(row => row.id), ...localBlocks.map(row => row.id)])];
    const revisions = new Map(blocks.map(row => [row.id, Number(row.fields.merge_revision ?? 0)]));
    const oldSets = blockIds.length ? tx.select().from(exerciseSets).where(inArray(exerciseSets.sessionExerciseId, blockIds)).all() : [];
    const oldTags = blockIds.length ? tx.select().from(sessionExerciseTags).where(inArray(sessionExerciseTags.sessionExerciseId, blockIds)).all() : [];
    const choose = (type: string, local: LocalRow[]) => chooseGraphRows({
      tx, owner, type, local, incoming: rows.filter(row => row.type === type), adapter, revisions,
    });
    const chosenBlocks = choose('session_exercises', localBlocks as unknown as LocalRow[]);
    const chosenSets = choose('exercise_sets', oldSets as unknown as LocalRow[]);
    const chosenTags = choose('session_exercise_tags', oldTags as unknown as LocalRow[]);
    restoreUniqueOrder(chosenBlocks, 'session_id');
    restoreUniqueOrder(chosenSets, 'session_exercise_id');

    // The snapshots above commit with this replacement; no intermediate graph is visible.
    if (blockIds.length) {
      tx.delete(sessionExerciseTags).where(inArray(sessionExerciseTags.sessionExerciseId, blockIds)).run();
      tx.delete(exerciseSets).where(inArray(exerciseSets.sessionExerciseId, blockIds)).run();
      tx.delete(sessionExercises).where(inArray(sessionExercises.id, blockIds)).run();
    }
    for (const [table, choices] of [
      [sessionExercises, chosenBlocks], [exerciseSets, chosenSets], [sessionExerciseTags, chosenTags],
    ] as const) {
      applied += adapter.apply(tx, choices.map(choice => choice.entity), true);
      for (const choice of choices.filter(item => item.dirty)) {
        tx.update(table).set({ localDirty: true }).where(eq(table.id, choice.entity.id)).run();
      }
    }
    writeMergeLocal(tx, { ownerUserId: owner, id: 'sequence', kind: 'state', payload: stage.sequence });
    clearStage(tx, owner);
  });
  return applied;
}

export async function uploadMergePending(database: LocalDatabase, owner: string): Promise<void> {
  for (const entry of listMergeLocal(database, owner, 'pending')) {
    const entity = JSON.parse(entry.payload) as MergeWireEntity;
    await mergeRpc<string>('exercise_merge_save_conflict', {
      p_type: entity.type, p_row: { ...entity.fields, id: entity.id, client_updated_at_ms: entity.client_updated_at_ms },
    }, owner);
    database.transaction(tx => deleteMergeLocal(tx, owner, entry.id));
  }
}

export async function refreshMergeReview(database: LocalDatabase, owner: string): Promise<MergeReviewItem[]> {
  const items: MergeReviewItem[] = [];
  let offset = 0;
  for (;;) {
    const page = await mergeRpc<{ items: MergeReviewItem[]; hasMore: boolean }>('exercise_merge_review', { p_offset: offset }, owner);
    if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean' ||
        page.items.some(item => !item || typeof item.id !== 'string' || typeof item.token !== 'string')) {
      throw new Error('Invalid saved changes response.');
    }
    items.push(...page.items);
    offset += page.items.length;
    if (!page.hasMore) break;
    if (!page.items.length) throw new Error('Saved changes could not be loaded.');
  }
  database.transaction(tx => writeMergeLocal(tx, { ownerUserId: owner, id: 'conflicts', kind: 'conflicts', payload: items }));
  return items;
}

export async function syncExerciseMerges(input: {
  database: LocalDatabase; owner: string; remoteSequence: number; conflictCount: number; adapter: MergeAdapter;
}): Promise<number> {
  const { database, owner, remoteSequence, conflictCount, adapter } = input;
  const sequence = readMergeLocal<number>(database, owner, 'sequence') ?? 0;
  const operation = readMergeLocal<{ id: string }>(database, owner, 'operation');
  const receipt = operation ? await mergeRpc<{ id: string; sequence: number } | null>(
    'exercise_merge_status', { p_id: operation.id }, owner) : null;
  if (receipt && (!Number.isSafeInteger(receipt.sequence) || receipt.id !== operation?.id)) {
    throw new Error('Invalid merge operation response.');
  }
  const targetSequence = Math.max(remoteSequence, receipt?.sequence ?? 0);
  let changed = 0;
  if (targetSequence > sequence) {
    try {
      const stage = await stageSnapshot(database, owner, sequence);
      if (stage.sequence < targetSequence) throw new Error('MERGE_STALE: history snapshot changed.');
      changed = installSnapshot(database, owner, stage, adapter);
    } catch (error) {
      if (error instanceof Error && error.message.includes('MERGE_STALE')) {
        database.transaction(tx => clearStage(tx, owner));
      }
      throw error;
    }
  }
  const hasPending = listMergeLocal(database, owner, 'pending').length > 0;
  const cached = readMergeLocal<MergeReviewItem[]>(database, owner, 'conflicts') ?? [];
  if (hasPending) await uploadMergePending(database, owner);
  if (hasPending || conflictCount > 0 || cached.length) await refreshMergeReview(database, owner);
  if (operation && receipt && (readMergeLocal<number>(database, owner, 'sequence') ?? 0) >= receipt.sequence) {
    database.transaction(tx => deleteMergeLocal(tx, owner, 'operation'));
  }

  return changed;
}

export { validateMergeOutcomes } from '@/src/exercise-core/merge-sync-ack';
