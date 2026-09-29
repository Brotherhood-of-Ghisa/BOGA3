// Import-free so personal and server-authoritative group rules share validation.
export type ExerciseLoadRules = {
  bodyweightCoefficient: number;
  movementStandard: string | null;
  loadingMethod: string | null;
};

export const CONVENTIONAL_LOAD_RULES: ExerciseLoadRules = {
  bodyweightCoefficient: 0,
  movementStandard: null,
  loadingMethod: null,
};

export type ExerciseLoadRulesValidation =
  | { ok: true; value: ExerciseLoadRules }
  | { ok: false; field: keyof ExerciseLoadRules; message: string };

/**
 * Validate the contribution while retaining any legacy descriptions until the
 * coordinated schema cutover removes those columns. New UI no longer asks for
 * the descriptions, so they are optional even for a positive contribution.
 */
export const validateExerciseLoadRules = (input: {
  bodyweightCoefficient: unknown;
  movementStandard: unknown;
  loadingMethod: unknown;
}): ExerciseLoadRulesValidation => {
  if (typeof input.bodyweightCoefficient !== 'number' || !Number.isFinite(input.bodyweightCoefficient) ||
      input.bodyweightCoefficient < 0 || input.bodyweightCoefficient > 1) {
    return { ok: false, field: 'bodyweightCoefficient', message: 'Bodyweight contribution must be from 0% to 100%.' };
  }
  const value: ExerciseLoadRules = { ...CONVENTIONAL_LOAD_RULES, bodyweightCoefficient: input.bodyweightCoefficient };
  for (const field of ['movementStandard', 'loadingMethod'] as const) {
    const raw = input[field];
    if (raw !== null && raw !== undefined && typeof raw !== 'string') {
      return { ok: false, field, message: 'Enter legacy load metadata as text.' };
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length > 120 || /[\u0000-\u001f\u007f]/.test(text)) {
      return { ok: false, field, message: 'Use a single line of at most 120 characters.' };
    }
    value[field] = text || null;
  }
  return { ok: true, value };
};

/** Exact, reviewed catalogue identities. Variants and aliases are not inferred. */
export const BODYWEIGHT_SEED_RULES: Readonly<Record<string, ExerciseLoadRules>> = {
  seed_pull_up: { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' },
  'seed_chin-ups': { bodyweightCoefficient: 1, movementStandard: 'Strict chin-up', loadingMethod: 'Belt' },
  seed_parallel_bar_dips: { bodyweightCoefficient: 1, movementStandard: 'Parallel-bar dip', loadingMethod: 'Belt' },
  seed_push_up: { bodyweightCoefficient: 0.7, movementStandard: 'Standard floor push-up', loadingMethod: 'Vest' },
};
