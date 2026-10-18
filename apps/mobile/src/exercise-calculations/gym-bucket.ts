/**
 * The record book a session's performance of an exercise counts in
 * ([[gym.split]]). Every exercise has its whole-exercise book, pooling every
 * gym. An exercise set to report each gym separately (`split_by_gym`) also
 * keeps one book per gym: a session at a gym takes its records and PRs from
 * that gym's book, while a session with no gym — usually a gym not worth
 * recording — takes them from the whole exercise.
 *
 * This is the one implementation of that rule on the device: every figure
 * keyed on (definition, bucket) calls `reportingBucket`, and
 * `apps/mobile/__tests__/metrics-single-source.test.ts` fails when a reader
 * reads the flag itself instead. Keys are namespaced, so a gym whose own id is
 * `all` can never be mistaken for the whole exercise. These keys are local:
 * coaching names its buckets in its own HTTP vocabulary
 * (`supabase/functions/agent-api/gym-buckets.ts`), and neither key ever
 * crosses the wire.
 *
 * Nothing here reads a database or a policy, so it stays importable by
 * relative path like the rest of this directory.
 */

/** A stored bucket key. Text, so the reserved key and a gym id never collide. */
export type GymBucketKey = string;

/** The whole exercise: every gym, and the sessions with no gym, pooled. */
export const POOLED_GYM_BUCKET: GymBucketKey = 'all';

/** One gym's own book on a split exercise. */
export const gymBucketOf = (gymId: string): GymBucketKey => `gym:${gymId}`;

/** True for the whole-exercise book. */
export const isPooledGymBucket = (bucket: GymBucketKey): boolean => bucket === POOLED_GYM_BUCKET;

/** Just the part of a definition this rule reads. */
export type GymSplitDefinition = { splitByGym: boolean };

/**
 * The book one session's records and PRs come from: its gym's own book when
 * the exercise is split and the session has a gym, the whole exercise
 * otherwise.
 */
export const reportingBucket = (
  definition: GymSplitDefinition,
  sessionGymId: string | null,
): GymBucketKey =>
  definition.splitByGym && sessionGymId !== null ? gymBucketOf(sessionGymId) : POOLED_GYM_BUCKET;
