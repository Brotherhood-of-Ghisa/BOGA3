/**
 * The record-book rule ([[gym.split]]): the one place that decides which book
 * a session's records and PRs come from
 * (`src/exercise-calculations/gym-bucket.ts`). Every figure keyed on
 * (definition, bucket) reads it; `metrics-single-source.test.ts` fails when a
 * reader decides for itself instead.
 */

import {
  gymBucketOf,
  isPooledGymBucket,
  POOLED_GYM_BUCKET,
  reportingBucket,
} from '@/src/exercise-calculations/gym-bucket';

const SPLIT = { splitByGym: true };
const WHOLE = { splitByGym: false };

describe('reporting bucket', () => {
  it('reads the whole exercise while the exercise is not split', () => {
    expect(reportingBucket(WHOLE, 'gym-home')).toBe(POOLED_GYM_BUCKET);
    expect(reportingBucket(WHOLE, null)).toBe(POOLED_GYM_BUCKET);
    expect(isPooledGymBucket(POOLED_GYM_BUCKET)).toBe(true);
  });

  it('gives a split exercise\'s session at a gym that gym\'s own book', () => {
    expect(reportingBucket(SPLIT, 'gym-home')).toBe('gym:gym-home');
    expect(reportingBucket(SPLIT, 'gym-club')).toBe('gym:gym-club');
    expect(isPooledGymBucket(reportingBucket(SPLIT, 'gym-home'))).toBe(false);
  });

  it('measures a split exercise\'s session with no gym against the whole exercise', () => {
    // Usually a gym not worth recording, so it is compared with everything.
    expect(reportingBucket(SPLIT, null)).toBe(POOLED_GYM_BUCKET);
  });

  it('never lets a gym whose own id is the reserved key take the whole exercise', () => {
    expect(reportingBucket(SPLIT, POOLED_GYM_BUCKET)).not.toBe(POOLED_GYM_BUCKET);
    expect(gymBucketOf(POOLED_GYM_BUCKET)).toBe(`gym:${POOLED_GYM_BUCKET}`);
  });
});
