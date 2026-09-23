import type { SessionDraftSetSnapshot } from '@/src/data/session-drafts';
import { defaultSessionSetType, formatSessionSetType, SESSION_SET_TYPE_CYCLE, type SessionSetTypeValue } from '@/src/data/set-types';
import {
  computeSetVolume,
  estimateOneRepMax,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';

import { canonicalizeSetValues, hasValidActualValues, isConfirmedPerformedSet } from './set-semantics';

/**
 * Pure rules of the exercise page (docs/plans/exercise-session-build-spec.md,
 * "Exercise page"). The page edits one session exercise's set rows; every rule
 * about what a row *is* comes from `set-semantics.ts`, so this module only
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
  // A performed weight or 1RM beating the all-time best before today — the
  // only figures the row highlights (`design-language.md` §5).
  weightRecord: boolean;
  oneRepMaxRecord: boolean;
};

// The lifter's all-time bests before today, from completed history. A value
// today that beats one of these is a record (`design-language.md` §5).
export type ExerciseRecordBaseline = {
  oneRepMax: number | null;
  weight: number | null;
};

export const EFFORT_OPTIONS = SESSION_SET_TYPE_CYCLE;

export const formatEffort = (setType: SessionSetTypeValue): string =>
  formatSessionSetType(setType) ?? '—';

// `60.0`, `82.5`, `2.25`: one decimal unless the lifter entered more.
export const formatWeight = (weight: number): string =>
  Number.isInteger(weight * 10) ? weight.toFixed(1) : `${weight}`;

export const formatOneRepMax = (value: number): string => value.toFixed(1);

// No thousands separators (`design-language.md` §6).
export const formatVolume = (value: number): string => `${Math.round(value)}`;

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
): { weightValue: string; repsValue: string; setType: SessionSetTypeValue } => {
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

const metricsOf = (weightValue: string, repsValue: string) => {
  const weight = parseSetWeight(weightValue);
  const reps = parseSetReps(repsValue);
  if (weight === null || reps === null) {
    return { weight, reps, oneRepMax: null, volume: null };
  }
  return {
    weight,
    reps,
    oneRepMax: estimateOneRepMax(weight, reps),
    volume: computeSetVolume(weight, reps),
  };
};

export const previewMetrics = (weightValue: string, repsValue: string) => {
  const { oneRepMax, volume } = metricsOf(weightValue, repsValue);
  return { oneRepMax, volume };
};

/**
 * Builds the rows. Every figure takes its row's colour and weight; the one
 * highlight is a performed weight or 1RM that beats the lifter's all-time best
 * before today, shown as a `record`. Volume is never one here: its record is a
 * whole session's, so no single set can beat it.
 */
export const buildSetRows = (
  sets: ExercisePageSet[],
  baseline: ExerciseRecordBaseline | null = null
): SetRowView[] => {
  const cursorIndex = findCursorIndex(sets);
  const beats = (value: number | null, record: number | null) =>
    value !== null && record !== null && value > record;
  return sets.map((set, index): SetRowView => {
    const values = displayedValues(set);
    const metrics = metricsOf(values.weightValue, values.repsValue);
    const performed = isPerformed(set);
    return {
      id: set.id,
      number: index + 1,
      kind: performed ? 'performed' : 'pending',
      isCursor: index === cursorIndex,
      setType: values.setType,
      ...metrics,
      weightRecord: performed && beats(metrics.weight, baseline?.weight ?? null),
      oneRepMaxRecord: performed && beats(metrics.oneRepMax, baseline?.oneRepMax ?? null),
    };
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
  values: {
    weightValue: string;
    repsValue: string;
    setType: SessionSetTypeValue;
  }
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

export const createLocalSetId = () =>
  `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `+ Add set`: copies the last row's values and applies effort defaults, not
 * performed until ticked (`ux-rules.md` §5.11).
 */
export const addSet = (sets: ExercisePageSet[], id: string = createLocalSetId()): ExercisePageSet[] => {
  const last = sets[sets.length - 1];
  const copied = last ? displayedValues(last) : { weightValue: '', repsValue: '', setType: null };
  return [
    ...sets,
    {
      id,
      weightValue: copied.weightValue,
      repsValue: copied.repsValue,
      setType: defaultSessionSetType(last ? copied.setType : undefined),
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
