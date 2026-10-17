// The gym-bucket rules coaching applies to an exercise the user tracks
// separately per gym (`exercise_definitions.split_by_gym`). No database access
// and no HTTP, so Jest covers them beside the mobile calculations.
//
// A split exercise reports one exercise per gym, with the sessions that had no
// gym forming their own bucket, and is never pooled (docs/product/gym.md,
// gym.split). So no coaching figure spans gyms: the context route states each
// bucket's own records and computes its other figures for one of them.

/** A bucket key: a gym id, or null for the no-gym bucket. */
export type GymBucket = string | null;

/**
 * The `gym_bucket` request value that selects the no-gym bucket. It is a
 * reserved value in the gym-id space, so a gym whose own id is `none` cannot
 * be named; `bucketKey` keeps the two apart everywhere else.
 */
export const NO_GYM_BUCKET = 'none';

export type GymBucketRank = { bucket: GymBucket; lastPerformedAt: number };

/** A map key that cannot confuse a gym with the no-gym bucket. */
const bucketKey = (bucket: GymBucket): string =>
  bucket === null ? 'no-gym' : `gym:${bucket}`;

/** The bucket a `gym_bucket` value names; undefined when the request named none. */
export const gymBucketFromParam = (raw: string | null): GymBucket | undefined => {
  if (raw === null) return undefined;
  return raw === NO_GYM_BUCKET ? null : raw;
};

/**
 * Every bucket the given sessions performed the exercise in, most recently
 * performed first. A bucket's timestamp is its newest session, so the order is
 * the one a reader expects from `Last`. Equal timestamps break on the bucket
 * key, so the order never depends on the order the sessions arrived in.
 */
export const rankGymBuckets = (
  sessions: ReadonlyArray<{ gym_id: string | null; completed_at: number }>,
): GymBucketRank[] => {
  const newest = new Map<string, GymBucketRank>();
  for (const session of sessions) {
    const key = bucketKey(session.gym_id);
    const held = newest.get(key);
    if (!held || session.completed_at > held.lastPerformedAt) {
      newest.set(key, { bucket: session.gym_id, lastPerformedAt: session.completed_at });
    }
  }
  return Array.from(newest.values()).sort((left, right) =>
    right.lastPerformedAt - left.lastPerformedAt
    || bucketKey(left.bucket).localeCompare(bucketKey(right.bucket))
  );
};

/**
 * The bucket reported when the request named none: the most recently performed
 * one. With no history at all the no-gym bucket answers, so the response is a
 * single empty bucket rather than an error.
 */
export const defaultGymBucket = (ranked: readonly GymBucketRank[]): GymBucket =>
  ranked.length > 0 ? ranked[0].bucket : null;
