/**
 * Outcome: one rest timer range (15 to 600 whole seconds) governs the global
 * setting, an exercise's own default and agent writes, and a set on an
 * exercise rests for the exercise's default when it has one, else the global
 * timer ([[timer.rest-default]]).
 */

import {
  isRestTimerSec,
  resolveRestTimerSec,
  validateExerciseRestTimerSec,
} from '@/src/exercise-core/rest-timer';
import { isPreferenceValue } from '@/src/preferences/model';

describe('rest timer range', () => {
  it.each([15, 90, 600])('accepts %p seconds', (value) => {
    expect(isRestTimerSec(value)).toBe(true);
    expect(isPreferenceValue('restTimerDurationSec', value)).toBe(true);
  });

  it.each([14, 601, 0, -30, 90.5, Number.NaN, '90', null, undefined])('rejects %p', (value) => {
    expect(isRestTimerSec(value)).toBe(false);
    expect(isPreferenceValue('restTimerDurationSec', value)).toBe(false);
  });
});

describe('an exercise rest timer', () => {
  it('is null (the global timer) or a value in range', () => {
    expect(validateExerciseRestTimerSec(null)).toEqual({ ok: true, value: null });
    expect(validateExerciseRestTimerSec(120)).toEqual({ ok: true, value: 120 });
    expect(validateExerciseRestTimerSec(5)).toEqual({
      ok: false,
      field: 'restTimerSec',
      message: 'Rest timer must be a whole number of seconds from 15 to 600.',
    });
    expect(validateExerciseRestTimerSec(undefined).ok).toBe(false);
  });

  it('wins over the global timer when set, and falls back to it otherwise', () => {
    expect(resolveRestTimerSec(45, 90)).toBe(45);
    expect(resolveRestTimerSec(null, 90)).toBe(90);
    expect(resolveRestTimerSec(undefined, 90)).toBe(90);
  });

  it('ignores a stored value outside the range rather than trusting it', () => {
    expect(resolveRestTimerSec(5, 90)).toBe(90);
    expect(resolveRestTimerSec(9999, 90)).toBe(90);
  });
});
