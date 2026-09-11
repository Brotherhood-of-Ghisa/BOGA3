/**
 * M22 stream-card metric parity (docs/specs/tech/groups-contract.md §5.3).
 *
 * The shared vectors in supabase/tests/fixtures/group-set-metric-vectors.json
 * are asserted here against the canonical TS semantics, and by the
 * `groups-contract` backend lane against the SQL mirrors (group_parse_reps,
 * group_parse_weight, group_e1rm). A semantics change on either side fails
 * until both sides and the vectors agree.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeSetVolume,
  estimateOneRepMax,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';
import {
  canonicalizeWeightForReps,
  isConfirmedPerformedSet,
  normalizeSessionSetPerformanceStatus,
} from '@/src/session-recorder/set-semantics';

type Expectation = {
  performed: boolean;
  weight: number | null;
  reps: number | null;
  volume: number | null;
  e1rm: number | null;
};

type Vector = Expectation & {
  name: string;
  weight_value: string;
  reps_value: string;
  performance_status: string | null;
  divergence?: string;
  sql?: Partial<Expectation>;
};

const VECTORS_PATH = resolve(
  __dirname,
  '../../../../supabase/tests/fixtures/group-set-metric-vectors.json'
);
const { vectors } = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as { vectors: Vector[] };

const E1RM_TOLERANCE = 1e-9;

const computeCanonical = (vector: Vector): Expectation => {
  const reps = parseSetReps(vector.reps_value);
  const weight = parseSetWeight(canonicalizeWeightForReps(vector.weight_value, vector.reps_value));
  const performed =
    isConfirmedPerformedSet({
      reps: vector.reps_value,
      weight: vector.weight_value,
      performanceStatus: normalizeSessionSetPerformanceStatus(vector.performance_status),
    }) &&
    reps !== null &&
    weight !== null;
  return {
    performed,
    weight,
    reps,
    volume: performed ? computeSetVolume(weight as number, reps as number) : null,
    e1rm: performed ? estimateOneRepMax(weight as number, reps as number) : null,
  };
};

describe('group set-metric parity vectors', () => {
  it('loads a non-trivial vector set with unique names', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(30);
    expect(new Set(vectors.map((vector) => vector.name)).size).toBe(vectors.length);
    expect(vectors.some((vector) => vector.performed)).toBe(true);
    expect(vectors.some((vector) => !vector.performed)).toBe(true);
  });

  it('pins every SQL divergence with a reason and only known fields', () => {
    const allowed = new Set(['performed', 'weight', 'reps', 'volume', 'e1rm']);
    for (const vector of vectors) {
      if (vector.sql === undefined) {
        expect(vector.divergence).toBeUndefined();
        continue;
      }
      expect(typeof vector.divergence).toBe('string');
      expect((vector.divergence ?? '').length).toBeGreaterThan(0);
      expect(Object.keys(vector.sql).length).toBeGreaterThan(0);
      for (const key of Object.keys(vector.sql)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))(
    'canonical TS matches: %s',
    (_name, vector) => {
      const actual = computeCanonical(vector);
      expect(actual.performed).toBe(vector.performed);
      expect(actual.weight).toBe(vector.weight);
      expect(actual.reps).toBe(vector.reps);
      expect(actual.volume).toBe(vector.volume);
      if (vector.e1rm === null) {
        expect(actual.e1rm).toBeNull();
      } else {
        expect(actual.e1rm).not.toBeNull();
        expect(Math.abs((actual.e1rm as number) - vector.e1rm)).toBeLessThanOrEqual(
          E1RM_TOLERANCE * Math.max(1, Math.abs(vector.e1rm))
        );
      }
    }
  );
});
