import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';
import {
  pickSessionRecordSet, type RecordBaseline, type RecordSetCandidate,
} from '@/src/exercise-calculations/records';
import { calculateSetMetrics, type LoadContext } from '@/src/exercise-calculations/load-metrics';
import type { SessionDraftSetSnapshot } from '@/src/data/session-drafts';
import { defaultSessionSetType, formatSessionSetType, SESSION_SET_TYPE_CYCLE, type SessionSetTypeValue } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { recordBand, type RecordBand } from '@/src/session-insights/record-band';

import {
  canonicalizeSetValues, canonicalizeWeightForReps, hasValidActualValues, isConfirmedPerformedSet, isWorkingSet,
} from '@/src/exercise-calculations/set-semantics';

/**
 * Pure rules of the exercise page (`docs/specs/ui/ux-rules.md` §14a). The
 * page edits one session exercise's set rows; every rule about what a row
 * *is* comes from `set-semantics.ts`, so this module only
 * decides presentation (the cursor, records, displayed values) and the edits
 * the page's controls make.
 */

export type ExercisePageSet = SessionDraftSetSnapshot;

export type SetRowKind = 'performed' | 'pending';

export type SetRowView = {
  id: string;
  // 1-based position in the list, for `Set N` and accessibility labels.
  number: number;
  kind: SetRowKind;
  // True for the first row that is not performed: the set the lifter is on.
  isCursor: boolean;
  setType: SessionSetTypeValue;
  weight: number | null;
  reps: number | null;
  oneRepMax: number | null;
  volume: number | null;
  // The session's record set beating the records before this session — the
  // only figures the row highlights (`records.ts`, `design-language.md` §5).
  weightRecord: boolean;
  oneRepMaxRecord: boolean;
};

// The lifter's records before this session, from completed history: a value
// that beats one is a record (`records.ts`, `design-language.md` §5).
export type ExerciseRecordBaseline = RecordBaseline;

export const EFFORT_OPTIONS = SESSION_SET_TYPE_CYCLE;

export const formatEffort = (setType: SessionSetTypeValue): string =>
  formatSessionSetType(setType) ?? '—';


const isBlank = (value: string | null | undefined) => (value ?? '').trim().length === 0;

export const hasPlannedValues = (set: ExercisePageSet): boolean =>
  !isBlank(set.plannedWeightValue) || !isBlank(set.plannedRepsValue);

const hasEnteredValues = (set: ExercisePageSet): boolean =>
  !isBlank(set.weightValue) || !isBlank(set.repsValue);

export const isPerformed = (set: ExercisePageSet): boolean =>
  isConfirmedPerformedSet({
    weight: set.weightValue,
    reps: set.repsValue,
    performanceStatus: set.performanceStatus,
  });

/**
 * What a row shows. A performed row shows what was done. A row not yet
 * performed shows what the lifter has entered so far, or else its plan.
 */
export const displayedValues = (
  set: ExercisePageSet
): LoggerValues => {
  if (isPerformed(set) || hasEnteredValues(set) || !hasPlannedValues(set)) {
    return {
      weightValue: set.weightValue,
      repsValue: set.repsValue,
      setType: set.setType,
    };
  }
  return {
    weightValue: set.plannedWeightValue ?? '',
    repsValue: set.plannedRepsValue ?? '',
    setType: set.plannedSetType ?? set.setType ?? null,
  };
};

export const findCursorIndex = (sets: ExercisePageSet[]): number | null => {
  const index = sets.findIndex((set) => !isPerformed(set));
  return index === -1 ? null : index;
};

export type LoggerValues = {
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
};

const metricsOf = (weightValue: string, repsValue: string, context: LoadContext) => {
  weightValue = canonicalizeWeightForReps(weightValue, repsValue);
  const weight = parseSetWeight(weightValue);
  const reps = parseSetReps(repsValue);
  if (weight === null || reps === null) {
    return { weight, reps, oneRepMax: null, volume: null };
  }
  const resolved = calculateSetMetrics({ ...context, weightValue, repsValue, performanceStatus: null });
  return { weight, reps, oneRepMax: resolved.estimatedOneRepMaxKg, volume: resolved.volumeKgReps };
};

export const previewMetrics = (weightValue: string, repsValue: string, context: LoadContext) => {
  const { oneRepMax, volume } = metricsOf(weightValue, repsValue, context);
  return { oneRepMax, volume };
};

/** The session's blocks of this exercise, so the record is the session's (`ux-rules.md` §14a.4). */
export type SetRowSession = {
  blockId: string;
  blocks: readonly { id: string; sets: readonly ExercisePageSet[] }[];
};

/**
 * The page's block and the session's other blocks of its current exercise, in
 * session order. Filtering at render keeps the grouping right after a swap.
 */
export const sessionRecordBlocks = (
  block: { id: string; exerciseDefinitionId: string },
  sessionBlocks: readonly { id: string; exerciseDefinitionId: string; sets: readonly ExercisePageSet[] }[],
): SetRowSession => ({
  blockId: block.id,
  blocks: sessionBlocks.some((candidate) => candidate.id === block.id)
    ? sessionBlocks.filter((candidate) =>
      candidate.id === block.id || candidate.exerciseDefinitionId === block.exerciseDefinitionId)
    : [{ id: block.id, sets: [] }],
});

const recordCandidate = (set: ExercisePageSet, context: LoadContext): RecordSetCandidate | null => {
  if (!isWorkingSet({
    weight: set.weightValue, reps: set.repsValue, performanceStatus: set.performanceStatus, setType: set.setType,
  }, context.effortPolicy)) return null;
  const metrics = metricsOf(set.weightValue, set.repsValue, context);
  return { id: set.id, oneRepMax: metrics.oneRepMax, weight: metrics.weight, reps: metrics.reps };
};

/**
 * Builds the rows. Every figure takes its row's colour and weight; the one
 * highlight is the session's record set (`pickSessionRecordSet`): a performed
 * working set whose 1RM, else Weight, beats the lifter's records before this
 * session, across every block of the exercise in the session. A warm-up keeps
 * its own figures but is never a record. Volume is never one here: its record
 * is a whole session's, so no single set can beat it.
 */
export const buildSetRows = (
  sets: ExercisePageSet[],
  baseline: ExerciseRecordBaseline | null = null,
  context: LoadContext,
  session: SetRowSession | null = null,
): SetRowView[] => {
  const cursorIndex = findCursorIndex(sets);
  const sessionSets = session
    ? session.blocks.flatMap((block) => (block.id === session.blockId ? sets : block.sets))
    : sets;
  const winner = pickSessionRecordSet(
    sessionSets.flatMap((set) => recordCandidate(set, context) ?? []),
    baseline,
  );
  return sets.map((set, index): SetRowView => {
    const values = displayedValues(set);
    const metrics = metricsOf(values.weightValue, values.repsValue, context);
    const isWinner = winner !== null && winner.id === set.id;
    return {
      id: set.id,
      number: index + 1,
      kind: isPerformed(set) ? 'performed' : 'pending',
      isCursor: index === cursorIndex,
      setType: values.setType,
      ...metrics,
      weightRecord: isWinner && winner.weight,
      oneRepMaxRecord: isWinner && winner.oneRepMax,
    };
  });
};

export type SetListRecordBand = RecordBand;

/**
 * The record band for the set list, from the built rows: the session's record
 * set announced with the same words as the session view's card band
 * (`recordBand`). `null` when no performed set beats the baseline.
 */
export const recordBandFor = (rows: SetRowView[]): SetListRecordBand | null => {
  const winner = rows.find((row) => row.oneRepMaxRecord || row.weightRecord);
  if (!winner || winner.weight === null || winner.reps === null) return null;
  return recordBand({
    kind: winner.oneRepMaxRecord ? 'oneRepMax' : 'weight',
    weight: winner.weight,
    reps: winner.reps,
    estimatedOneRepMax: winner.oneRepMax,
  });
};

/** The values the logger opens with: the row as displayed. */
export const loggerValuesFor = (set: ExercisePageSet) => displayedValues(set);

export const canCommitLogger = (values: { weightValue: string; repsValue: string }): boolean =>
  hasValidActualValues({ weight: values.weightValue, reps: values.repsValue });

const replaceSet = (
  sets: ExercisePageSet[],
  setId: string,
  update: (set: ExercisePageSet) => ExercisePageSet
): ExercisePageSet[] => sets.map((set) => (set.id === setId ? update(set) : set));

/**
 * Logger typing. Values are written to the row as they are typed so autosave
 * keeps partial input; the row's status is left alone, so a planned row stays
 * planned (and not performed) until it is committed.
 */
export const updateLoggerValues = (
  sets: ExercisePageSet[],
  setId: string,
  values: {
    weightValue?: string;
    repsValue?: string;
    setType?: SessionSetTypeValue;
  }
): ExercisePageSet[] =>
  replaceSet(sets, setId, (set) => {
    const current = displayedValues(set);
    return {
      ...set,
      weightValue: values.weightValue ?? current.weightValue,
      repsValue: values.repsValue ?? current.repsValue,
      setType: values.setType !== undefined ? values.setType : current.setType,
    };
  });

/** The commit tick: the row becomes performed with the logger's values. */
export const commitSet = (
  sets: ExercisePageSet[],
  setId: string,
  values: LoggerValues
): ExercisePageSet[] => {
  if (!canCommitLogger(values)) return sets;
  const canonical = canonicalizeSetValues({
    weight: values.weightValue,
    reps: values.repsValue,
  });
  return replaceSet(sets, setId, (set) => ({
    ...set,
    weightValue: canonical.weight.trim(),
    repsValue: canonical.reps.trim(),
    setType: values.setType,
    performanceStatus: null,
  }));
};

/**
 * The row's glyph. A performed row goes back to not performed — to `planned`
 * when it came from a plan, so it keeps reading as one. A row that is not
 * performed but holds valid values (entered, or else planned) is performed
 * with them. Returns `null` when the row has nothing valid to perform, so the
 * caller opens it in the logger instead.
 */
export const toggleSetPerformed = (sets: ExercisePageSet[], setId: string): ExercisePageSet[] | null => {
  const set = sets.find((candidate) => candidate.id === setId);
  if (!set) return null;

  if (isPerformed(set)) {
    return replaceSet(sets, setId, (current) => ({
      ...current,
      performanceStatus: hasPlannedValues(current) ? 'planned' : 'unperformed',
    }));
  }

  const values = displayedValues(set);
  if (!canCommitLogger(values)) return null;
  return commitSet(sets, setId, values);
};

/**
 * Swipe-left drop: the in-progress entry is discarded — typed weight and reps
 * clear, and a planned row returns to its pristine state (its actual effort
 * back to blank, so it reads as its plan again; the display falls back to the
 * prescribed effort). The row keeps its place and its state otherwise: nothing
 * navigates and the cursor stays on it. An ad-hoc row keeps its effort (it has
 * no plan to revert to). Returns the same array when there is nothing to
 * discard; a performed row is never touched here (the glyph un-performs it).
 */
export const discardSetEntry = (sets: ExercisePageSet[], setId: string): ExercisePageSet[] => {
  const set = sets.find((candidate) => candidate.id === setId);
  if (!set || isPerformed(set)) return sets;
  const hasPlan = hasPlannedValues(set);
  const untouched = !hasEnteredValues(set) && (!hasPlan || (set.setType ?? null) === null);
  if (untouched) return sets;
  return replaceSet(sets, setId, (current) => ({
    ...current,
    weightValue: '',
    repsValue: '',
    setType: hasPlan ? null : current.setType,
  }));
};

export const createLocalSetId = () =>
  `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `+ Add set`: copies the last row's values and applies effort defaults, not
 * performed until ticked (`ux-rules.md` §5.11).
 */
export const addSet = (sets: ExercisePageSet[], id: string = createLocalSetId(), displayEfforts?: readonly EffortChoice[]): ExercisePageSet[] => {
  const last = sets[sets.length - 1];
  const copied = last ? displayedValues(last) : { weightValue: '', repsValue: '', setType: null };
  return [
    ...sets,
    {
      id,
      weightValue: copied.weightValue,
      repsValue: copied.repsValue,
      setType: defaultSessionSetType(last ? copied.setType : undefined, displayEfforts),
      plannedWeightValue: null,
      plannedRepsValue: null,
      plannedSetType: null,
      performanceStatus: 'unperformed',
    },
  ];
};

export type CompleteExercisePlan = {
  // Planned rows still waiting: Complete marks them `unperformed` and keeps
  // their planned triple, so "planned 5, did 3" stays answerable.
  plannedToDiscard: number;
  // Ad-hoc rows holding values that were never ticked: Complete removes them.
  unloggedToRemove: number;
  // True when Complete should ask before going ahead.
  needsConfirmation: boolean;
  nextSets: ExercisePageSet[];
};

/**
 * `Complete exercise`. Performed rows are untouched; planned rows still waiting
 * become `unperformed` (never deleted); ad-hoc rows that were not ticked are
 * removed, blank ones silently. A planned row already discarded by an earlier
 * Complete is left as it is.
 */
export const planCompleteExercise = (sets: ExercisePageSet[]): CompleteExercisePlan => {
  let plannedToDiscard = 0;
  let unloggedToRemove = 0;
  const nextSets: ExercisePageSet[] = [];

  for (const set of sets) {
    if (isPerformed(set)) {
      nextSets.push(set);
    } else if (set.performanceStatus === 'planned') {
      plannedToDiscard += 1;
      nextSets.push({ ...set, performanceStatus: 'unperformed' });
    } else if (hasPlannedValues(set)) {
      nextSets.push(set);
    } else if (hasEnteredValues(set)) {
      unloggedToRemove += 1;
    }
  }

  return {
    plannedToDiscard,
    unloggedToRemove,
    needsConfirmation: plannedToDiscard + unloggedToRemove > 0,
    nextSets,
  };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const describeCompleteExercisePlan = (plan: CompleteExercisePlan): string => {
  const parts: string[] = [];
  if (plan.plannedToDiscard > 0) {
    parts.push(`${plural(plan.plannedToDiscard, 'planned set')} will be discarded.`);
  }
  if (plan.unloggedToRemove > 0) {
    parts.push(`${plural(plan.unloggedToRemove, 'set')} you did not log will be removed.`);
  }
  return parts.join(' ');
};
