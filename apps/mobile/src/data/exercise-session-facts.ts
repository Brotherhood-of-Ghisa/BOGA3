// Local-only exercise session facts (spec 05, "Exercise session facts"):
// rebuild, drain and read. Triggers (migration 0012) queue every definition a
// raw-data or policy write touches; every read drains that queue first, so a
// read never returns facts built from older rows or older rules.

import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { personalLoadContext } from '@/src/exercise-calculations/analytics';
import {
  createRecordBook, type RecordBaseline, type RecordEntry, type WeightRecordValue,
} from '@/src/exercise-calculations/records';
import {
  canonicalizeWeightForReps,
  normalizeSessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

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
  gyms,
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

/** Which sessions count toward one exercise's all-time bests. */
export type ExerciseBestsScope = {
  exerciseDefinitionId: string;
  /** Omitted: every gym. `null`: only sessions with no gym. */
  gymId?: string | null;
  /** Only the sessions before this completed session, in PR-history order. */
  beforeSessionId?: string | null;
};

export type ExerciseBestSession = {
  sessionId: string;
  completedAt: Date;
  gymId: string | null;
  gymName: string | null;
};

export type ExerciseBests = {
  oneRepMax: (ExerciseBestSession & { value: number; weight: number; reps: number }) | null;
  topWeight: (ExerciseBestSession & { weight: number; reps: number }) | null;
  /** The best complete session volume. */
  volume: (ExerciseBestSession & { value: number; workingSets: number }) | null;
  /** The newest session in scope: every fact row has a working set. */
  latest: ExerciseBestSession | null;
};

const bestE1rmSet = alias(exerciseSets, 'best_e1rm_set');
const topWeightSet = alias(exerciseSets, 'top_weight_set');

const bestsColumns = {
  sessionId: exerciseSessionFacts.sessionId,
  completedAt: exerciseSessionFacts.achievedAt,
  gymId: sessions.gymId,
  gymName: gyms.name,
  bestE1rmKg: exerciseSessionFacts.bestE1rmKg,
  e1rmWeightValue: bestE1rmSet.weightValue,
  e1rmRepsValue: bestE1rmSet.repsValue,
  topWeightKg: exerciseSessionFacts.topWeightKg,
  topWeightRepsValue: topWeightSet.repsValue,
  volumeKg: exerciseSessionFacts.volumeKg,
  volumeComplete: exerciseSessionFacts.volumeComplete,
  workingSets: exerciseSessionFacts.workingSets,
};

type BestsRow = {
  exerciseDefinitionId: string;
  sessionId: string;
  completedAt: Date;
  gymId: string | null;
  gymName: string | null;
  bestE1rmKg: number | null;
  e1rmWeightValue: string | null;
  e1rmRepsValue: string | null;
  topWeightKg: number | null;
  topWeightRepsValue: string | null;
  volumeKg: number | null;
  volumeComplete: boolean;
  workingSets: number;
};

// The derivation names its best sets in the same drained transaction, so a
// missing or unparseable set is a facts bug, not a user state.
const bestSetReps = (repsValue: string | null): number => {
  const reps = parseSetReps(repsValue);
  if (reps === null) throw new Error('exercise session fact names a missing or invalid set');
  return reps;
};

const bestSetWeight = (weightValue: string | null, repsValue: string | null): number => {
  const weight = parseSetWeight(canonicalizeWeightForReps(weightValue ?? '', repsValue ?? ''));
  if (weight === null) throw new Error('exercise session fact names a missing or invalid set');
  return weight;
};

const gymScope = (gymId: string | null | undefined) => {
  if (gymId === undefined) return undefined;
  return gymId === null ? isNull(sessions.gymId) : eq(sessions.gymId, gymId);
};

/** Keeps the rows before `beforeSessionId` in PR-history order. */
const rowsBefore = (database: LocalDatabase, rows: BestsRow[], beforeSessionId: string | null | undefined) => {
  if (!beforeSessionId) return rows;
  const target = database.select({ completedAt: sessions.completedAt }).from(sessions)
    .where(eq(sessions.id, beforeSessionId)).get();
  const completedAt = target?.completedAt;
  if (!completedAt) throw new Error(`session ${beforeSessionId} is not completed`);
  return rows.filter((row) => compareFactSessionOrder(row, { completedAt, sessionId: beforeSessionId }) < 0);
};

/** Folds rows in PR-history order through the record book (`records.ts`). */
const pickBests = (rows: BestsRow[]): ExerciseBests => {
  const book = createRecordBook<RecordEntry & {
    oneRepMax: ExerciseBests['oneRepMax'];
    weight: (WeightRecordValue & ExerciseBestSession) | null;
    volume: ExerciseBests['volume'];
  }>();
  let latest: ExerciseBestSession | null = null;
  for (const row of rows) {
    const session = { sessionId: row.sessionId, completedAt: row.completedAt, gymId: row.gymId, gymName: row.gymName };
    book.add({
      oneRepMax: row.bestE1rmKg === null ? null : {
        ...session,
        value: row.bestE1rmKg,
        weight: bestSetWeight(row.e1rmWeightValue, row.e1rmRepsValue),
        reps: bestSetReps(row.e1rmRepsValue),
      },
      weight: row.topWeightKg === null ? null : { ...session, weight: row.topWeightKg, reps: bestSetReps(row.topWeightRepsValue) },
      volume: row.volumeComplete && row.volumeKg !== null ? { ...session, value: row.volumeKg, workingSets: row.workingSets } : null,
    });
    latest = session;
  }
  const { oneRepMax, weight, volume } = book.holders;
  return { oneRepMax, topWeight: weight, volume, latest };
};

const selectBestsRows = (database: LocalDatabase, where: SQL | undefined) =>
  database.select({ ...bestsColumns, exerciseDefinitionId: exerciseSessionFacts.exerciseDefinitionId })
    .from(exerciseSessionFacts)
    .innerJoin(sessions, liveSessionJoin)
    .leftJoin(gyms, eq(gyms.id, sessions.gymId))
    .leftJoin(bestE1rmSet, eq(bestE1rmSet.id, exerciseSessionFacts.bestE1rmSetId))
    .leftJoin(topWeightSet, eq(topWeightSet.id, exerciseSessionFacts.topWeightSetId))
    .where(where)
    .all()
    .sort(compareFactSessionOrder);

/**
 * One exercise's all-time 1RM, top weight and best complete volume, each with
 * its session, gym and (for 1RM and top weight) the set that holds it, plus
 * the newest session in scope.
 */
export const loadExerciseBests = async (scope: ExerciseBestsScope): Promise<ExerciseBests> => {
  const database = await bootstrapLocalDataLayer();
  drainExerciseSessionFacts(database);
  const rows = selectBestsRows(database, and(
    eq(exerciseSessionFacts.exerciseDefinitionId, scope.exerciseDefinitionId),
    gymScope(scope.gymId),
  ));
  return pickBests(rowsBefore(database, rows, scope.beforeSessionId));
};

/**
 * Each listed definition's records over every gym's sessions before `target`
 * in PR-history order: the records the target's sets are compared with. The
 * same fold as `loadExerciseBests`; a definition with no earlier fact row is
 * absent.
 */
export const loadEarlierBestsByDefinition = async (
  target: { sessionId: string; completedAt: Date },
  exerciseDefinitionIds: readonly string[],
): Promise<Map<string, ExerciseBests>> => {
  const bests = new Map<string, ExerciseBests>();
  if (exerciseDefinitionIds.length === 0) return bests;
  const database = await bootstrapLocalDataLayer();
  drainExerciseSessionFacts(database);
  const before = (row: BestsRow) => compareFactSessionOrder(row, target) < 0;
  for (const ids of chunks(exerciseDefinitionIds)) {
    const rows = selectBestsRows(database, and(
      inArray(exerciseSessionFacts.exerciseDefinitionId, ids),
      lte(exerciseSessionFacts.achievedAt, target.completedAt),
    )).filter(before);
    const rowsByDefinition = new Map<string, BestsRow[]>();
    for (const row of rows) {
      const group = rowsByDefinition.get(row.exerciseDefinitionId) ?? [];
      group.push(row);
      rowsByDefinition.set(row.exerciseDefinitionId, group);
    }
    for (const [definitionId, group] of rowsByDefinition) bests.set(definitionId, pickBests(group));
  }
  return bests;
};

/**
 * The records a session's sets are compared with (`pickSessionRecordSet`),
 * per definition, from `loadEarlierBestsByDefinition`.
 */
export const recordBaselinesOf = (
  bestsByDefinition: ReadonlyMap<string, ExerciseBests>,
): Map<string, RecordBaseline> =>
  new Map(Array.from(bestsByDefinition, ([definitionId, { oneRepMax, topWeight }]) => [definitionId, {
    oneRepMax: oneRepMax?.value ?? null,
    weight: topWeight ? { weight: topWeight.weight, reps: topWeight.reps } : null,
  }]));
