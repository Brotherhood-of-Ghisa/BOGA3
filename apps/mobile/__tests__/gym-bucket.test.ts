/**
 * The reporting-bucket rule ([[gym.split]]): the one place that decides which
 * bucket a session's performance of an exercise counts in
 * (`src/exercise-calculations/gym-bucket.ts`). Every figure keyed on
 * (definition, bucket) reads it; `metrics-single-source.test.ts` fails when a
 * reader decides for itself instead.
 */

import {
  gymBucketOf,
  isPooledGymBucket,
  NO_GYM_BUCKET,
  POOLED_GYM_BUCKET,
  readableGymBuckets,
  reportingBucket,
} from '@/src/exercise-calculations/gym-bucket';

const SPLIT = { splitByGym: true };
const WHOLE = { splitByGym: false };

describe('reporting bucket', () => {
  it('pools every gym for an exercise that is not split', () => {
    expect(reportingBucket(WHOLE, 'gym-home')).toBe(POOLED_GYM_BUCKET);
    expect(reportingBucket(WHOLE, null)).toBe(POOLED_GYM_BUCKET);
    expect(isPooledGymBucket(POOLED_GYM_BUCKET)).toBe(true);
  });

  it('gives a split exercise one bucket per gym, and one for the sessions with no gym', () => {
    expect(reportingBucket(SPLIT, 'gym-home')).toBe('gym:gym-home');
    expect(reportingBucket(SPLIT, 'gym-club')).toBe('gym:gym-club');
    expect(reportingBucket(SPLIT, null)).toBe(NO_GYM_BUCKET);
    expect(isPooledGymBucket(reportingBucket(SPLIT, 'gym-home'))).toBe(false);
    expect(isPooledGymBucket(NO_GYM_BUCKET)).toBe(false);
  });

  it('never lets a gym whose own id is a reserved key take that bucket', () => {
    for (const reserved of [POOLED_GYM_BUCKET, NO_GYM_BUCKET]) {
      expect(reportingBucket(SPLIT, reserved)).not.toBe(reserved);
      expect(gymBucketOf(reserved)).toBe(`gym:${reserved}`);
    }
    expect(gymBucketOf('all')).not.toBe(gymBucketOf(null));
  });

  it('names the two buckets a reader at one gym can hold rows in', () => {
    expect(readableGymBuckets('gym-home')).toEqual([POOLED_GYM_BUCKET, 'gym:gym-home']);
    expect(readableGymBuckets(null)).toEqual([POOLED_GYM_BUCKET, NO_GYM_BUCKET]);
    // A definition's rows all carry one kind, so naming both selects one.
    expect(readableGymBuckets('gym-home')).toContain(reportingBucket(WHOLE, 'gym-home'));
    expect(readableGymBuckets('gym-home')).toContain(reportingBucket(SPLIT, 'gym-home'));
    expect(readableGymBuckets('gym-home')).not.toContain(reportingBucket(SPLIT, 'gym-club'));
  });
});
