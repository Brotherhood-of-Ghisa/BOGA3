import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { reviewLegacyLoad, type LegacyLoadChoice, type ReviewedLoad } from '@/src/bodyweight/legacy-load';
import { isValidSessionWeight } from '@/src/bodyweight/weight-entry';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions } from './schema';

type Reader = Pick<Transaction, 'select'>;
type LoadPart = 'actual' | 'planned';
const withoutDirtyFlag = <T extends { localDirty: boolean }>(row: T) => {
  return { ...row, localDirty: undefined }; 
};
export type LegacyLoadCandidate = {
  key: string;
  setId: string;
  part: LoadPart;
  sessionId: string;
  startedAt: Date;
  setNumber: number;
  weightValue: string;
  repsValue: string;
  storedUnit: string | null;
  bodyWeightKg: number | null;
  bodyWeightSource: string | null;
  bodyWeightMeasuredAt: Date | null;
  bodyWeightMeasurementId: string | null;
  metadataKnown: boolean;
};

export type LegacyLoadInventory = {
  exerciseId: string;
  exerciseName: string;
  bodyweightCoefficient: number;
  loadInputMode: string;
  metadataKnown: boolean;
  candidates: LegacyLoadCandidate[];
  /** Captures membership and source versions, including invalid/unselected rows. */
  fingerprint: string;
};

const readInventory = (database: Reader, exerciseId: string): LegacyLoadInventory => {
  const definition = database.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, exerciseId)).get();
  if (!definition || definition.deletedAt) throw new Error('This exercise is no longer available.');
  const rows = database.select({ set: exerciseSets, exercise: sessionExercises, session: sessions })
    .from(exerciseSets).innerJoin(sessionExercises, eq(exerciseSets.sessionExerciseId, sessionExercises.id))
    .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
    .where(and(eq(sessionExercises.exerciseDefinitionId, exerciseId), isNull(exerciseSets.deletedAt),
      isNull(sessionExercises.deletedAt), isNull(sessions.deletedAt),
      or(eq(sessions.status, 'active'), eq(sessions.status, 'completed'))))
    .orderBy(asc(sessions.startedAt), asc(exerciseSets.id)).all();
  const candidates = rows.flatMap(({ set, session }): LegacyLoadCandidate[] => {
    const common = { setId: set.id, sessionId: session.id, startedAt: session.startedAt,
      setNumber: set.orderIndex + 1,
      bodyWeightKg: session.localBodyweightMetadataKnown && isValidSessionWeight(session) ? session.bodyWeightKg : null,
      bodyWeightSource: session.bodyWeightSource, bodyWeightMeasurementId: session.bodyWeightMeasurementId, bodyWeightMeasuredAt: session.bodyWeightMeasuredAt,
      metadataKnown: set.localBodyweightMetadataKnown };
    const result: LegacyLoadCandidate[] = [];
    if ((!set.localBodyweightMetadataKnown || (definition.bodyweightCoefficient > 0 && set.externalLoadMode === null)) &&
        (set.weightValue.trim() || set.repsValue.trim())) {
      result.push({ ...common, key: `${set.id}:actual`, part: 'actual', weightValue: set.weightValue,
        repsValue: set.repsValue, storedUnit: set.weightUnit });
    }
    if ((!set.localBodyweightMetadataKnown || (definition.bodyweightCoefficient > 0 && set.plannedExternalLoadMode === null)) &&
        (set.plannedWeightValue?.trim() || set.plannedRepsValue?.trim())) {
      result.push({ ...common, key: `${set.id}:planned`, part: 'planned', weightValue: set.plannedWeightValue ?? '',
        repsValue: set.plannedRepsValue ?? '', storedUnit: set.plannedWeightUnit });
    }
    return result;
  });
  return { exerciseId, exerciseName: definition.name, bodyweightCoefficient: definition.bodyweightCoefficient,
    loadInputMode: definition.loadInputMode, metadataKnown: definition.localBodyweightMetadataKnown,
    candidates, fingerprint: JSON.stringify({ definition: withoutDirtyFlag(definition),
      rows: rows.map(row => ({ set: withoutDirtyFlag(row.set), exercise: withoutDirtyFlag(row.exercise), session: withoutDirtyFlag(row.session) })) }) };
};

export const listLegacyLoads = async (exerciseId: string): Promise<LegacyLoadInventory> =>
  readInventory(await bootstrapLocalDataLayer(), exerciseId);

export type LegacyLoadSelection = { key: string; choice: LegacyLoadChoice };
export type LegacyLoadPreview = {
  exerciseId: string;
  fingerprint: string;
  selections: LegacyLoadSelection[];
  rows: { original: LegacyLoadCandidate; reviewed: ReviewedLoad }[];
};

/** Pure preview; original text stays alongside the proposed explicit interpretation. */
export const previewLegacyLoads = (inventory: LegacyLoadInventory, selections: LegacyLoadSelection[]): LegacyLoadPreview => {
  if (!inventory.metadataKnown) throw new Error('Sync or explicitly configure the exercise rules before reviewing these loads.');
  if (selections.length === 0) throw new Error('Select at least one old load to review.');
  const seen = new Set<string>();
  const rows = selections.map(({ key, choice }) => {
    if (seen.has(key)) throw new Error('A load can only be selected once.');
    seen.add(key);
    const original = inventory.candidates.find(row => row.key === key);
    if (!original) throw new Error('The selected load is no longer unresolved. Refresh the review.');
    return { original, reviewed: reviewLegacyLoad(original, {
      bodyweightCoefficient: inventory.bodyweightCoefficient, loadInputMode: inventory.loadInputMode,
      bodyWeightKg: original.bodyWeightKg,
    }, choice) };
  });
  for (const { original } of rows) {
    if (original.metadataKnown) continue;
    const required = inventory.candidates.filter(row => row.setId === original.setId);
    if (required.some(row => !seen.has(row.key))) {
      throw new Error('Review both actual and planned loads for this set before replacing unavailable saved metadata.');
    }
  }
  return { exerciseId: inventory.exerciseId, fingerprint: inventory.fingerprint,
    selections: selections.map(selection => ({ key: selection.key, choice: { ...selection.choice } })), rows };
};

export const applyLegacyLoadReview = async (preview: LegacyLoadPreview, now = new Date()): Promise<number> => {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid save time.');
  const database = await bootstrapLocalDataLayer();
  const count = database.transaction((tx: Transaction) => {
    const current = readInventory(tx, preview.exerciseId);
    if (current.fingerprint !== preview.fingerprint) {
      throw new Error('The exercise, sessions or sets changed. Refresh the preview before applying.');
    }
    // Recompute from the transaction's source rows; never trust converted values
    // carried by a rendered preview. A failure leaves every selected row alone.
    const verified = previewLegacyLoads(current, preview.selections);
    // An explicit full-row review replaces the unavailable tuple atomically.
    // Empty counterparts have no load interpretation; nonempty parts are all
    // recomputed below before known=true can leave this transaction.
    const unknownSetIds = new Set(verified.rows.filter(row => !row.original.metadataKnown).map(row => row.original.setId));
    for (const setId of unknownSetIds) {
      tx.update(exerciseSets).set({ weightUnit: 'kg', externalLoadMode: null,
        plannedWeightUnit: null, plannedExternalLoadMode: null }).where(eq(exerciseSets.id, setId)).run();
    }
    for (const { original, reviewed } of verified.rows) {
      const values = original.part === 'actual'
        ? { weightValue: reviewed.weightValue, weightUnit: reviewed.weightUnit, externalLoadMode: reviewed.externalLoadMode }
        : { plannedWeightValue: reviewed.weightValue, plannedWeightUnit: reviewed.weightUnit,
          plannedExternalLoadMode: reviewed.externalLoadMode };
      tx.update(exerciseSets).set({ ...values, localBodyweightMetadataKnown: true,
        localDirty: true, localUpdatedAtMs: nowMonotonic(tx), updatedAt: now })
        .where(eq(exerciseSets.id, original.setId)).run();
    }
    return verified.rows.length;
  });
  if (count > 0) notifyLocalWrite();
  return count;
};
