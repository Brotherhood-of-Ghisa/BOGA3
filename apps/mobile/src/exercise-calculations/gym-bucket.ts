/**
 * Which record book a session's own records and PRs come from, as
 * [[gym.split]] decides it: the whole exercise, or a split exercise's gym.
 *
 * The one implementation on the device: every figure keyed on
 * (definition, bucket) calls `reportingBucket`, and
 * `apps/mobile/__tests__/metrics-single-source.test.ts` fails when a reader
 * reads the flag itself instead. Keys are namespaced, so a gym whose own id is
 * `all` is never mistaken for the whole exercise. They are local: coaching
 * names its buckets in its own HTTP vocabulary
 * (`supabase/functions/agent-api/gym-buckets.ts`), and neither crosses the
 * wire. Nothing here reads a database or a policy, so it stays importable by
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

/** The book one session's own records and PRs come from ([[gym.split]]). */
export const reportingBucket = (
  definition: GymSplitDefinition,
  sessionGymId: string | null,
): GymBucketKey =>
  definition.splitByGym && sessionGymId !== null ? gymBucketOf(sessionGymId) : POOLED_GYM_BUCKET;
