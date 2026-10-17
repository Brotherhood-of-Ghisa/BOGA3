/**
 * The reporting bucket an exercise's session counts in
 * ([[gym.split]]). One exercise definition with `split_by_gym` set reports one
 * exercise per gym, the sessions without a gym forming their own bucket, and is
 * never pooled; without it every gym pools into one bucket, as always.
 *
 * This is the one implementation of that rule on the device: every figure
 * keyed on (definition, bucket) calls `reportingBucket`, and
 * `apps/mobile/__tests__/metrics-single-source.test.ts` fails when a reader
 * reads the flag itself instead. Keys are namespaced, so a gym whose own id is
 * `all` or `no-gym` can never be mistaken for a reserved bucket, and a future
 * pooled bucket for "only some gyms" is a third reserved key rather than a
 * stored-value migration. These keys are local: coaching names its buckets in
 * its own HTTP vocabulary (`supabase/functions/agent-api/gym-buckets.ts`), and
 * neither key ever crosses the wire.
 *
 * Nothing here reads a database or a policy, so it stays importable by
 * relative path like the rest of this directory.
 */

/** A stored bucket key. Text, so a reserved key and a gym id never collide. */
export type GymBucketKey = string;

/** Every gym pooled: the bucket of an exercise that is not split. */
export const POOLED_GYM_BUCKET: GymBucketKey = 'all';

/** A split exercise's sessions that have no gym. */
export const NO_GYM_BUCKET: GymBucketKey = 'no-gym';

/** A split exercise's bucket for one gym, or `NO_GYM_BUCKET` for its no-gym sessions. */
export const gymBucketOf = (gymId: string | null): GymBucketKey =>
  gymId === null ? NO_GYM_BUCKET : `gym:${gymId}`;

/** True for the bucket an unsplit exercise reports in. */
export const isPooledGymBucket = (bucket: GymBucketKey): boolean => bucket === POOLED_GYM_BUCKET;

/** Just the part of a definition this rule reads. */
export type GymSplitDefinition = { splitByGym: boolean };

/**
 * The bucket one session's performance of a definition counts in: the
 * session's own gym when the exercise is split per gym, every gym pooled when
 * it is not.
 */
export const reportingBucket = (
  definition: GymSplitDefinition,
  sessionGymId: string | null,
): GymBucketKey => (definition.splitByGym ? gymBucketOf(sessionGymId) : POOLED_GYM_BUCKET);

/**
 * The buckets a reader at `gymId` can hold rows in: the pooled one when the
 * definition is not split, that gym's when it is. A definition's rows only
 * ever carry one of the two, so a reader filtering on both selects exactly its
 * bucket without reading the flag.
 */
export const readableGymBuckets = (gymId: string | null): GymBucketKey[] =>
  [POOLED_GYM_BUCKET, gymBucketOf(gymId)];
