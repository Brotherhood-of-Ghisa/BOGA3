import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import {
  exerciseSets,
  sessionExercises,
  sessionPlanExercises,
  sessionPlanSets,
  sessionPlans,
  sessions,
  trainingProgrammes,
} from './schema';
import type { SessionSetTypeValue } from './set-types';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

/**
 * Transactional store for the four plan tables (`training_programmes`,
 * `session_plans`, `session_plan_exercises`, `session_plan_sets`): local-first
 * authoring of planned sessions and programmes. Owned by `src/data` like every
 * other table's SQL; `src/session-planner` composes it behind the domain
 * repository and never issues its own multi-table writes.
 *
 * Semantics shared with the performed-graph writer (`session-drafts.ts`):
 * - Soft delete only — a removed row is tombstoned (`deleted_at`) so the
 *   deletion syncs and survives reinstall; it is never hard-deleted.
 * - The local unique indexes `(parent, order_index)` are NOT partial, so a
 *   tombstone keeps occupying its slot. Graph rebuilds therefore lift every
 *   existing row into a high scratch band first, write live rows back down to
 *   `0..n-1`, and re-park set tombstones above the scratch band. Reorders lift
 *   only the moved rows, to slots strictly above the parent's current maximum.
 * - One `nowMonotonic(tx)` value per transaction stamps every row it writes,
 *   so a save dirties atomically into one push batch; one `notifyLocalWrite()`
 *   fires after the commit.
 */

export type PlanRow = typeof sessionPlans.$inferSelect;
export type PlanExerciseRow = typeof sessionPlanExercises.$inferSelect;
export type PlanSetRow = typeof sessionPlanSets.$inferSelect;
export type ProgrammeRow = typeof trainingProgrammes.$inferSelect;

export type SavePlanSetGraphInput = {
  id?: string;
  targetWeightValue: string | null;
  targetReps: number;
  targetSetType: SessionSetTypeValue;
};

export type SavePlanExerciseGraphInput = {
  id?: string;
  exerciseDefinitionId: string | null;
  name: string;
  machineName: string | null;
  sets: SavePlanSetGraphInput[];
};

export type SaveSessionPlanGraphInput = {
  planId?: string;
  programmeId?: string | null;
  programmeOrderIndex?: number | null;
  gymId: string | null;
  title: string;
  scheduledFor: Date | null;
  exercises: SavePlanExerciseGraphInput[];
};

export type SaveProgrammeGraphInput = {
  programmeId?: string;
  name: string;
  description: string | null;
  /** Array order is programme order (dense indexes 0..n-1 are assigned). */
  plans: SaveSessionPlanGraphInput[];
};

export type PlanGraph = {
  plan: PlanRow;
  exercises: (PlanExerciseRow & { sets: PlanSetRow[] })[];
};

export type PlanBlockGraph = {
  plan: PlanRow;
  exercise: PlanExerciseRow;
  sets: PlanSetRow[];
};

const ORDER_INDEX_SCRATCH_OFFSET = 1_000_000;
const ORDER_INDEX_TOMBSTONE_BASE = 2 * ORDER_INDEX_SCRATCH_OFFSET;

const mintPlanEntityId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Re-densifies the rows named by `orderedIds` to `0..n-1` inside one
 * transaction. Lifts each moved row to a slot starting at `liftBase` — which
 * the caller computes from the parent's maximum `order_index` over ALL rows,
 * tombstones included, since tombstones can sit anywhere at or above the
 * scratch band from earlier tombstones — then writes the dense positions.
 * The caller validates the exact permutation first; an unknown id or a wrong
 * length throws and rolls the transaction back.
 */
const redensifyRowsInTransaction = (
  rows: { id: string; orderIndex: number }[],
  orderedIds: string[],
  liftBase: number,
  write: (id: string, orderIndex: number) => void,
): void => {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  if (orderedIds.length !== rows.length) {
    throw new Error('Order list must contain every live row exactly once');
  }
  let liftSlot = Math.max(liftBase, 0);
  for (const id of orderedIds) {
    if (!rowsById.has(id)) {
      throw new Error(`Unknown row ${id} in order list`);
    }
    write(id, liftSlot);
    liftSlot += 1;
  }
  orderedIds.forEach((id, index) => write(id, index));
};

/** First slot above every row's `order_index` for one parent, tombstones included. */
const liftBaseForRows = (rows: { orderIndex: number | null }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.orderIndex ?? -1), -1) + 1;

/**
 * Writes one plan's exercise/set graph (create or whole-plan edit) inside the
 * caller's transaction: scratch-lifts existing rows, reuses surviving rows by
 * id, tombstones rows that dropped out, and returns the plan id. `programmeId`
 * / `programmeOrderIndex` are written only when the caller supplies them, so a
 * standalone plan save never disturbs programme membership.
 */
const savePlanGraphInTransaction = (
  tx: Transaction,
  input: SaveSessionPlanGraphInput,
  now: Date,
  localUpdatedAtMs: number,
): string => {
  const planId = input.planId?.trim() || mintPlanEntityId('plan');

  const existingPlan = tx
    .select({ id: sessionPlans.id })
    .from(sessionPlans)
    .where(eq(sessionPlans.id, planId))
    .get();

  if (!existingPlan) {
    tx.insert(sessionPlans)
      .values({
        id: planId,
        programmeId: input.programmeId ?? null,
        programmeOrderIndex: input.programmeOrderIndex ?? null,
        gymId: input.gymId,
        title: input.title,
        scheduledFor: input.scheduledFor,
        deletedAt: null,
        localDirty: true,
        localUpdatedAtMs,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    const planUpdateSet: Partial<typeof sessionPlans.$inferInsert> = {
      gymId: input.gymId,
      title: input.title,
      scheduledFor: input.scheduledFor,
      deletedAt: null,
      localDirty: true,
      localUpdatedAtMs,
    };
    if (input.programmeId !== undefined) {
      planUpdateSet.programmeId = input.programmeId;
      planUpdateSet.programmeOrderIndex = input.programmeOrderIndex ?? null;
    }
    if (input.programmeOrderIndex !== undefined) {
      planUpdateSet.programmeOrderIndex = input.programmeOrderIndex;
    }
    tx.update(sessionPlans)
      .set({ ...planUpdateSet, updatedAt: now })
      .where(eq(sessionPlans.id, planId))
      .run();
  }

  const existingExerciseRows = tx
    .select({ id: sessionPlanExercises.id, orderIndex: sessionPlanExercises.orderIndex })
    .from(sessionPlanExercises)
    .where(eq(sessionPlanExercises.sessionPlanId, planId))
    .all();
  const existingExerciseIds = existingExerciseRows.map((row) => row.id);
  const existingSetsByExerciseId = new Map<string, { id: string; orderIndex: number }[]>();
  if (existingExerciseIds.length > 0) {
    for (const row of tx
      .select({
        id: sessionPlanSets.id,
        sessionPlanExerciseId: sessionPlanSets.sessionPlanExerciseId,
        orderIndex: sessionPlanSets.orderIndex,
      })
      .from(sessionPlanSets)
      .where(inArray(sessionPlanSets.sessionPlanExerciseId, existingExerciseIds))
      .all()) {
      const current = existingSetsByExerciseId.get(row.sessionPlanExerciseId) ?? [];
      current.push({ id: row.id, orderIndex: row.orderIndex });
      existingSetsByExerciseId.set(row.sessionPlanExerciseId, current);
    }
  }

  existingExerciseRows.forEach((row) => {
    tx.update(sessionPlanExercises)
      .set({ orderIndex: row.orderIndex + ORDER_INDEX_SCRATCH_OFFSET })
      .where(eq(sessionPlanExercises.id, row.id))
      .run();
  });
  for (const sets of existingSetsByExerciseId.values()) {
    sets.forEach((set) => {
      tx.update(sessionPlanSets)
        .set({ orderIndex: set.orderIndex + ORDER_INDEX_SCRATCH_OFFSET })
        .where(eq(sessionPlanSets.id, set.id))
        .run();
    });
  }

  const keptExerciseIds = new Set<string>();
  const keptSetIdsByExerciseId = new Map<string, Set<string>>();
  const maxExistingSetIndex = Array.from(existingSetsByExerciseId.values())
    .flat()
    .reduce((max, set) => Math.max(max, set.orderIndex), -1);
  let setTombstoneCursor = Math.max(ORDER_INDEX_TOMBSTONE_BASE, maxExistingSetIndex + 1);

  input.exercises.forEach((exerciseInput, exerciseIndex) => {
    const requestedId = exerciseInput.id?.trim();
    const exerciseId = requestedId || mintPlanEntityId('planexercise');
    keptExerciseIds.add(exerciseId);
    const keptSetIds = new Set<string>();
    const existingExercise = existingExerciseRows.find((row) => row.id === exerciseId);

    if (existingExercise) {
      tx.update(sessionPlanExercises)
        .set({
          orderIndex: exerciseIndex,
          name: exerciseInput.name,
          machineName: exerciseInput.machineName ?? null,
          deletedAt: null,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: now,
        })
        .where(eq(sessionPlanExercises.id, exerciseId))
        .run();
    } else {
      tx.insert(sessionPlanExercises)
        .values({
          id: exerciseId,
          sessionPlanId: planId,
          exerciseDefinitionId: exerciseInput.exerciseDefinitionId,
          orderIndex: exerciseIndex,
          name: exerciseInput.name,
          machineName: exerciseInput.machineName ?? null,
          deletedAt: null,
          localDirty: true,
          localUpdatedAtMs,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    exerciseInput.sets.forEach((setInput, setIndex) => {
      const requestedSetId = setInput.id?.trim();
      const existingSet = requestedSetId
        ? existingSetsByExerciseId.get(exerciseId)?.find((row) => row.id === requestedSetId)
        : undefined;
      const setId = existingSet ? (requestedSetId as string) : requestedSetId ?? mintPlanEntityId('plandset');
      keptSetIds.add(setId);

      const setValues = {
        orderIndex: setIndex,
        targetWeightValue: setInput.targetWeightValue,
        targetReps: setInput.targetReps,
        targetSetType: setInput.targetSetType,
        deletedAt: null,
        localDirty: true,
        localUpdatedAtMs,
      };
      if (existingSet) {
        tx.update(sessionPlanSets)
          .set({ ...setValues, updatedAt: now })
          .where(eq(sessionPlanSets.id, setId))
          .run();
      } else {
        tx.insert(sessionPlanSets)
          .values({ id: setId, sessionPlanExerciseId: exerciseId, ...setValues, createdAt: now, updatedAt: now })
          .run();
      }
    });
    keptSetIdsByExerciseId.set(exerciseId, keptSetIds);
  });

  existingExerciseRows.forEach((row) => {
    if (keptExerciseIds.has(row.id)) {
      return;
    }
    tx.update(sessionPlanExercises)
      .set({ deletedAt: now, localDirty: true, localUpdatedAtMs, updatedAt: now })
      .where(eq(sessionPlanExercises.id, row.id))
      .run();
  });

  for (const [exerciseId, sets] of existingSetsByExerciseId) {
    const keptSetIds = keptSetIdsByExerciseId.get(exerciseId) ?? new Set<string>();
    sets.forEach((set) => {
      if (keptSetIds.has(set.id)) {
        return;
      }
      tx.update(sessionPlanSets)
        .set({
          orderIndex: setTombstoneCursor,
          deletedAt: now,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: now,
        })
        .where(eq(sessionPlanSets.id, set.id))
        .run();
      setTombstoneCursor += 1;
    });
  }

  return planId;
};

/**
 * The plan block's live performed card, when one exists. Attachment is the
 * only provenance marker that makes a pending block read-only: a block with a
 * live `session_exercises` row pointing at it is attached, whatever its
 * `progress_status` says.
 */
const findLiveSourcedCardForBlockInTransaction = (tx: Transaction, planExerciseId: string) =>
  tx
    .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId })
    .from(sessionExercises)
    .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
    .where(
      and(
        eq(sessionExercises.sourcePlanExerciseId, planExerciseId),
        isNull(sessionExercises.deletedAt),
        isNull(sessions.deletedAt),
      ),
    )
    .get();

const listSourcedCardsForBlocksInTransaction = (tx: Transaction, planExerciseIds: string[]) =>
  planExerciseIds.length === 0
    ? []
    : tx
        .select({
          id: sessionExercises.id,
          sessionId: sessionExercises.sessionId,
          sourcePlanExerciseId: sessionExercises.sourcePlanExerciseId,
        })
        .from(sessionExercises)
        .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
        .where(
          and(
            inArray(sessionExercises.sourcePlanExerciseId, planExerciseIds),
            isNull(sessionExercises.deletedAt),
            // A card whose session was discarded no longer claims the block:
            // the block returns to pending (available) again.
            isNull(sessions.deletedAt),
          ),
        )
        .all()
        .map((row) => ({
          id: row.id,
          sessionId: row.sessionId,
          // The `inArray` filter above excludes the null link (manual cards).
          sourcePlanExerciseId: row.sourcePlanExerciseId as string,
        }));

const listBlocksForPlansInTransaction = (tx: Transaction, planIds: string[]) =>
  planIds.length === 0
    ? []
    : tx
        .select()
        .from(sessionPlanExercises)
        .where(and(inArray(sessionPlanExercises.sessionPlanId, planIds), isNull(sessionPlanExercises.deletedAt)))
        .orderBy(asc(sessionPlanExercises.orderIndex))
        .all();

const listSetsForBlocksInTransaction = (tx: Transaction, planExerciseIds: string[]) =>
  planExerciseIds.length === 0
    ? []
    : tx
        .select()
        .from(sessionPlanSets)
        .where(and(inArray(sessionPlanSets.sessionPlanExerciseId, planExerciseIds), isNull(sessionPlanSets.deletedAt)))
        .orderBy(asc(sessionPlanSets.orderIndex))
        .all();

export type SessionPlanStore = {
  /** Creates or rewrites one plan graph in one transaction. */
  savePlanGraph(input: SaveSessionPlanGraphInput, now?: Date): Promise<string>;
  /** Creates a programme and all of its ordered child plans in one transaction. */
  saveProgrammeGraph(input: SaveProgrammeGraphInput, now?: Date): Promise<{ programmeId: string; planIds: string[] }>;
  /** Rewrites only the plan row (title/gym/schedule) — never its blocks. */
  updatePlanMeta(input: {
    planId: string;
    title: string;
    gymId: string | null;
    scheduledFor: Date | null;
    now: Date;
  }): Promise<boolean>;
  /** Rewrites one block row and its target sets (a pending, unattached block only). */
  savePlanExerciseGraph(input: {
    planExerciseId: string;
    exerciseDefinitionId: string | null;
    name: string;
    machineName: string | null;
    sets: SavePlanSetGraphInput[];
    now: Date;
  }): Promise<boolean>;
  /** Appends one block with its target sets at the plan's next dense order index. */
  insertPlanExercise(input: {
    planId: string;
    exercise: SavePlanExerciseGraphInput;
    now: Date;
  }): Promise<string>;
  updateProgrammeMeta(input: { programmeId: string; name: string; description: string | null; now: Date }): Promise<boolean>;
  reorderProgrammePlans(input: { programmeId: string; orderedPlanIds: string[]; now: Date }): Promise<void>;
  reorderPlanExercises(input: { planId: string; orderedExerciseIds: string[]; now: Date }): Promise<void>;
  reorderPlanSets(input: { planExerciseId: string; orderedSetIds: string[]; now: Date }): Promise<void>;
  tombstonePlan(input: { planId: string; now: Date }): Promise<boolean>;
  /** Tombstones the programme and detaches its live plans (they become standalone). */
  tombstoneProgramme(input: { programmeId: string; now: Date }): Promise<boolean>;
  /** Tombstones one block and its live target sets. */
  tombstonePlanExercise(input: { planExerciseId: string; now: Date }): Promise<boolean>;
  /** The block's live performed card, when one has claimed it. */
  findLiveSourcedCardForBlock(planExerciseId: string): Promise<{ id: string; sessionId: string } | null>;
  /** Releases (tombstones) child cards and sets of discarded sessions claiming these blocks. */
  releaseDiscardedBlockClaims(planExerciseIds: string[], now?: Date): Promise<void>;
  /** The active, undeleted session started from this whole plan, when one exists. */
  findActiveSessionIdBySourcePlan(planId: string): Promise<string | null>;
  /** Any active, undeleted session — the Start-all conflict check. */
  findActiveSessionId(): Promise<string | null>;
  /**
   * The live performed card claiming this block (its owning session not
   * discarded) together with the card's live performed sets — the read behind
   * block completion/skip validation.
   */
  findSourcedCardPerformances(planExerciseId: string): Promise<{
    cardId: string;
    sessionId: string;
    sets: {
      id: string;
      sourcePlanSetId: string | null;
      repsValue: string;
      weightValue: string;
      performanceStatus: string | null;
    }[];
  } | null>;
  /** Explicitly resolves one pending block (completed or skipped) with a timestamp. */
  resolvePlanBlock(input: {
    planExerciseId: string;
    status: 'completed' | 'skipped';
    now: Date;
  }): Promise<boolean>;
  /** Live performed cards claiming any of these blocks (attachment lookup in one query). */
  listSourcedCardsForBlocks(planExerciseIds: string[]): Promise<
    { id: string; sessionId: string; sourcePlanExerciseId: string }[]
  >;
  /** Live blocks of the given plans, ordered by plan then block order. */
  listBlocksForPlans(planIds: string[]): Promise<PlanExerciseRow[]>;
  /** Live targets of the given blocks, ordered by block then target order. */
  listSetsForBlocks(planExerciseIds: string[]): Promise<PlanSetRow[]>;
  loadPlanGraph(planId: string): Promise<PlanGraph | null>;
  loadPlan(planId: string): Promise<PlanRow | null>;
  /** The block plus its target sets and its live parent plan; null when either is gone. */
  loadPlanBlock(planExerciseId: string): Promise<PlanBlockGraph | null>;
  loadProgramme(programmeId: string): Promise<ProgrammeRow | null>;
  listProgrammes(): Promise<ProgrammeRow[]>;
  listPlanGraphsByProgramme(programmeId: string): Promise<PlanGraph[]>;
  listLivePlans(): Promise<PlanRow[]>;
};


/** See {@link SessionPlanStore}. */
const savePlanGraph = async (input: SaveSessionPlanGraphInput, now: Date = new Date()): Promise<string> => {
    const database = await bootstrapLocalDataLayer();
    let planId = '';
    database.transaction((tx) => {
      planId = savePlanGraphInTransaction(tx, input, now, nowMonotonic(tx));
    });
    notifyLocalWrite();
    return planId;
  };


/** See {@link SessionPlanStore}. */
const saveProgrammeGraph = async (input: SaveProgrammeGraphInput, now: Date = new Date()): Promise<{ programmeId: string; planIds: string[] }> => {
    const database = await bootstrapLocalDataLayer();
    const programmeId = input.programmeId?.trim() || mintPlanEntityId('programme');
    const planIds: string[] = [];
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const existingProgramme = tx
        .select({ id: trainingProgrammes.id })
        .from(trainingProgrammes)
        .where(eq(trainingProgrammes.id, programmeId))
        .get();
      if (!existingProgramme) {
        tx.insert(trainingProgrammes)
          .values({
            id: programmeId,
            name: input.name,
            description: input.description,
            deletedAt: null,
            localDirty: true,
            localUpdatedAtMs,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      } else {
        tx.update(trainingProgrammes)
          .set({
            name: input.name,
            description: input.description,
            deletedAt: null,
            localDirty: true,
            localUpdatedAtMs,
            updatedAt: now,
          })
          .where(eq(trainingProgrammes.id, programmeId))
          .run();
      }
      input.plans.forEach((planInput, index) => {
        planIds.push(
          savePlanGraphInTransaction(
            tx,
            { ...planInput, programmeId, programmeOrderIndex: index },
            now,
            localUpdatedAtMs,
          ),
        );
      });
    });
    notifyLocalWrite();
    return { programmeId, planIds };
  };


/** See {@link SessionPlanStore}. */
const updateProgrammeMeta = async (input: { programmeId: string; name: string; description: string | null; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let wrote = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const result = tx
        .update(trainingProgrammes)
        .set({
          name: input.name,
          description: input.description,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(and(eq(trainingProgrammes.id, input.programmeId), isNull(trainingProgrammes.deletedAt)))
        .run();
      wrote = result.changes > 0;
    });
    if (wrote) {
      notifyLocalWrite();
    }
    return wrote;
  };


/** See {@link SessionPlanStore}. */
const updatePlanMeta = async (input: { planId: string; title: string; gymId: string | null; scheduledFor: Date | null; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let wrote = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const result = tx
        .update(sessionPlans)
        .set({
          title: input.title,
          gymId: input.gymId,
          scheduledFor: input.scheduledFor,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(and(eq(sessionPlans.id, input.planId), isNull(sessionPlans.deletedAt)))
        .run();
      wrote = result.changes > 0;
    });
    if (wrote) {
      notifyLocalWrite();
    }
    return wrote;
  };


/** See {@link SessionPlanStore}. */
const savePlanExerciseGraph = async (input: { planExerciseId: string; exerciseDefinitionId: string | null; name: string; machineName: string | null; sets: SavePlanSetGraphInput[]; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let wrote = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const block = tx
        .select({ id: sessionPlanExercises.id })
        .from(sessionPlanExercises)
        .where(and(eq(sessionPlanExercises.id, input.planExerciseId), isNull(sessionPlanExercises.deletedAt)))
        .get();
      if (!block) {
        return;
      }
      tx.update(sessionPlanExercises)
        .set({
          exerciseDefinitionId: input.exerciseDefinitionId,
          name: input.name,
          machineName: input.machineName,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(eq(sessionPlanExercises.id, block.id))
        .run();

      const existingSetRows = tx
        .select({ id: sessionPlanSets.id, orderIndex: sessionPlanSets.orderIndex })
        .from(sessionPlanSets)
        .where(eq(sessionPlanSets.sessionPlanExerciseId, block.id))
        .all();
      existingSetRows.forEach((row) => {
        tx.update(sessionPlanSets)
          .set({ orderIndex: row.orderIndex + ORDER_INDEX_SCRATCH_OFFSET })
          .where(eq(sessionPlanSets.id, row.id))
          .run();
      });

      const keptSetIds = new Set<string>();
      const maxExistingSetIndex = existingSetRows.reduce((max, row) => Math.max(max, row.orderIndex), -1);
      let setTombstoneCursor = Math.max(ORDER_INDEX_TOMBSTONE_BASE, maxExistingSetIndex + 1);
      input.sets.forEach((setInput, setIndex) => {
        const requestedSetId = setInput.id?.trim();
        const existingSet = requestedSetId
          ? existingSetRows.find((row) => row.id === requestedSetId)
          : undefined;
        const setId = existingSet ? (requestedSetId as string) : requestedSetId ?? mintPlanEntityId('plandset');
        keptSetIds.add(setId);
        const setValues = {
          orderIndex: setIndex,
          targetWeightValue: setInput.targetWeightValue,
          targetReps: setInput.targetReps,
          targetSetType: setInput.targetSetType,
          deletedAt: null,
          localDirty: true,
          localUpdatedAtMs,
        };
        if (existingSet) {
          tx.update(sessionPlanSets)
            .set({ ...setValues, updatedAt: input.now })
            .where(eq(sessionPlanSets.id, setId))
            .run();
        } else {
          tx.insert(sessionPlanSets)
            .values({ id: setId, sessionPlanExerciseId: block.id, ...setValues, createdAt: input.now, updatedAt: input.now })
            .run();
        }
      });
      existingSetRows.forEach((row) => {
        if (keptSetIds.has(row.id)) {
          return;
        }
        tx.update(sessionPlanSets)
          .set({
            orderIndex: setTombstoneCursor,
            deletedAt: input.now,
            localDirty: true,
            localUpdatedAtMs,
            updatedAt: input.now,
          })
          .where(eq(sessionPlanSets.id, row.id))
          .run();
        setTombstoneCursor += 1;
      });
      wrote = true;
    });
    if (wrote) {
      notifyLocalWrite();
    }
    return wrote;
  };


/** See {@link SessionPlanStore}. */
const insertPlanExercise = async (input: { planId: string; exercise: SavePlanExerciseGraphInput; now: Date }): Promise<string> => {
    const database = await bootstrapLocalDataLayer();
    let planExerciseId = '';
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      // The insert slot must sit above every row of the plan, tombstones
      // included: the local `(parent, order_index)` unique index is NOT
      // partial, and a tombstoned block (parked above the live band by
      // `tombstonePlanExercise`) would otherwise collide with the new row.
      const nextIndex = liftBaseForRows(
        tx
          .select({ orderIndex: sessionPlanExercises.orderIndex })
          .from(sessionPlanExercises)
          .where(eq(sessionPlanExercises.sessionPlanId, input.planId))
          .all(),
      );
      planExerciseId = mintPlanEntityId('planexercise');
      tx.insert(sessionPlanExercises)
        .values({
          id: planExerciseId,
          sessionPlanId: input.planId,
          exerciseDefinitionId: input.exercise.exerciseDefinitionId,
          orderIndex: nextIndex,
          name: input.exercise.name,
          machineName: input.exercise.machineName,
          deletedAt: null,
          localDirty: true,
          localUpdatedAtMs,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
      input.exercise.sets.forEach((setInput, setIndex) => {
        tx.insert(sessionPlanSets)
          .values({
            id: setInput.id?.trim() || mintPlanEntityId('plandset'),
            sessionPlanExerciseId: planExerciseId,
            orderIndex: setIndex,
            targetWeightValue: setInput.targetWeightValue,
            targetReps: setInput.targetReps,
            targetSetType: setInput.targetSetType,
            deletedAt: null,
            localDirty: true,
            localUpdatedAtMs,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();
      });
    });
    notifyLocalWrite();
    return planExerciseId;
  };


/** See {@link SessionPlanStore}. */
const findLiveSourcedCardForBlock = async (planExerciseId: string): Promise<{ id: string; sessionId: string } | null> => {
    const database = await bootstrapLocalDataLayer();
    let card: { id: string; sessionId: string } | null = null;
    database.transaction((tx) => {
      card = findLiveSourcedCardForBlockInTransaction(tx, planExerciseId) ?? null;
    });
    return card;
  };

/** See {@link SessionPlanStore}. */
const releaseDiscardedBlockClaims = async (planExerciseIds: string[], now: Date = new Date()): Promise<void> => {
  if (planExerciseIds.length === 0) return;
  const database = await bootstrapLocalDataLayer();
  let updated = false;
  database.transaction((tx) => {
    const localUpdatedAtMs = nowMonotonic(tx);
    const discardedCards = tx
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
      .where(
        and(
          inArray(sessionExercises.sourcePlanExerciseId, planExerciseIds),
          isNull(sessionExercises.deletedAt),
          isNotNull(sessions.deletedAt),
        ),
      )
      .all();
    if (discardedCards.length > 0) {
      updated = true;
      const cardIds = discardedCards.map((c) => c.id);
      tx.update(sessionExercises)
        .set({ deletedAt: now, localDirty: true, localUpdatedAtMs, updatedAt: now })
        .where(inArray(sessionExercises.id, cardIds))
        .run();
      tx.update(exerciseSets)
        .set({ deletedAt: now, localDirty: true, localUpdatedAtMs, updatedAt: now })
        .where(and(inArray(exerciseSets.sessionExerciseId, cardIds), isNull(exerciseSets.deletedAt)))
        .run();
    }
  });
  if (updated) {
    notifyLocalWrite();
  }
};


/** See {@link SessionPlanStore}. */
const findActiveSessionIdBySourcePlan = async (planId: string): Promise<string | null> => {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(eq(sessions.sourcePlanId, planId), eq(sessions.status, 'active'), isNull(sessions.deletedAt)),
      )
      .orderBy(desc(sessions.updatedAt))
      .get();
    return row?.id ?? null;
  };


/** See {@link SessionPlanStore}. */
const findActiveSessionId = async (): Promise<string | null> => {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.status, 'active'), isNull(sessions.deletedAt)))
      .orderBy(desc(sessions.updatedAt))
      .get();
    return row?.id ?? null;
  };


/** See {@link SessionPlanStore}. */
const findSourcedCardPerformances = async (planExerciseId: string): Promise<{ cardId: string; sessionId: string; sets: { id: string; sourcePlanSetId: string | null; repsValue: string; weightValue: string; performanceStatus: string | null }[] } | null> => {
    const database = await bootstrapLocalDataLayer();
    let result: {
      cardId: string;
      sessionId: string;
      sets: {
        id: string;
        sourcePlanSetId: string | null;
        repsValue: string;
        weightValue: string;
        performanceStatus: string | null;
      }[];
    } | null = null;
    database.transaction((tx) => {
      const card = findLiveSourcedCardForBlockInTransaction(tx, planExerciseId);
      if (!card) {
        return;
      }
      result = {
        cardId: card.id,
        sessionId: card.sessionId,
        sets: tx
          .select({
            id: exerciseSets.id,
            sourcePlanSetId: exerciseSets.sourcePlanSetId,
            repsValue: exerciseSets.repsValue,
            weightValue: exerciseSets.weightValue,
            performanceStatus: exerciseSets.performanceStatus,
          })
          .from(exerciseSets)
          .where(and(eq(exerciseSets.sessionExerciseId, card.id), isNull(exerciseSets.deletedAt)))
          .orderBy(asc(exerciseSets.orderIndex))
          .all(),
      };
    });
    return result;
  };


/** See {@link SessionPlanStore}. */
const resolvePlanBlock = async (input: { planExerciseId: string; status: 'completed' | 'skipped'; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let resolved = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const result = tx
        .update(sessionPlanExercises)
        .set({
          progressStatus: input.status,
          resolvedAt: input.now,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(sessionPlanExercises.id, input.planExerciseId),
            isNull(sessionPlanExercises.deletedAt),
            eq(sessionPlanExercises.progressStatus, 'pending'),
          ),
        )
        .run();
      resolved = result.changes > 0;
    });
    if (resolved) {
      notifyLocalWrite();
    }
    return resolved;
  };


/** See {@link SessionPlanStore}. */
const listSourcedCardsForBlocks = async (planExerciseIds: string[]): Promise<{ id: string; sessionId: string; sourcePlanExerciseId: string }[]> => {
    const database = await bootstrapLocalDataLayer();
    let cards: { id: string; sessionId: string; sourcePlanExerciseId: string }[] = [];
    database.transaction((tx) => {
      cards = listSourcedCardsForBlocksInTransaction(tx, planExerciseIds);
    });
    return cards;
  };


/** See {@link SessionPlanStore}. */
const listBlocksForPlans = async (planIds: string[]): Promise<PlanExerciseRow[]> => {
    const database = await bootstrapLocalDataLayer();
    let blocks: PlanExerciseRow[] = [];
    database.transaction((tx) => {
      blocks = listBlocksForPlansInTransaction(tx, planIds);
    });
    return blocks;
  };


/** See {@link SessionPlanStore}. */
const listSetsForBlocks = async (planExerciseIds: string[]): Promise<PlanSetRow[]> => {
    const database = await bootstrapLocalDataLayer();
    let sets: PlanSetRow[] = [];
    database.transaction((tx) => {
      sets = listSetsForBlocksInTransaction(tx, planExerciseIds);
    });
    return sets;
  };


/** See {@link SessionPlanStore}. */
const reorderProgrammePlans = async (input: { programmeId: string; orderedPlanIds: string[]; now: Date }): Promise<void> => {
    const database = await bootstrapLocalDataLayer();
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const plans = tx
        .select({ id: sessionPlans.id, programmeOrderIndex: sessionPlans.programmeOrderIndex })
        .from(sessionPlans)
        .where(
          and(
            eq(sessionPlans.programmeId, input.programmeId),
            isNull(sessionPlans.deletedAt),
          ),
        )
        .all();
      redensifyRowsInTransaction(
        plans.map((row) => ({ id: row.id, orderIndex: row.programmeOrderIndex ?? -1 })),
        input.orderedPlanIds,
        // Lift above every child row of the programme, tombstones included,
        // for the same consistency as the block/set reorders.
        liftBaseForRows(
          plans.map((row) => ({ orderIndex: row.programmeOrderIndex })),
        ),
        (id, index) => {
          tx.update(sessionPlans)
            .set({ programmeOrderIndex: index, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
            .where(eq(sessionPlans.id, id))
            .run();
        },
      );
      tx.update(trainingProgrammes)
        .set({ localDirty: true, localUpdatedAtMs, updatedAt: input.now })
        .where(eq(trainingProgrammes.id, input.programmeId))
        .run();
    });
    notifyLocalWrite();
  };


/** See {@link SessionPlanStore}. */
const reorderPlanExercises = async (input: { planId: string; orderedExerciseIds: string[]; now: Date }): Promise<void> => {
    const database = await bootstrapLocalDataLayer();
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const liveRows = tx
        .select({ id: sessionPlanExercises.id, orderIndex: sessionPlanExercises.orderIndex })
        .from(sessionPlanExercises)
        .where(and(eq(sessionPlanExercises.sessionPlanId, input.planId), isNull(sessionPlanExercises.deletedAt)))
        .orderBy(asc(sessionPlanExercises.orderIndex))
        .all();
      const liftBase = liftBaseForRows(
        tx
          .select({ orderIndex: sessionPlanExercises.orderIndex })
          .from(sessionPlanExercises)
          .where(eq(sessionPlanExercises.sessionPlanId, input.planId))
          .all(),
      );
      redensifyRowsInTransaction(
        liveRows,
        input.orderedExerciseIds,
        liftBase,
        (id, index) => {
          tx.update(sessionPlanExercises)
            .set({ orderIndex: index, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
            .where(eq(sessionPlanExercises.id, id))
            .run();
        },
      );
    });
    notifyLocalWrite();
  };


/** See {@link SessionPlanStore}. */
const reorderPlanSets = async (input: { planExerciseId: string; orderedSetIds: string[]; now: Date }): Promise<void> => {
    const database = await bootstrapLocalDataLayer();
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const liveRows = tx
        .select({ id: sessionPlanSets.id, orderIndex: sessionPlanSets.orderIndex })
        .from(sessionPlanSets)
        .where(
          and(
            eq(sessionPlanSets.sessionPlanExerciseId, input.planExerciseId),
            isNull(sessionPlanSets.deletedAt),
          ),
        )
        .orderBy(asc(sessionPlanSets.orderIndex))
        .all();
      const liftBase = liftBaseForRows(
        tx
          .select({ orderIndex: sessionPlanSets.orderIndex })
          .from(sessionPlanSets)
          .where(eq(sessionPlanSets.sessionPlanExerciseId, input.planExerciseId))
          .all(),
      );
      redensifyRowsInTransaction(
        liveRows,
        input.orderedSetIds,
        liftBase,
        (id, index) => {
          tx.update(sessionPlanSets)
            .set({ orderIndex: index, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
            .where(eq(sessionPlanSets.id, id))
            .run();
        },
      );
    });
    notifyLocalWrite();
  };


/** See {@link SessionPlanStore}. */
const tombstonePlan = async (input: { planId: string; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let tombstoned = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const result = tx
        .update(sessionPlans)
        .set({
          deletedAt: input.now,
          // Detach the tombstoned plan from its programme: the programme's
          // child list holds live plans only, and a revived plan returns as a
          // standalone schedule.
          programmeId: null,
          programmeOrderIndex: null,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(and(eq(sessionPlans.id, input.planId), isNull(sessionPlans.deletedAt)))
        .run();
      tombstoned = result.changes > 0;
      if (!tombstoned) {
        return;
      }
      for (const exercise of tx
        .select({ id: sessionPlanExercises.id })
        .from(sessionPlanExercises)
        .where(and(eq(sessionPlanExercises.sessionPlanId, input.planId), isNull(sessionPlanExercises.deletedAt)))
        .all()) {
        tx.update(sessionPlanExercises)
          .set({ deletedAt: input.now, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
          .where(eq(sessionPlanExercises.id, exercise.id))
          .run();
        for (const set of tx
          .select({ id: sessionPlanSets.id })
          .from(sessionPlanSets)
          .where(and(eq(sessionPlanSets.sessionPlanExerciseId, exercise.id), isNull(sessionPlanSets.deletedAt)))
          .all()) {
          tx.update(sessionPlanSets)
            .set({ deletedAt: input.now, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
            .where(eq(sessionPlanSets.id, set.id))
            .run();
        }
      }
    });
    if (tombstoned) {
      notifyLocalWrite();
    }
    return tombstoned;
  };


/** See {@link SessionPlanStore}. */
const tombstoneProgramme = async (input: { programmeId: string; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let tombstoned = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const result = tx
        .update(trainingProgrammes)
        .set({ deletedAt: input.now, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
        .where(and(eq(trainingProgrammes.id, input.programmeId), isNull(trainingProgrammes.deletedAt)))
        .run();
      tombstoned = result.changes > 0;
      if (!tombstoned) {
        return;
      }
      // Match the server FK's ON DELETE SET NULL: the plans survive as
      // standalone plans with their schedules and targets intact.
      tx.update(sessionPlans)
        .set({ programmeId: null, programmeOrderIndex: null, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
        .where(and(eq(sessionPlans.programmeId, input.programmeId), isNull(sessionPlans.deletedAt)))
        .run();
    });
    if (tombstoned) {
      notifyLocalWrite();
    }
    return tombstoned;
  };


/** See {@link SessionPlanStore}. */
const tombstonePlanExercise = async (input: { planExerciseId: string; now: Date }): Promise<boolean> => {
    const database = await bootstrapLocalDataLayer();
    let tombstoned = false;
    database.transaction((tx) => {
      const localUpdatedAtMs = nowMonotonic(tx);
      const block = tx
        .select({
          id: sessionPlanExercises.id,
          sessionPlanId: sessionPlanExercises.sessionPlanId,
          deletedAt: sessionPlanExercises.deletedAt,
        })
        .from(sessionPlanExercises)
        .where(eq(sessionPlanExercises.id, input.planExerciseId))
        .get();
      if (!block || block.deletedAt !== null) {
        return;
      }
      // Park the tombstones out of the live `0..n-1` band: the local unique
      // `(parent, order_index)` indexes include tombstones, so a deleted set
      // keeps a re-parked slot and the deleted block moves above the plan's
      // current maximum — otherwise a later reorder of the surviving blocks
      // would collide with the deleted row.
      const maxSetIndex = tx
        .select({ orderIndex: sessionPlanSets.orderIndex })
        .from(sessionPlanSets)
        .where(eq(sessionPlanSets.sessionPlanExerciseId, block.id))
        .all()
        .reduce((max, row) => Math.max(max, row.orderIndex), -1);
      let setTombstoneCursor = Math.max(ORDER_INDEX_TOMBSTONE_BASE, maxSetIndex + 1);
      for (const set of tx
        .select({ id: sessionPlanSets.id })
        .from(sessionPlanSets)
        .where(
          and(eq(sessionPlanSets.sessionPlanExerciseId, block.id), isNull(sessionPlanSets.deletedAt)),
        )
        .all()) {
        tx.update(sessionPlanSets)
          .set({ orderIndex: setTombstoneCursor, deletedAt: input.now, localDirty: true, localUpdatedAtMs, updatedAt: input.now })
          .where(eq(sessionPlanSets.id, set.id))
          .run();
        setTombstoneCursor += 1;
      }
      const maxIndex = tx
        .select({ orderIndex: sessionPlanExercises.orderIndex })
        .from(sessionPlanExercises)
        .where(eq(sessionPlanExercises.sessionPlanId, block.sessionPlanId))
        .all()
        .reduce((max, row) => Math.max(max, row.orderIndex), -1);
      tx.update(sessionPlanExercises)
        .set({
          orderIndex: maxIndex + 1,
          deletedAt: input.now,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(eq(sessionPlanExercises.id, block.id))
        .run();
      tombstoned = true;
    });
    if (tombstoned) {
      notifyLocalWrite();
    }
    return tombstoned;
  };


/** See {@link SessionPlanStore}. */
const loadPlanGraph = async (planId: string): Promise<PlanGraph | null> => {
    const database = await bootstrapLocalDataLayer();
    const plan = database.select().from(sessionPlans).where(eq(sessionPlans.id, planId)).get();
    if (!plan || plan.deletedAt !== null) {
      return null;
    }
    return loadGraphForPlan(database, plan);
  };


/** See {@link SessionPlanStore}. */
const loadPlan = async (planId: string): Promise<PlanRow | null> => {
    const database = await bootstrapLocalDataLayer();
    const plan = database.select().from(sessionPlans).where(eq(sessionPlans.id, planId)).get();
    if (!plan || plan.deletedAt !== null) {
      return null;
    }
    return plan;
  };


/** See {@link SessionPlanStore}. */
const loadPlanBlock = async (planExerciseId: string): Promise<PlanBlockGraph | null> => {
    const database = await bootstrapLocalDataLayer();
    const exercise = database
      .select()
      .from(sessionPlanExercises)
      .where(eq(sessionPlanExercises.id, planExerciseId))
      .get();
    if (!exercise || exercise.deletedAt !== null) {
      return null;
    }
    const plan = database.select().from(sessionPlans).where(eq(sessionPlans.id, exercise.sessionPlanId)).get();
    if (!plan || plan.deletedAt !== null) {
      return null;
    }
    return {
      plan,
      exercise,
      sets: database
        .select()
        .from(sessionPlanSets)
        .where(
          and(eq(sessionPlanSets.sessionPlanExerciseId, exercise.id), isNull(sessionPlanSets.deletedAt)),
        )
        .orderBy(asc(sessionPlanSets.orderIndex))
        .all(),
    };
  };


/** See {@link SessionPlanStore}. */
const loadProgramme = async (programmeId: string): Promise<ProgrammeRow | null> => {
    const database = await bootstrapLocalDataLayer();
    const programme = database.select().from(trainingProgrammes).where(eq(trainingProgrammes.id, programmeId)).get();
    if (!programme || programme.deletedAt !== null) {
      return null;
    }
    return programme;
  };


/** See {@link SessionPlanStore}. */
const listProgrammes = async (): Promise<ProgrammeRow[]> => {
    const database = await bootstrapLocalDataLayer();
    return database
      .select()
      .from(trainingProgrammes)
      .where(isNull(trainingProgrammes.deletedAt))
      .orderBy(asc(trainingProgrammes.updatedAt))
      .all();
  };


/** See {@link SessionPlanStore}. */
const listPlanGraphsByProgramme = async (programmeId: string): Promise<PlanGraph[]> => {
    const database = await bootstrapLocalDataLayer();
    const plans = database
      .select()
      .from(sessionPlans)
      .where(and(eq(sessionPlans.programmeId, programmeId), isNull(sessionPlans.deletedAt)))
      .orderBy(asc(sessionPlans.programmeOrderIndex), asc(sessionPlans.createdAt))
      .all();
    return plans.map((plan) => loadGraphForPlan(database, plan));
  };


/** See {@link SessionPlanStore}. */
const listLivePlans = async (): Promise<PlanRow[]> => {
    const database = await bootstrapLocalDataLayer();
    return database
      .select()
      .from(sessionPlans)
      .where(isNull(sessionPlans.deletedAt))
      .orderBy(asc(sessionPlans.scheduledFor), asc(sessionPlans.createdAt))
      .all();
  };

export const createDrizzleSessionPlanStore = (): SessionPlanStore => ({
  savePlanGraph,
  saveProgrammeGraph,
  updateProgrammeMeta,
  updatePlanMeta,
  savePlanExerciseGraph,
  insertPlanExercise,
  findLiveSourcedCardForBlock,
  releaseDiscardedBlockClaims,
  findActiveSessionIdBySourcePlan,
  findActiveSessionId,
  findSourcedCardPerformances,
  resolvePlanBlock,
  listSourcedCardsForBlocks,
  listBlocksForPlans,
  listSetsForBlocks,
  reorderProgrammePlans,
  reorderPlanExercises,
  reorderPlanSets,
  tombstonePlan,
  tombstoneProgramme,
  tombstonePlanExercise,
  loadPlanGraph,
  loadPlan,
  loadPlanBlock,
  loadProgramme,
  listProgrammes,
  listPlanGraphsByProgramme,
  listLivePlans,
});

const loadGraphForPlan = (database: LocalDatabase, plan: PlanRow): PlanGraph => {
  const exercises = database
    .select()
    .from(sessionPlanExercises)
    .where(and(eq(sessionPlanExercises.sessionPlanId, plan.id), isNull(sessionPlanExercises.deletedAt)))
    .orderBy(asc(sessionPlanExercises.orderIndex))
    .all();
  const exerciseIds = exercises.map((row) => row.id);
  const sets = exerciseIds.length
    ? database
        .select()
        .from(sessionPlanSets)
        .where(and(inArray(sessionPlanSets.sessionPlanExerciseId, exerciseIds), isNull(sessionPlanSets.deletedAt)))
        .orderBy(asc(sessionPlanSets.orderIndex))
        .all()
    : [];
  const setsByExerciseId = sets.reduce<Map<string, PlanSetRow[]>>((acc, row) => {
    const current = acc.get(row.sessionPlanExerciseId) ?? [];
    current.push(row);
    acc.set(row.sessionPlanExerciseId, current);
    return acc;
  }, new Map());
  return {
    plan,
    exercises: exercises.map((exercise) => ({ ...exercise, sets: setsByExerciseId.get(exercise.id) ?? [] })),
  };
};

export {
  savePlanGraphInTransaction,
  redensifyRowsInTransaction,
  liftBaseForRows,
  findLiveSourcedCardForBlockInTransaction,
  listSourcedCardsForBlocksInTransaction,
  listBlocksForPlansInTransaction,
  listSetsForBlocksInTransaction,
};
