// Local-only exercise session facts (spec 05, "Exercise session facts"):
// rebuild, drain and read. Triggers (migration 0012) queue every definition a
// raw-data or policy write touches; every read drains that queue first, so a
// read never returns facts built from older rows or older rules.

import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';

import { personalLoadContext } from '@/src/exercise-calculations/analytics';
import { normalizeSessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import { loadAsOfWeightResolver } from './bodyweight';
import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import type { Transaction } from './clock';
import {
  compareFactSessionOrder,
  deriveExerciseSessionFacts,
  EXERCISE_SESSION_FACTS_RULES_VERSION,
  type ExerciseSessionFactRow,
  type FactsBlockInput,
  type FactsSessionInput,
} from './exercise-session-facts-derive';
import {
  exerciseDefinitions,
  exerciseSessionFacts,
  exerciseSessionFactsStale,
  exerciseSessionFactsState,
  exerciseSets,
  sessionExercises,
  sessions,
  userSettings,
} from './schema';

export type { ExerciseSessionFactRow } from './exercise-session-facts-derive';

type FactsTx = Pick<Transaction, 'select' | 'insert' | 'delete'>;

/** `all` rebuilds every definition; a list rebuilds just those. */
type DefinitionScope = 'all' | readonly string[];

// Stay well under SQLite's bound-parameter limit on IN lists and bulk inserts.
const CHUNK = 400;
const chunks = <T>(values: readonly T[], size = CHUNK): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const STATE_ID = 'facts';

const completedSessionFilter = and(
  eq(sessions.status, 'completed'),
  isNull(sessions.deletedAt),
  isNotNull(sessions.completedAt),
);

type BlockRow = {
  id: string;
  sessionId: string;
  exerciseDefinitionId: string | null;
  orderIndex: number;
  completedAt: Date | null;
  startedAt: Date;
};

const loadBlocks = (tx: FactsTx, definitionIds: readonly string[] | null): BlockRow[] => {
  const select = (definitionFilter?: ReturnType<typeof inArray>) => tx
    .select({
      id: sessionExercises.id,
      sessionId: sessionExercises.sessionId,
      exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
      orderIndex: sessionExercises.orderIndex,
      completedAt: sessions.completedAt,
      startedAt: sessions.startedAt,
    })
    .from(sessionExercises)
    .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
    .where(and(
      completedSessionFilter,
      isNull(sessionExercises.deletedAt),
      isNotNull(sessionExercises.exerciseDefinitionId),
      definitionFilter,
    ))
    .all();
  if (definitionIds === null) return select();
  return chunks(definitionIds).flatMap((ids) => select(inArray(sessionExercises.exerciseDefinitionId, ids)));
};

const loadSetsByBlock = (tx: FactsTx, blockIds: readonly string[]): Map<string, FactsBlockInput['sets']> => {
  const setsByBlock = new Map<string, FactsBlockInput['sets']>();
  for (const ids of chunks(blockIds)) {
    const rows = tx
      .select({
        id: exerciseSets.id,
        sessionExerciseId: exerciseSets.sessionExerciseId,
        orderIndex: exerciseSets.orderIndex,
        weightValue: exerciseSets.weightValue,
        repsValue: exerciseSets.repsValue,
        setType: exerciseSets.setType,
        performanceStatus: exerciseSets.performanceStatus,
      })
      .from(exerciseSets)
      .where(and(inArray(exerciseSets.sessionExerciseId, ids), isNull(exerciseSets.deletedAt)))
      .all();
    for (const { sessionExerciseId, performanceStatus, ...set } of rows) {
      const bucket = setsByBlock.get(sessionExerciseId) ?? [];
      bucket.push({ ...set, performanceStatus: normalizeSessionSetPerformanceStatus(performanceStatus) });
      setsByBlock.set(sessionExerciseId, bucket);
    }
  }
  return setsByBlock;
};

/** Personal calculation policy for each block, as the session-insights reader resolves it. */
const createLoadContextResolver = (tx: FactsTx, definitionIds: readonly string[]) => {
  const enabled = tx
    .select({ enabled: userSettings.bodyweightCalculationsEnabled })
    .from(userSettings)
    .where(eq(userSettings.id, 'settings'))
    .get()?.enabled ?? false;
  const definitions = new Map(chunks(definitionIds).flatMap((ids) => tx
    .select({
      id: exerciseDefinitions.id,
      bodyweightContribution: exerciseDefinitions.bodyweightContribution,
      loadInputMode: exerciseDefinitions.loadInputMode,
    })
    .from(exerciseDefinitions)
    .where(inArray(exerciseDefinitions.id, ids))
    .all()
    .map((definition) => [definition.id, definition] as const)));
  // Ordinary policy ignores readings, so skip the timeline read when calculations are off.
  const resolveWeight = enabled ? loadAsOfWeightResolver(tx) : () => null;
  return (definitionId: string, startedAt: Date) =>
    personalLoadContext(enabled, definitions.get(definitionId) ?? null, resolveWeight(startedAt));
};

/** Each definition's completed history, grouped by session. */
const loadDefinitionHistories = (
  tx: FactsTx,
  scope: DefinitionScope,
): Map<string, FactsSessionInput[]> => {
  const blocks = loadBlocks(tx, scope === 'all' ? null : scope);
  const setsByBlock = loadSetsByBlock(tx, blocks.map((block) => block.id));
  const definitionIds = [...new Set(blocks.map((block) => block.exerciseDefinitionId as string))];
  const loadContextFor = createLoadContextResolver(tx, definitionIds);

  const sessionsByDefinition = new Map<string, Map<string, FactsSessionInput>>();
  for (const block of blocks) {
    const definitionId = block.exerciseDefinitionId as string;
    const byId = sessionsByDefinition.get(definitionId) ?? new Map<string, FactsSessionInput>();
    const session = byId.get(block.sessionId) ??
      { sessionId: block.sessionId, completedAt: block.completedAt as Date, blocks: [] };
    session.blocks.push({
      id: block.id,
      orderIndex: block.orderIndex,
      loadContext: loadContextFor(definitionId, block.startedAt),
      sets: setsByBlock.get(block.id) ?? [],
    });
    byId.set(block.sessionId, session);
    sessionsByDefinition.set(definitionId, byId);
  }
  return new Map([...sessionsByDefinition].map(([id, byId]) => [id, [...byId.values()]]));
};

const writeFacts = (tx: FactsTx, scope: DefinitionScope): number => {
  if (scope === 'all') {
    tx.delete(exerciseSessionFacts).run();
  } else {
    for (const ids of chunks(scope)) {
      tx.delete(exerciseSessionFacts).where(inArray(exerciseSessionFacts.exerciseDefinitionId, ids)).run();
    }
  }
  const rows = [...loadDefinitionHistories(tx, scope)]
    .flatMap(([definitionId, history]) => deriveExerciseSessionFacts(definitionId, history));
  // 13 columns a row: 60 rows stay under the bound-parameter limit.
  for (const batch of chunks(rows, 60)) {
    tx.insert(exerciseSessionFacts).values(batch).run();
  }
  return rows.length;
};

/** Rebuilds the listed definitions' facts from the raw rows. */
export const rebuildExerciseSessionFactsForDefinitions = (
  tx: FactsTx,
  definitionIds: readonly string[],
): number => (definitionIds.length === 0 ? 0 : writeFacts(tx, definitionIds));

/** Rebuilds every definition's facts and records the rules version they were built under. */
export const rebuildAllExerciseSessionFacts = (tx: FactsTx): number => {
  const written = writeFacts(tx, 'all');
  tx.delete(exerciseSessionFactsStale).run();
  tx.insert(exerciseSessionFactsState)
    .values({ id: STATE_ID, rulesVersion: EXERCISE_SESSION_FACTS_RULES_VERSION })
    .onConflictDoUpdate({
      target: exerciseSessionFactsState.id,
      set: { rulesVersion: EXERCISE_SESSION_FACTS_RULES_VERSION },
    })
    .run();
  return written;
};

export type ExerciseSessionFactsDrain =
  | { kind: 'fresh' }
  | { kind: 'full'; rows: number }
  | { kind: 'incremental'; definitions: number; rows: number };

/**
 * Brings the facts up to date in one transaction: a full rebuild when the
 * table was never built or was built under other rules, otherwise a rebuild of
 * each queued definition.
 */
export const drainExerciseSessionFacts = (database: LocalDatabase): ExerciseSessionFactsDrain =>
  database.transaction((transaction) => {
    const tx = transaction as Transaction;
    const state = tx.select().from(exerciseSessionFactsState)
      .where(eq(exerciseSessionFactsState.id, STATE_ID)).get();
    if (state?.rulesVersion !== EXERCISE_SESSION_FACTS_RULES_VERSION) {
      return { kind: 'full', rows: rebuildAllExerciseSessionFacts(tx) };
    }
    const stale = tx.select().from(exerciseSessionFactsStale).all()
      .map((row) => row.exerciseDefinitionId);
    if (stale.length === 0) return { kind: 'fresh' };
    const rows = rebuildExerciseSessionFactsForDefinitions(tx, stale);
    tx.delete(exerciseSessionFactsStale).run();
    return { kind: 'incremental', definitions: stale.length, rows };
  });

/** Clears the facts, the queue and the built marker (account wipe). */
export const clearExerciseSessionFacts = (tx: Pick<Transaction, 'delete'>): void => {
  tx.delete(exerciseSessionFacts).run();
  tx.delete(exerciseSessionFactsStale).run();
  tx.delete(exerciseSessionFactsState).run();
};

const factColumns = {
  sessionId: exerciseSessionFacts.sessionId,
  exerciseDefinitionId: exerciseSessionFacts.exerciseDefinitionId,
  achievedAt: exerciseSessionFacts.achievedAt,
  bestE1rmKg: exerciseSessionFacts.bestE1rmKg,
  bestE1rmSetId: exerciseSessionFacts.bestE1rmSetId,
  topWeightKg: exerciseSessionFacts.topWeightKg,
  topWeightSetId: exerciseSessionFacts.topWeightSetId,
  volumeKg: exerciseSessionFacts.volumeKg,
  volumeComplete: exerciseSessionFacts.volumeComplete,
  workingSets: exerciseSessionFacts.workingSets,
  prE1rm: exerciseSessionFacts.prE1rm,
  prWeight: exerciseSessionFacts.prWeight,
  prVolume: exerciseSessionFacts.prVolume,
};

// Rows are FK-free: reads inner-join the live, completed, non-deleted session.
const liveSessionJoin = and(eq(sessions.id, exerciseSessionFacts.sessionId), completedSessionFilter);

// PR-history order is the derivation's own (`completed_at`, then session id by
// `localeCompare`), which SQLite's BINARY collation does not reproduce on ties.
const inHistoryOrder = (rows: ExerciseSessionFactRow[]): ExerciseSessionFactRow[] =>
  rows.sort((left, right) =>
    compareFactSessionOrder(
      { completedAt: left.achievedAt, sessionId: left.sessionId },
      { completedAt: right.achievedAt, sessionId: right.sessionId },
    ) || left.exerciseDefinitionId.localeCompare(right.exerciseDefinitionId));

/** One definition's facts in PR-history order (`completed_at`, then session id). */
export const loadExerciseSessionFacts = async (
  exerciseDefinitionId: string,
): Promise<ExerciseSessionFactRow[]> => {
  const database = await bootstrapLocalDataLayer();
  drainExerciseSessionFacts(database);
  return inHistoryOrder(database.select(factColumns).from(exerciseSessionFacts)
    .innerJoin(sessions, liveSessionJoin)
    .where(eq(exerciseSessionFacts.exerciseDefinitionId, exerciseDefinitionId))
    .all());
};

/** Facts carrying any PR flag with `from <= completed_at < to`, in PR-history order. */
export const loadFlaggedExerciseSessionFacts = async (
  window: { from: Date; to: Date },
): Promise<ExerciseSessionFactRow[]> => {
  const database = await bootstrapLocalDataLayer();
  drainExerciseSessionFacts(database);
  return inHistoryOrder(database.select(factColumns).from(exerciseSessionFacts)
    .innerJoin(sessions, liveSessionJoin)
    .where(and(
      gte(exerciseSessionFacts.achievedAt, window.from),
      lt(exerciseSessionFacts.achievedAt, window.to),
      or(
        eq(exerciseSessionFacts.prE1rm, true),
        eq(exerciseSessionFacts.prWeight, true),
        eq(exerciseSessionFacts.prVolume, true),
      ),
    ))
    .all());
};

/**
 * Each listed definition's best estimated 1RM over the sessions before
 * `target` in PR-history order: the bar the target's 1RM PR flag is set
 * against. A definition without an earlier 1RM is absent.
 */
export const loadEarlierBestE1rmByDefinition = async (
  target: { sessionId: string; completedAt: Date },
  exerciseDefinitionIds: readonly string[],
): Promise<Map<string, number>> => {
  const best = new Map<string, number>();
  if (exerciseDefinitionIds.length === 0) return best;
  const database = await bootstrapLocalDataLayer();
  drainExerciseSessionFacts(database);
  for (const ids of chunks(exerciseDefinitionIds)) {
    const rows = database
      .select({
        sessionId: exerciseSessionFacts.sessionId,
        exerciseDefinitionId: exerciseSessionFacts.exerciseDefinitionId,
        achievedAt: exerciseSessionFacts.achievedAt,
        bestE1rmKg: exerciseSessionFacts.bestE1rmKg,
      })
      .from(exerciseSessionFacts)
      .innerJoin(sessions, liveSessionJoin)
      .where(and(
        inArray(exerciseSessionFacts.exerciseDefinitionId, ids),
        lte(exerciseSessionFacts.achievedAt, target.completedAt),
        isNotNull(exerciseSessionFacts.bestE1rmKg),
      ))
      .all();
    for (const row of rows) {
      // Same-instant sessions fall to the derivation's session-id order, not SQLite's.
      if (compareFactSessionOrder({ completedAt: row.achievedAt, sessionId: row.sessionId }, target) >= 0) continue;
      const value = row.bestE1rmKg as number;
      if (value > (best.get(row.exerciseDefinitionId) ?? -Infinity)) best.set(row.exerciseDefinitionId, value);
    }
  }
  return best;
};
