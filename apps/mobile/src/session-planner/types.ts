import type { SessionSetTypeValue } from '@/src/data/set-types';

/**
 * The session-planner domain types: what the planner screens hold, what
 * validation normalizes, and the typed results the repository/materialization
 * operations return. Pure — no database, no React. The repository
 * (`plan-repository.ts`) is the mutation boundary for the UI; screens never
 * write plan tables directly.
 *
 * Draft types carry raw editor text (`targetWeightText`, `targetRepsText`);
 * validation normalizes them into store-ready values so no screen ever writes
 * an unparsed field.
 */

/** Raw editor-facing target set; strings exactly as the editor holds them. */
export type PlanSetDraft = {
  /** '' or blank means "choose during the workout". */
  targetWeightText: string;
  targetRepsText: string;
  targetSetType: SessionSetTypeValue;
};

export type PlanExerciseDraft = {
  /** Nullable owned exercise reference; name/machineName are the durable snapshots. */
  exerciseDefinitionId: string | null;
  name: string;
  machineName: string;
  sets: PlanSetDraft[];
};

/** A one-off plan, or one child of a programme, as the editor holds it. */
export type PlanDraft = {
  title: string;
  gymId: string | null;
  /** null = unscheduled (the plan lands in the Unscheduled queue). */
  scheduledFor: Date | null;
  exercises: PlanExerciseDraft[];
};

export type ProgrammeDraft = {
  name: string;
  description: string;
  /** Array order is programme order; the store assigns dense indexes 0..n-1. */
  plans: PlanDraft[];
};

/** Normalized, validated values — exactly what the store writes. */
export type NormalizedPlanSet = {
  targetWeightValue: string | null;
  targetReps: number;
  targetSetType: SessionSetTypeValue;
};

export type NormalizedPlanExercise = {
  exerciseDefinitionId: string | null;
  name: string;
  machineName: string | null;
  sets: NormalizedPlanSet[];
};

export type NormalizedPlan = {
  title: string;
  gymId: string | null;
  scheduledFor: Date | null;
  exercises: NormalizedPlanExercise[];
};

export type NormalizedProgramme = {
  name: string;
  description: string | null;
  plans: NormalizedPlan[];
};

/** Address of one invalid field, e.g. `title`, `exercises.0.sets.1.targetReps`. */
export type PlanValidationPath = string;

export type PlanFieldErrorCode =
  | 'required'
  | 'too_long'
  | 'too_few'
  | 'too_many'
  | 'invalid_reps'
  | 'invalid_weight'
  | 'unknown_set_type'
  | 'invalid_schedule';

export type PlanFieldError = {
  path: PlanValidationPath;
  code: PlanFieldErrorCode;
  message: string;
};

export type PlanValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: PlanFieldError[] };

/**
 * Block lifecycle as the screens see it. `pending` is the only editable state;
 * `attached` is a pending block that is materialized on a live card;
 * `completed` / `skipped` are resolved.
 */
export type PlanBlockStatus = 'pending' | 'attached' | 'completed' | 'skipped';

/** Typed materialization/lifecycle results. Errors carrying user choices stay non-throwing. */
export type StartSessionPlanResult =
  | { status: 'started'; sessionId: string }
  | { status: 'already-active'; sessionId: string }
  | { status: 'active-conflict'; activeSessionId: string }
  | { status: 'no-pending-blocks' }
  | { status: 'plan-not-found' };

export type AddPlanBlockResult =
  | { status: 'attached'; sessionId: string; sessionExerciseId: string }
  | { status: 'ambiguous'; candidateSessionExerciseIds: string[] }
  | { status: 'block-not-available' }
  | { status: 'target-invalid' };

export type ResolvePlanBlockResult =
  | { status: 'completed' | 'skipped'; resolvedAt: Date }
  | { status: 'not-resolvable' }
  | { status: 'block-not-found' };

export type ReorderSessionSetsResult =
  | { status: 'reordered' }
  | { status: 'invalid-list' }
  | { status: 'exercise-not-found' };
