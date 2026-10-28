/**
 * Outcome: a coach can only set weekly muscle targets the app's own settings
 * could hold — positive whole numbers, a known mode, muscle ids the user's
 * setup reports — and each override lands in the scope the setup derives to
 * (detailed, broad or custom), exactly as the app derives it.
 *
 * The Edge Function (`supabase/functions/agent-api`) applies these pure rules
 * before any database call; the backend `agent-api` lane proves the SQL merge,
 * revision, idempotency and sync side.
 */

import {
  checkOverrideIds,
  muscleTargetScope,
  MuscleTargetsError,
  normalizeMuscleTargetsWrite,
} from '../../../supabase/functions/agent-api/muscle-targets.ts';
import { BROAD_MUSCLE_PRESET, type MuscleReportRow } from '../src/data/muscle-report-presets';

const rejection = (read: () => unknown): string => {
  try {
    read();
  } catch (error) {
    if (error instanceof MuscleTargetsError) return error.message;
    throw error;
  }
  throw new Error('expected a MuscleTargetsError');
};

describe('normalizeMuscleTargetsWrite', () => {
  it('reads the default, the mode and sorted overrides, null clearing an override', () => {
    expect(normalizeMuscleTargetsWrite({
      default_weekly_sets: 10,
      mode: 'per_muscle',
      overrides: { quads: 14, chest: null, back: 12 },
      expected_revision: 1761650000000,
    })).toEqual({
      expected_revision: 1761650000000,
      changes: { default_weekly_sets: 10, mode: 'per_muscle', overrides: { back: 12, chest: null, quads: 14 } },
    });
    expect(Object.keys(normalizeMuscleTargetsWrite({ overrides: { b: 1, a: 2 } }).changes.overrides ?? {})).toEqual(['a', 'b']);
  });

  it('skips the revision check when none is quoted, and accepts a single change', () => {
    expect(normalizeMuscleTargetsWrite({ mode: 'single' })).toEqual({ expected_revision: null, changes: { mode: 'single' } });
    expect(normalizeMuscleTargetsWrite({ expected_revision: 0, default_weekly_sets: 1 }).expected_revision).toBe(0);
  });

  it.each([
    [{ default_weekly_sets: 0 }, 'default_weekly_sets must be a positive whole number'],
    [{ default_weekly_sets: -3 }, 'default_weekly_sets must be a positive whole number'],
    [{ default_weekly_sets: 8.5 }, 'default_weekly_sets must be a positive whole number'],
    [{ default_weekly_sets: '8' }, 'default_weekly_sets must be a positive whole number'],
    [{ default_weekly_sets: Number.MAX_SAFE_INTEGER + 2 }, 'default_weekly_sets must be a positive whole number'],
    [{ mode: 'per-muscle' }, 'mode must be single or per_muscle.'],
    [{ mode: 4 }, 'mode must be single or per_muscle.'],
    [{ overrides: { chest: 0 } }, 'overrides[chest] must be a positive whole number'],
    [{ overrides: { chest: 2.5 } }, 'overrides[chest] must be a positive whole number'],
    [{ overrides: { chest: '9' } }, 'overrides[chest] must be a positive whole number'],
    [{ overrides: { '  ': 9 } }, 'overrides names a blank or overlong muscle id.'],
    [{ overrides: [['chest', 9]] }, 'overrides must map muscle ids to a target or null.'],
    [{ overrides: null }, 'overrides must map muscle ids to a target or null.'],
    [{ default_weekly_sets: 8, expected_revision: -1 }, 'expected_revision must be the targets revision'],
    [{ default_weekly_sets: 8, expected_revision: '1' }, 'expected_revision must be the targets revision'],
    [{ default_weekly_sets: 8, count_secondary_muscles: false }, 'Unsupported field: count_secondary_muscles'],
    [{}, 'Name at least one of'],
    [{ overrides: {} }, 'Name at least one of'],
    [{ expected_revision: 3 }, 'Name at least one of'],
  ])('rejects %j', (body, message) => {
    expect(rejection(() => normalizeMuscleTargetsWrite(body))).toContain(message);
  });
});

const row = (id: string, reportGroup: string | null, tracked: number | boolean = true, sortOrder = 0): MuscleReportRow => ({
  id, displayName: id, familyName: 'Family', sortOrder, reportGroup, tracked,
});

const broadEntries = BROAD_MUSCLE_PRESET.muscles[0];

describe('muscleTargetScope', () => {
  it('is detailed when no row merges, listing every tracked entry', () => {
    const { scope, reportedIds } = muscleTargetScope([row('chest', null), row('lats', null), row('calves', null, false)]);
    expect(scope).toBe('detailed');
    expect([...reportedIds].sort()).toEqual(['chest', 'lats']);
  });

  it('is broad when the rows spell out the Broad table, naming each muscle by its anchor', () => {
    const rows = BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries.map((entry) => row(entry, muscle.key)));
    const { scope, reportedIds } = muscleTargetScope(rows);
    expect(scope).toBe('broad');
    expect(reportedIds).toEqual(new Set(BROAD_MUSCLE_PRESET.muscles.map((muscle) => muscle.anchor)));
  });

  it('keeps a Broad muscle while any of its entries is tracked', () => {
    const [first, ...rest] = broadEntries.entries;
    const rows = [row(first, broadEntries.key, false), ...rest.map((entry) => row(entry, broadEntries.key))];
    const { reportedIds } = muscleTargetScope(rows);
    expect(reportedIds.has(broadEntries.anchor)).toBe(rest.length > 0);
  });

  it('is custom when the rows match neither preset', () => {
    expect(muscleTargetScope([row('chest', 'no-such-group'), row('lats', null)]).scope).toBe('custom');
  });

  it('reads tracked as the app does: 1 and true count, 0 and false do not', () => {
    const { reportedIds } = muscleTargetScope([row('a', null, 1), row('b', null, 0), row('c', null, true), row('d', null, false)]);
    expect([...reportedIds].sort()).toEqual(['a', 'c']);
  });
});

describe('checkOverrideIds', () => {
  const reported = new Set(['chest', 'lats']);

  it('accepts reported muscles and clears, and names a foreign or disabled id', () => {
    expect(() => checkOverrideIds({ overrides: { chest: 12, lats: null } }, reported)).not.toThrow();
    expect(() => checkOverrideIds({ default_weekly_sets: 9 }, reported)).not.toThrow();
    expect(rejection(() => checkOverrideIds({ overrides: { chest: 12, calves: 9 } }, reported))).toContain('overrides names calves');
  });
});
