/**
 * Outcome: coaching reports a split exercise one gym bucket at a time — the
 * most recently performed bucket unless the caller names one, with the sessions
 * that had no gym forming their own bucket (docs/product/gym.md, gym.split).
 *
 * The routes that apply these rules live in the Deno edge function; these are
 * the pure rules it shares, so the bucket order, the `none` selector and the
 * no-history fallback are pinned here rather than only in the backend lane.
 */

import {
  NO_GYM_BUCKET, defaultGymBucket, gymBucketFromParam, rankGymBuckets,
} from '../../../supabase/functions/agent-api/gym-buckets.ts';

const session = (gymId: string | null, completedAt: number) => ({
  gym_id: gymId, completed_at: completedAt,
});

describe('coaching gym buckets', () => {
  it('reads a gym id as its own bucket and "none" as the no-gym bucket', () => {
    expect(gymBucketFromParam('gym-home')).toBe('gym-home');
    expect(gymBucketFromParam(NO_GYM_BUCKET)).toBeNull();
  });

  it('leaves the bucket unchosen when the request carries no selector', () => {
    expect(gymBucketFromParam(null)).toBeUndefined();
  });

  it('ranks every performed bucket by its newest session, most recent first', () => {
    expect(rankGymBuckets([
      session('gym-home', 300),
      session('gym-away', 500),
      session(null, 400),
      session('gym-home', 100),
    ])).toEqual([
      { bucket: 'gym-away', lastPerformedAt: 500 },
      { bucket: null, lastPerformedAt: 400 },
      { bucket: 'gym-home', lastPerformedAt: 300 },
    ]);
  });

  it('keeps a gym whose own id is the reserved value out of the no-gym bucket', () => {
    expect(rankGymBuckets([session(NO_GYM_BUCKET, 200), session(null, 100)])).toEqual([
      { bucket: NO_GYM_BUCKET, lastPerformedAt: 200 },
      { bucket: null, lastPerformedAt: 100 },
    ]);
  });

  it('breaks an equal last-performed tie on the bucket, not on arrival order', () => {
    const ranked = rankGymBuckets([session('gym-b', 400), session(null, 400), session('gym-a', 400)]);
    expect(ranked.map((entry) => entry.bucket)).toEqual(['gym-a', 'gym-b', null]);
    expect(rankGymBuckets([session(null, 400), session('gym-a', 400), session('gym-b', 400)]))
      .toEqual(ranked);
  });

  it('folds repeat sessions in one gym into a single bucket', () => {
    expect(rankGymBuckets([session('gym-home', 1), session('gym-home', 2)]))
      .toEqual([{ bucket: 'gym-home', lastPerformedAt: 2 }]);
  });

  it('lists no bucket for an exercise that was never performed', () => {
    expect(rankGymBuckets([])).toEqual([]);
  });

  it('defaults to the most recently performed bucket', () => {
    expect(defaultGymBucket(rankGymBuckets([
      session('gym-home', 300), session(null, 400),
    ]))).toBeNull();
    expect(defaultGymBucket(rankGymBuckets([
      session('gym-home', 500), session(null, 400),
    ]))).toBe('gym-home');
  });

  it('answers with the no-gym bucket when there is no history to rank', () => {
    expect(defaultGymBucket([])).toBeNull();
  });
});
