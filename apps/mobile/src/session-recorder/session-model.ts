import type { Session, SessionExercise, SessionSet } from '@/components/session-recorder/types';
import type {
  ExerciseBlockHistorySuggestedSet,
  SessionDraftSnapshot,
  SessionGraphSnapshot,
} from '@/src/data';
import type { SessionInsightExerciseInput } from '@/src/session-insights';
import { normalizeSessionSetType, type SessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import {
  canonicalizeSetValues,
  canonicalizeWeightForReps,
  hasValidActualValues,
  isConfirmedPerformedSet,
} from '@/src/session-recorder/set-semantics';

/**
 * The recorder's session model: the in-memory `Session` shape, its mapping to
 * and from the persisted draft, set/exercise factories, and the submit-time
 * cleanup rules. Pure, and shared by the recorder route and the session view
 * (docs/plans/exercise-session-redesign.md, rule 2) so both write the session
 * tables through one copy of the rules.
 */

export function formatCurrentDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function parseSessionDateTime(dateTime: string): Date | null {
  const trimmed = dateTime.trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(trimmed);
  if (!matched) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = matched;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
}

// Reads an active draft or a completed session graph alike.
export function mapDraftSnapshotToSession(
  snapshot: Pick<SessionDraftSnapshot, 'startedAt' | 'gymId' | 'exercises'>
): Session {
  return {
    dateTime: formatCurrentDateTime(snapshot.startedAt),
    locationId: snapshot.gymId,
    exercises: snapshot.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      name: exercise.name,
      machineName: exercise.machineName ?? '',
      tags: [],
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.repsValue,
        weight: set.weightValue,
        setType: normalizeSessionSetType(set.setType),
        plannedReps: set.plannedRepsValue ?? null,
        plannedWeight: set.plannedWeightValue ?? null,
        plannedSetType: normalizeSessionSetType(set.plannedSetType),
        performanceStatus: set.performanceStatus ?? null,
      })),
    })),
  };
}

export function mapSessionGraphSnapshotToSession(snapshot: SessionGraphSnapshot): Session {
  return {
    dateTime: formatCurrentDateTime(snapshot.startedAt),
    locationId: snapshot.gymId,
    exercises: snapshot.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      name: exercise.name,
      machineName: exercise.machineName ?? '',
      tags: [],
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.repsValue,
        weight: set.weightValue,
        setType: normalizeSessionSetType(set.setType),
        plannedReps: set.plannedRepsValue ?? null,
        plannedWeight: set.plannedWeightValue ?? null,
        plannedSetType: normalizeSessionSetType(set.plannedSetType),
        performanceStatus: set.performanceStatus ?? null,
      })),
    })),
  };
}

export const toPersistDraftExercises = (session: Session) =>
  session.exercises.map((exercise) => ({
    id: exercise.id,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    name: exercise.name,
    machineName: exercise.machineName || null,
    sets: exercise.sets.map((set) => {
      const committedSet = canonicalizeSetValues(set);
      return {
        id: committedSet.id,
        repsValue: committedSet.reps,
        weightValue: committedSet.weight,
        setType: committedSet.setType,
        plannedRepsValue: committedSet.plannedReps,
        plannedWeightValue: committedSet.plannedWeight,
        plannedSetType: committedSet.plannedSetType,
        performanceStatus: committedSet.performanceStatus,
      };
    }),
  }));

export const canonicalizeSessionSetWeights = (session: Session): Session => {
  let sessionChanged = false;
  const exercises = session.exercises.map((exercise) => {
    let exerciseChanged = false;
    const sets = exercise.sets.map((set) => {
      const committedSet = canonicalizeSetValues(set);
      exerciseChanged = exerciseChanged || committedSet !== set;
      return committedSet;
    });

    if (!exerciseChanged) {
      return exercise;
    }

    sessionChanged = true;
    return { ...exercise, sets };
  });

  return sessionChanged ? { ...session, exercises } : session;
};

export function createExerciseId(): string {
  return `exercise-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSetId(): string {
  return `set-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type SetFieldName = keyof Pick<SessionSet, 'reps' | 'weight'>;

export const WEIGHT_INPUT_PATTERN = /^\d*\.?\d*$/;
export const REPS_INPUT_PATTERN = /^\d*$/;

export function createEmptySet(): SessionSet {
  return {
    id: createSetId(),
    reps: '',
    weight: '',
    setType: null,
    plannedReps: null,
    plannedWeight: null,
    plannedSetType: null,
    performanceStatus: 'unperformed',
  };
}

export function createSetFromPrevious(previousSet: SessionSet | undefined): SessionSet {
  if (!previousSet) {
    return createEmptySet();
  }

  return {
    id: createSetId(),
    reps: previousSet.reps,
    weight: previousSet.weight,
    setType: normalizeSessionSetType(previousSet.setType),
    plannedReps: null,
    plannedWeight: null,
    plannedSetType: null,
    performanceStatus: 'unperformed',
  };
}

export function createPlannedSetFromSuggestedSet(set: ExerciseBlockHistorySuggestedSet): SessionSet {
  return {
    id: createSetId(),
    reps: '',
    weight: '',
    setType: null,
    plannedReps: set.repsValue,
    plannedWeight: set.weightValue,
    plannedSetType: normalizeSessionSetType(set.setType),
    performanceStatus: 'planned',
  };
}

export const isNonNegativeDecimalInput = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
};

export const isPositiveIntegerInput = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }

  if (!/^\d+$/.test(trimmed)) {
    return false;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0;
};

export const hasSetFieldValidationError = (field: SetFieldName, value: string): boolean =>
  field === 'weight' ? !isNonNegativeDecimalInput(value) : !isPositiveIntegerInput(value);

export type PlannedSetRowState = 'planned' | 'matched' | 'modified' | 'added';
type PlannedSetMatchMode = 'volume' | 'quality' | 'volume-and-quality';

const PLANNED_SET_MATCH_MODE: PlannedSetMatchMode = 'volume';

export const hasPlannedTarget = (set: SessionSet): boolean =>
  set.plannedReps !== null || set.plannedWeight !== null || set.plannedSetType !== null;

export const hasPerformedActual = (set: SessionSet): boolean => isConfirmedPerformedSet(set);

const plannedSetVolumeMatches = (set: SessionSet): boolean =>
  canonicalizeWeightForReps(set.weight, set.reps).trim() ===
    canonicalizeWeightForReps(set.plannedWeight ?? '', set.plannedReps ?? '').trim() &&
  set.reps.trim() === (set.plannedReps ?? '').trim();

const plannedSetQualityMatches = (set: SessionSet): boolean =>
  normalizeSessionSetType(set.setType) === normalizeSessionSetType(set.plannedSetType);

const plannedSetMatches = (
  set: SessionSet,
  matchMode: PlannedSetMatchMode = PLANNED_SET_MATCH_MODE
): boolean => {
  switch (matchMode) {
    case 'quality':
      return plannedSetQualityMatches(set);
    case 'volume-and-quality':
      return plannedSetVolumeMatches(set) && plannedSetQualityMatches(set);
    case 'volume':
      return plannedSetVolumeMatches(set);
  }
};

export const getSetRowState = (set: SessionSet): PlannedSetRowState => {
  if (!hasPlannedTarget(set)) {
    return 'added';
  }

  if (set.performanceStatus === 'planned' || set.performanceStatus === 'skipped') {
    return 'planned';
  }

  if (!hasValidActualValues(set)) {
    return 'planned';
  }

  return plannedSetMatches(set) ? 'matched' : 'modified';
};

export const sessionHasInvalidSetValues = (session: Session): boolean =>
  session.exercises.some((exercise) =>
    exercise.sets.some(
      (set) =>
        getSetRowState(set) !== 'planned' &&
        (hasSetFieldValidationError('weight', set.weight) || hasSetFieldValidationError('reps', set.reps))
    )
  );

export const toCompletedHistorySession = (session: Session): Session => ({
  ...session,
  exercises: session.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.filter(hasPerformedActual).map((set) => ({
      ...set,
      plannedReps: null,
      plannedWeight: null,
      plannedSetType: null,
      performanceStatus: null,
    })),
  })),
});

export const toPersistCompletedExercises = (session: Session) =>
  toPersistDraftExercises(toCompletedHistorySession(session));

export function createExercise(exerciseDefinitionId: string, name: string): SessionExercise {
  return {
    id: createExerciseId(),
    exerciseDefinitionId,
    name,
    machineName: '',
    tags: [],
    sets: [createEmptySet()],
  };
}

export function removeIncompleteSets(session: Session): { session: Session; removedSets: number } {
  let removedSets = 0;

  const exercises = session.exercises.map((exercise) => {
    const sets = exercise.sets.filter((set) => {
      if (hasPlannedTarget(set) && !hasValidActualValues(set)) {
        return true;
      }
      const isComplete = hasValidActualValues(set);
      if (!isComplete) {
        removedSets += 1;
      }
      return isComplete;
    });

    return {
      ...exercise,
      sets,
    };
  });

  return {
    session: {
      ...session,
      exercises,
    },
    removedSets,
  };
}

export function removeUnconfirmedSets(session: Session): { session: Session; removedSets: number } {
  let removedSets = 0;

  const exercises = session.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.filter((set) => {
      const isEnteredButUnconfirmed =
        set.performanceStatus === 'unperformed' && hasValidActualValues(set);
      if (isEnteredButUnconfirmed) {
        removedSets += 1;
        return false;
      }
      return true;
    }),
  }));

  return {
    session: {
      ...session,
      exercises,
    },
    removedSets,
  };
}

export function removeExercisesWithNoSets(session: Session): { session: Session; removedExercises: number } {
  let removedExercises = 0;
  const exercises = session.exercises.filter((exercise) => {
    const hasSets = exercise.sets.length > 0;
    if (!hasSets) {
      removedExercises += 1;
    }
    return hasSets;
  });

  return {
    session: {
      ...session,
      exercises,
    },
    removedExercises,
  };
}

/**
 * Appends a historical plan as planned rows: onto the last exercise when it is
 * the same definition, otherwise as a new exercise with `createdExerciseId`.
 */
export const appendSuggestedPlan = (
  session: Session,
  exercise: { id: string; name: string },
  suggestedSets: ExerciseBlockHistorySuggestedSet[],
  createdExerciseId: string = createExerciseId()
): { session: Session; targetExerciseId: string } => {
  const plannedSets = suggestedSets.map(createPlannedSetFromSuggestedSet);
  const lastExercise = session.exercises[session.exercises.length - 1];

  if (lastExercise?.exerciseDefinitionId === exercise.id) {
    return {
      session: {
        ...session,
        exercises: session.exercises.map((candidate) =>
          candidate.id === lastExercise.id
            ? { ...candidate, sets: [...candidate.sets, ...plannedSets] }
            : candidate
        ),
      },
      targetExerciseId: lastExercise.id,
    };
  }

  const appended: SessionExercise = {
    id: createdExerciseId,
    exerciseDefinitionId: exercise.id,
    name: exercise.name,
    machineName: '',
    tags: [],
    sets: plannedSets,
  };
  return {
    session: { ...session, exercises: [...session.exercises, appended] },
    targetExerciseId: createdExerciseId,
  };
};

export const SET_TYPE_MENU_LABELS: Record<SessionSetType, string> = {
  warm_up: 'W-Up',
  rir_0: 'RIR 0',
  rir_1: 'RIR 1',
  rir_2: 'RIR 2',
};

export const getSetQualityDisplayLabel = (setType: SessionSetTypeValue): string =>
  setType === null ? '•' : SET_TYPE_MENU_LABELS[setType];

export const formatSetWeightLabel = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim() || '0';
  return `${trimmed}kg`;
};

export const formatSetRepsLabel = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim() || '0';
  return `${trimmed} ${trimmed === '1' ? 'rep' : 'reps'}`;
};

export type SubmitCleanupStep = 'unconfirmed-sets' | 'empty-sets-and-exercises';

/** What one cleanup prompt removes; the copy is chosen from these counts. */
export type SubmitCleanupCounts =
  | { step: 'unconfirmed-sets'; affectedCount: number }
  | { step: 'empty-sets-and-exercises'; incompleteSetCount: number; emptyExerciseCount: number };

export type SubmitCleanupPrompt = SubmitCleanupCounts & { nextSession: Session };

export type SubmitCleanupResult =
  | { kind: 'prompt'; prompt: SubmitCleanupPrompt }
  | { kind: 'ready'; session: Session };

/**
 * One step of the submit cleanup: the next discard the user must confirm, or
 * the completed-history session once nothing is left to confirm. Confirming a
 * prompt runs this again on its `nextSession`.
 *
 * Entered-but-unconfirmed sets are asked about first, on their own, because
 * they discard values the lifter typed. Incomplete sets and the exercises left
 * with no sets are then removed together behind one prompt (decided
 * 2026-09-23 on device: one tidy-up, not two).
 */
export const nextSubmitCleanup = (candidate: Session): SubmitCleanupResult => {
  const committedSession = canonicalizeSessionSetWeights(candidate);
  const { session: withoutUnconfirmedSets, removedSets: removedUnconfirmedSets } =
    removeUnconfirmedSets(committedSession);
  if (removedUnconfirmedSets > 0) {
    return {
      kind: 'prompt',
      prompt: {
        step: 'unconfirmed-sets',
        affectedCount: removedUnconfirmedSets,
        nextSession: withoutUnconfirmedSets,
      },
    };
  }

  const { session: withoutIncompleteSets, removedSets: removedIncompleteSets } =
    removeIncompleteSets(committedSession);
  const completedHistorySession = toCompletedHistorySession(withoutIncompleteSets);
  const { session: withoutEmptyExercises, removedExercises } = removeExercisesWithNoSets(completedHistorySession);
  if (removedIncompleteSets > 0 || removedExercises > 0) {
    return {
      kind: 'prompt',
      prompt: {
        step: 'empty-sets-and-exercises',
        incompleteSetCount: removedIncompleteSets,
        emptyExerciseCount: removedExercises,
        nextSession: withoutEmptyExercises,
      },
    };
  }

  return { kind: 'ready', session: completedHistorySession };
};

export const SUBMIT_CLEANUP_CANCEL_LABEL = 'Go back to edit session';

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The confirmation copy for a submit cleanup prompt, shared by both recorders. */
export const describeSubmitCleanupPrompt = (
  prompt: SubmitCleanupCounts,
  mode: 'active' | 'completed-edit'
): { title: string; message: string; confirmLabel: string } => {
  const outcome = mode === 'completed-edit' ? 'save changes' : 'submit';
  if (prompt.step === 'unconfirmed-sets') {
    const count = prompt.affectedCount;
    return {
      title: 'Discard unconfirmed sets and submit?',
      message: `${countOf(count, 'set')} with entered values ${
        count === 1 ? 'is' : 'are'
      } not confirmed and will be discarded.`,
      confirmLabel: `Discard unconfirmed sets and ${outcome}`,
    };
  }

  const { incompleteSetCount, emptyExerciseCount } = prompt;
  if (emptyExerciseCount === 0) {
    return {
      title: 'Remove incomplete sets and submit?',
      message: `${countOf(incompleteSetCount, 'incomplete set')} missing reps or weight will be removed.`,
      confirmLabel: `Remove incomplete sets and ${outcome}`,
    };
  }
  if (incompleteSetCount === 0) {
    return {
      title: 'Remove exercises with no sets and submit?',
      message: `${countOf(emptyExerciseCount, 'exercise')} with no sets will be removed.`,
      confirmLabel: `Remove empty exercises and ${outcome}`,
    };
  }
  return {
    title: 'Remove incomplete sets and empty exercises?',
    message: `${countOf(incompleteSetCount, 'incomplete set')} missing reps or weight and ${countOf(
      emptyExerciseCount,
      'exercise'
    )} left with no sets will be removed.`,
    confirmLabel: `Remove and ${outcome}`,
  };
};

/** The session as `session-insights` reads it (records, muscle load). */
export const toSessionInsightExercises = (
  session: Session,
  currentExerciseNameByDefinitionId: ReadonlyMap<string, string>
): SessionInsightExerciseInput[] =>
  session.exercises.map((exercise, exerciseIndex) => ({
    id: exercise.id,
    orderIndex: exerciseIndex,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    exerciseName:
      currentExerciseNameByDefinitionId.get(exercise.exerciseDefinitionId) ?? exercise.name,
    sets: exercise.sets.map((set, setIndex) => ({
      id: set.id,
      orderIndex: setIndex,
      weightValue: set.weight,
      repsValue: set.reps,
      setType: set.setType,
      performanceStatus: set.performanceStatus,
    })),
  }));
