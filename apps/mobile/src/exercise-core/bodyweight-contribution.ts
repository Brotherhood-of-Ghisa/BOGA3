// Import-free so the mobile client and server-authoritative group evaluator
// apply the same boundary to the one bodyweight-specific exercise value.
export type BodyweightContributionValidation =
  | { ok: true; value: number }
  | { ok: false; field: 'bodyweightContribution'; message: string };

export const validateBodyweightContribution = (value: unknown): BodyweightContributionValidation => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return {
      ok: false,
      field: 'bodyweightContribution',
      message: 'Bodyweight contribution must be from 0% to 100%.',
    };
  }

  return { ok: true, value };
};

/** Exact, reviewed catalogue identities. Variants and aliases are not inferred. */
export const BODYWEIGHT_SEED_CONTRIBUTIONS: Readonly<Record<string, number>> = {
  seed_pull_up: 1,
  'seed_chin-ups': 1,
  seed_parallel_bar_dips: 1,
  seed_push_up: 0.7,
};
