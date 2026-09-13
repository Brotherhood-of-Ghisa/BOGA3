/**
 * The shared ExerciseCore validator (M25 design T1). The vectors are shared
 * with `groups-contract`, which runs them against `group_exercise_create` and
 * the `group_exercises` CHECKs, so the device and the server apply one rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { exerciseDefinitions } from '@/src/data/schema';
import {
  EXERCISE_CORE_ISSUE_MESSAGES,
  LOAD_INPUT_MODES,
  isLoadInputMode,
  validateExerciseCore,
  type ExerciseCoreIssue,
} from '@/src/exercise-core';

type Vector = {
  label: string;
  name: unknown;
  loadInputMode: unknown;
  expect: { name: string } | { issue: ExerciseCoreIssue };
};

const vectors: Vector[] = JSON.parse(
  readFileSync(join(__dirname, '../../src/exercise-core/exercise-core-vectors.json'), 'utf8'),
).cases;

describe('ExerciseCore', () => {
  it.each(vectors)('shared vector: $label', ({ name, loadInputMode, expect: outcome }) => {
    const result = validateExerciseCore({ name, loadInputMode });

    if ('name' in outcome) {
      expect(result).toEqual({ ok: true, value: { name: outcome.name, loadInputMode } });
    } else {
      expect(result).toEqual({ ok: false, issue: outcome.issue, message: EXERCISE_CORE_ISSUE_MESSAGES[outcome.issue] });
    }
  });

  it('the shared vectors cover both load modes and every issue', () => {
    const acceptedModes = vectors.flatMap((vector) => ('name' in vector.expect ? [vector.loadInputMode] : []));
    const issues = vectors.flatMap((vector) => ('issue' in vector.expect ? [vector.expect.issue] : []));

    expect(new Set(acceptedModes)).toEqual(new Set(LOAD_INPUT_MODES));
    expect(new Set(issues)).toEqual(new Set(Object.keys(EXERCISE_CORE_ISSUE_MESSAGES)));
  });

  it('uses the personal exercise store’s load modes', () => {
    expect(exerciseDefinitions.loadInputMode.enumValues).toEqual([...LOAD_INPUT_MODES]);
  });

  it('isLoadInputMode accepts exactly the load modes', () => {
    expect(LOAD_INPUT_MODES.every((mode) => isLoadInputMode(mode))).toBe(true);
    expect([undefined, null, 1, 'kg', 'Total_Load', ' per_side_load'].some((value) => isLoadInputMode(value))).toBe(false);
  });
});
