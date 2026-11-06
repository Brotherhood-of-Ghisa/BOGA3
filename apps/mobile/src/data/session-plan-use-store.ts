import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { exerciseSets, sessionExercises, sessionPlanExercises, sessionPlans, sessionPlanUses, sessions } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

export const createPlanUseId = (): string =>
  `planuse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

/** Includes ordinary block attachments converted while their workout is active. */
export const findActivePlanSession = (tx: Transaction, planId: string): string | null => {
  const plan = tx.select({ isRoutine: sessionPlans.isRoutine }).from(sessionPlans).where(eq(sessionPlans.id, planId)).get();
  const row = tx.select({ id: sessions.id }).from(sessions)
    .leftJoin(sessionExercises, and(eq(sessionExercises.sessionId, sessions.id), isNull(sessionExercises.deletedAt)))
    .leftJoin(sessionPlanExercises, eq(sessionPlanExercises.id, sessionExercises.sourcePlanExerciseId))
    .where(and(eq(sessions.status, 'active'), isNull(sessions.deletedAt),
      or(eq(sessions.sourcePlanId, planId), plan?.isRoutine ? eq(sessionPlanExercises.sessionPlanId, planId) : sql`false`)))
    .orderBy(desc(sessions.updatedAt)).get();
  return row?.id ?? null;
};

/** Slot numbers arbitrate actions; performed IDs always use the immutable action ID. */
export const insertPlanUseInTransaction = (tx: Transaction, input: {
  id: string; planId: string; kind: 'workout' | 'skip'; now: Date; localUpdatedAtMs: number;
}) => {
  const existing = tx.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, input.id)).get();
  if (existing) {
    if (existing.sessionPlanId !== input.planId || existing.kind !== input.kind) {
      throw new Error('This Routine action belongs to a different use.');
    }
    return existing;
  }
  const plan = tx.select().from(sessionPlans).where(eq(sessionPlans.id, input.planId)).get();
  if (!plan || plan.deletedAt || !plan.isRoutine || plan.programmeId !== null) {
    throw new Error('This Routine is no longer available.');
  }
  const last = tx.select({ slot: sql<number>`coalesce(max(${sessionPlanUses.slotIndex}), 0)` })
    .from(sessionPlanUses).where(eq(sessionPlanUses.sessionPlanId, input.planId)).get();
  const row = {
    id: input.id, sessionPlanId: input.planId, slotIndex: (last?.slot ?? 0) + 1,
    kind: input.kind, skippedAt: input.kind === 'skip' ? input.now : null,
    deletedAt: null, localDirty: true, localUpdatedAtMs: input.localUpdatedAtMs,
    createdAt: input.now, updatedAt: input.now,
  };
  tx.insert(sessionPlanUses).values(row).run();
  return row;
};

/** Conversion preserves an entirely skipped one-off outcome before future edits. */
export const captureLegacyRoutineSkip = (tx: Transaction, planId: string, now: Date, localUpdatedAtMs: number): void => {
  if (tx.select({ id: sessionPlanUses.id }).from(sessionPlanUses).where(eq(sessionPlanUses.sessionPlanId, planId)).get()) return;
  const blocks = tx.select().from(sessionPlanExercises)
    .where(and(eq(sessionPlanExercises.sessionPlanId, planId), isNull(sessionPlanExercises.deletedAt))).all();
  if (!blocks.length || blocks.some(block => block.progressStatus !== 'skipped')) return;
  const plan = tx.select().from(sessionPlans).where(eq(sessionPlans.id, planId)).get();
  if (!plan) return;
  const dates = blocks.map(block => block.resolvedAt?.getTime() ?? NaN);
  const skippedAt = dates.every(Number.isFinite) ? new Date(Math.max(...dates)) : null;
  tx.insert(sessionPlanUses).values({
    id: createPlanUseId(), sessionPlanId: planId, slotIndex: 1, kind: 'skip', skippedAt,
    createdAt: plan.createdAt, updatedAt: now, localDirty: true, localUpdatedAtMs,
  }).run();
};

export const skipRoutineUse = async (planId: string, actionId: string, now: Date) => {
  if (!actionId.trim() || !Number.isFinite(now.getTime())) throw new Error('Invalid Routine action.');
  const database = await bootstrapLocalDataLayer();
  const result = database.transaction(tx => {
    const existing = tx.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, actionId)).get();
    if (existing) {
      if (existing.sessionPlanId !== planId || existing.kind !== 'skip') throw new Error('Invalid Routine action.');
      return existing.deletedAt
        ? { status: 'conflict' as const }
        : { status: 'skipped' as const, skippedAt: existing.skippedAt };
    }
    const activeSessionId = findActivePlanSession(tx, planId);
    if (activeSessionId) return { status: 'active-conflict' as const, activeSessionId };
    const use = insertPlanUseInTransaction(tx, {
      id: actionId, planId, kind: 'skip', now, localUpdatedAtMs: nowMonotonic(tx),
    });
    return { status: 'skipped' as const, skippedAt: use.skippedAt };
  });
  if (result.status === 'skipped') notifyLocalWrite();
  return result;
};

/** A server-accepted slot wins; preserve every losing workout value as ordinary work. */
type UseWireEntity = {
  type: string; id: string; client_updated_at_ms: number; fields: Record<string, unknown>;
};

export const repairRoutineUseClaimsInTransaction = (tx: Transaction, entities: readonly UseWireEntity[]): boolean => {
  const incoming = entities.filter(row => row.type === 'session_plan_uses' && row.fields.deleted_at == null);
  if (!incoming.length) return false;
  let changed = false;
  for (const row of incoming) {
    const existing = tx.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, row.id)).get();
    if (existing && existing.localUpdatedAtMs >= row.client_updated_at_ms) continue;
    const loser = tx.select().from(sessionPlanUses).where(and(
      eq(sessionPlanUses.sessionPlanId, String(row.fields.session_plan_id)),
      eq(sessionPlanUses.slotIndex, Number(row.fields.slot_index)),
      ne(sessionPlanUses.id, row.id), isNull(sessionPlanUses.deletedAt),
    )).get();
    if (!loser) continue;
    const now = new Date();
    const stamp = { localDirty: true, localUpdatedAtMs: nowMonotonic(tx), updatedAt: now };
    tx.update(exerciseSets).set({ sourcePlanSetId: null, sourcePlanUseId: null, ...stamp })
      .where(eq(exerciseSets.sourcePlanUseId, loser.id)).run();
    tx.update(sessionExercises).set({ sourcePlanExerciseId: null, sourcePlanUseId: null, ...stamp })
      .where(eq(sessionExercises.sourcePlanUseId, loser.id)).run();
    tx.update(sessions).set({ sourcePlanId: null, sourcePlanUseId: null, ...stamp })
      .where(eq(sessions.sourcePlanUseId, loser.id)).run();
    tx.update(sessionPlanUses).set({ deletedAt: now, ...stamp }).where(eq(sessionPlanUses.id, loser.id)).run();
    changed = true;
  }
  return changed;
};

export const repairRoutineUseClaimsForWirePage = async (entities: readonly UseWireEntity[]): Promise<void> => {
  const database = await bootstrapLocalDataLayer();
  const repaired = database.transaction(tx => repairRoutineUseClaimsInTransaction(tx, entities));
  if (repaired) notifyLocalWrite();
};
