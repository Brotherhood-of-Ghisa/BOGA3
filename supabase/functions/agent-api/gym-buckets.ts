// The gym-bucket rules coaching applies to an exercise the user tracks
// separately per gym (`exercise_definitions.split_by_gym`). No database access
// and no HTTP, so Jest covers them beside the mobile calculations.
//
// A split exercise keeps its whole-exercise figures and adds one set per gym
// (docs/product/gym.md, gym.split). Coaching reports the whole exercise unless
// the request names one gym. A session with no gym counts only in the whole
// exercise, so it is never a bucket of its own.

/**
 * The `gym_bucket` value that selected the sessions with no gym before they
 * stopped being a bucket. It stays reserved and rejected, so a caller still on
 * that model fails loud instead of being read as a gym named `none`.
 */
export const NO_GYM_BUCKET = 'none';

export const NO_GYM_BUCKET_MESSAGE =
  `gym_bucket "${NO_GYM_BUCKET}" is not a bucket: sessions with no gym count only in the`
  + ' whole exercise, which is the default. Omit gym_bucket, or name a gym.';

/** A request or cursor value that names no gym bucket. */
export class GymBucketError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_CURSOR', message: string) {
    super(message);
  }
}

export type GymBucketRank = { gymId: string; lastPerformedAt: number };

/**
 * The gym a trimmed `gym_bucket` value names; undefined when the request named
 * none, which selects the whole exercise.
 */
export const gymBucketFromParam = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  if (value === NO_GYM_BUCKET) throw new GymBucketError('INVALID_ARGUMENT', NO_GYM_BUCKET_MESSAGE);
  return value;
};

/**
 * The gym a history cursor is pinned to; undefined for an unfiltered cursor.
 * A cursor pinned to the no-gym bucket (`null`) predates the rule and pages a
 * bucket that no longer exists, so it is rejected rather than widened.
 */
export const gymBucketFromCursor = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new GymBucketError('INVALID_CURSOR', 'Cursor is invalid.');
  return value;
};

/**
 * Every gym the given sessions performed the exercise in, most recently
 * performed first. A gym's timestamp is its newest session, so the order is the
 * one a reader expects from `Last`. Equal timestamps break on the gym id, so
 * the order never depends on the order the sessions arrived in. Sessions with
 * no gym are left out: they belong to the whole exercise only.
 */
export const rankGymBuckets = (
  sessions: ReadonlyArray<{ gym_id: string | null; completed_at: number }>,
): GymBucketRank[] => {
  const newest = new Map<string, GymBucketRank>();
  for (const session of sessions) {
    if (session.gym_id === null) continue;
    const held = newest.get(session.gym_id);
    if (!held || session.completed_at > held.lastPerformedAt) {
      newest.set(session.gym_id, { gymId: session.gym_id, lastPerformedAt: session.completed_at });
    }
  }
  return Array.from(newest.values()).sort((left, right) =>
    right.lastPerformedAt - left.lastPerformedAt || left.gymId.localeCompare(right.gymId)
  );
};
