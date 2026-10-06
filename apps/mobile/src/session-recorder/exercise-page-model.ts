import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';
import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { calculateSetMetrics, type LoadContext } from '@/src/exercise-calculations/load-metrics';
import type { SessionDraftSetSnapshot } from '@/src/data/session-drafts';
import { defaultSessionSetType, formatSessionSetType, SESSION_SET_TYPE_CYCLE, type SessionSetTypeValue } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { deriveExercisePersonalRecord, type ExercisePersonalRecord } from '@/src/session-insights';
import { recordBandLines, type RecordLine } from '@/src/session-insights/record-band';

import {
  canonicalizeSetValues, canonicalizeWeightForReps, hasValidActualValues, isConfirmedPerformedSet,
} from '@/src/exercise-calculations/set-semantics';

/**
 * Pure rules of the exercise page. The
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
  // The session's record sets beating the records before this session — the
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

/** The session's blocks of this exercise, so the record is the session's. */
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

// The page without its session (a block on its own): one block, one definition.
const PAGE_BLOCK = 'exercise-page-block';
const PAGE_DEFINITION = 'exercise-page-definition';

/**
 * The exercise's records in the session, as the session view's cards take
 * them (`deriveExercisePersonalRecord`): every block of it, the page's own with
 * its live sets. Null without a baseline or a record.
 */
const pageRecordOf = (
  sets: readonly ExercisePageSet[],
  baseline: ExerciseRecordBaseline | null,
  context: LoadContext,
  session: SetRowSession | null,
): ExercisePersonalRecord | null => {
  const blocks = session
    ? session.blocks.map((block) => (block.id === session.blockId ? { id: block.id, sets } : block))
    : [{ id: PAGE_BLOCK, sets }];
  return deriveExercisePersonalRecord({
    exerciseDefinitionId: PAGE_DEFINITION,
    baseline,
    exercises: blocks.map((block, orderIndex) => ({
      id: block.id,
      orderIndex,
      exerciseDefinitionId: PAGE_DEFINITION,
      exerciseName: '',
      loadContext: context,
      sets: block.sets.map((set, setIndex) => ({
        id: set.id,
        orderIndex: setIndex,
        weightValue: set.weightValue,
        repsValue: set.repsValue,
        setType: set.setType,
        performanceStatus: set.performanceStatus,
      })),
    })),
  });
};

/**
 * Builds the rows. Every figure takes its row's colour and weight; the only
 * highlights are the session's record sets (`training-metrics-contract.md`
 * §3): the performed working set whose 1RM beats the 1RM record, and the one
 * whose Weight beats the Weight record, across every block of the exercise in
 * the session. A warm-up keeps its own figures but is never a record.
 */
export const buildSetRows = (
  sets: ExercisePageSet[],
  baseline: ExerciseRecordBaseline | null = null,
  context: LoadContext,
  session: SetRowSession | null = null,
): SetRowView[] => {
  const cursorIndex = findCursorIndex(sets);
  const recordSets = pageRecordOf(sets, baseline, context, session)?.sets ?? [];
  return sets.map((set, index): SetRowView => {
    const values = displayedValues(set);
    const recordSet = recordSets.find((candidate) => candidate.setId === set.id);
    return {
      id: set.id,
      number: index + 1,
      kind: isPerformed(set) ? 'performed' : 'pending',
      isCursor: index === cursorIndex,
      setType: values.setType,
      ...metricsOf(values.weightValue, values.repsValue, context),
      weightRecord: recordSet?.topWeight ?? false,
      oneRepMaxRecord: recordSet?.oneRepMax ?? false,
    };
  });
};

/**
 * The set list's `record` band, the session view card's words
 * (`recordBandLines`): a line per record this block holds, Volume on the
 * exercise's first block. Empty without a record.
 */
export const recordBandFor = (
  sets: ExercisePageSet[],
  baseline: ExerciseRecordBaseline | null,
  context: LoadContext,
  session: SetRowSession | null = null,
): RecordLine[] => {
  const record = pageRecordOf(sets, baseline, context, session);
  return record === null ? [] : recordBandLines(record, session?.blockId ?? PAGE_BLOCK);
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
 * Swipe-left drop (`ux-rules.md` "Swipes on the exercise page"), for a row not yet performed:
 * - an ad-hoc row (no plan) is removed from the list;
 * - a planned row the lifter has touched returns to its pristine state —
 *   typed weight and reps clear and its actual effort goes back to blank, so
 *   it reads as its plan again (the display falls back to the prescribed
 *   effort). It keeps its place, and the cursor stays on it.
 * Returns the same array when there is nothing to drop: an untouched planned
 * row, or a performed row (the glyph un-performs it; a swipe never touches it).
 */
export const dropSet = (sets: ExercisePageSet[], setId: string): ExercisePageSet[] => {
  const set = sets.find((candidate) => candidate.id === setId);
  if (!set || isPerformed(set)) return sets;
  if (!hasPlannedValues(set)) return sets.filter((candidate) => candidate.id !== setId);
  const untouched = !hasEnteredValues(set) && (set.setType ?? null) === null;
  if (untouched) return sets;
  return replaceSet(sets, setId, (current) => ({
    ...current,
    weightValue: '',
    repsValue: '',
    setType: null,
  }));
};

/** Whether swipe-left would change the row: the page offers the drop only then. */
export const canDropSet = (sets: ExercisePageSet[], setId: string): boolean =>
  dropSet(sets, setId) !== sets;

/** Whether swipe-right would confirm the row: its displayed values are a valid set. */
export const canConfirmSet = (sets: ExercisePageSet[], setId: string): boolean => {
  const set = sets.find((candidate) => candidate.id === setId);
  return set !== undefined && canCommitLogger(loggerValuesFor(set));
};

export const createLocalSetId = () =>
  `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `+ Add set`: copies the last row's values and applies effort defaults, not
 * performed until ticked.
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
