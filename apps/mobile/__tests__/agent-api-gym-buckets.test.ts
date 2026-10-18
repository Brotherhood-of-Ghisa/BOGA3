/**
 * Outcome: coaching reports a split exercise as the whole exercise unless the
 * caller names one gym, and a session with no gym is never a bucket of its own
 * (docs/product/gym.md, gym.split).
 *
 * The routes that apply these rules live in the Deno edge function; these are
 * the pure rules it shares, so the gym order, the rejected `none` selector and
 * the cursor check are pinned here rather than only in the backend lane.
 */

import {
  GymBucketError, NO_GYM_BUCKET, NO_GYM_CURSOR_MESSAGE, gymBucketFromCursor, gymBucketFromParam, rankGymBuckets,
} from '../../../supabase/functions/agent-api/gym-buckets.ts';

const session = (gymId: string | null, completedAt: number) => ({
  gym_id: gymId, completed_at: completedAt,
});

const rejection = (read: () => unknown): GymBucketError => {
  try {
    read();
  } catch (error) {
    if (error instanceof GymBucketError) return error;
    throw error;
  }
  throw new Error('expected a GymBucketError');
};

describe('coaching gym buckets', () => {
  it('reads a gym id as that gym', () => {
    expect(gymBucketFromParam('gym-home')).toBe('gym-home');
  });

  it('selects the whole exercise when the request names no gym', () => {
    expect(gymBucketFromParam(null)).toBeUndefined();
  });

  it('rejects the old no-gym selector and points the caller at the default', () => {
    const error = rejection(() => gymBucketFromParam(NO_GYM_BUCKET));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toMatch(/whole exercise/);
    expect(error.message).toMatch(/Omit gym_bucket/);
  });

  it('pages an unfiltered cursor across every gym and a filtered one in its gym', () => {
    expect(gymBucketFromCursor(undefined)).toBeUndefined();
    expect(gymBucketFromCursor('gym-home')).toBe('gym-home');
  });

  it('rejects a cursor pinned to the no-gym bucket rather than widening it', () => {
    const error = rejection(() => gymBucketFromCursor(null));
    expect(error.code).toBe('INVALID_CURSOR');
    expect(error.message).toBe(NO_GYM_CURSOR_MESSAGE);
  });

  it('rejects a cursor whose gym is not a gym id as malformed', () => {
    for (const value of [7, '', {}]) {
      const error = rejection(() => gymBucketFromCursor(value));
      expect(error.code).toBe('INVALID_CURSOR');
      expect(error.message).not.toBe(NO_GYM_CURSOR_MESSAGE);
    }
  });

  it('ranks every performed gym by its newest session, most recent first', () => {
    expect(rankGymBuckets([
      session('gym-home', 300),
      session('gym-away', 500),
      session('gym-home', 100),
    ])).toEqual([
      { gymId: 'gym-away', lastPerformedAt: 500 },
      { gymId: 'gym-home', lastPerformedAt: 300 },
    ]);
  });

  it('lists no bucket for the sessions with no gym, even the newest', () => {
    expect(rankGymBuckets([session(null, 900), session('gym-home', 300), session(null, 100)]))
      .toEqual([{ gymId: 'gym-home', lastPerformedAt: 300 }]);
    expect(rankGymBuckets([session(null, 900)])).toEqual([]);
  });

  it('breaks an equal last-performed tie on the gym id, not on arrival order', () => {
    const ranked = rankGymBuckets([session('gym-b', 400), session('gym-a', 400)]);
    expect(ranked.map((entry) => entry.gymId)).toEqual(['gym-a', 'gym-b']);
    expect(rankGymBuckets([session('gym-a', 400), session('gym-b', 400)])).toEqual(ranked);
  });

  it('folds repeat sessions in one gym into a single bucket', () => {
    expect(rankGymBuckets([session('gym-home', 1), session('gym-home', 2)]))
      .toEqual([{ gymId: 'gym-home', lastPerformedAt: 2 }]);
  });

  it('lists no bucket for an exercise that was never performed', () => {
    expect(rankGymBuckets([])).toEqual([]);
  });
});
