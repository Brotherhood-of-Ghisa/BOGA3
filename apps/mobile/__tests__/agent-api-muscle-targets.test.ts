/**
 * Outcome: a coach can only set weekly muscle targets the app's own settings
 * could hold — positive whole numbers, a known mode, muscle ids the user's
 * setup reports, as the app reads it (a combined muscle by its key) — into
 * the one target map.
 *
 * The Edge Function (`supabase/functions/agent-api`) applies these pure rules
 * before any database call; the backend `agent-api` lane proves the SQL merge,
 * revision, idempotency and sync side.
 */

import {
  checkOverrideIds,
  MuscleTargetsError,
  normalizeMuscleTargetsWrite,
  reportedMuscleIds,
} from '../../../supabase/functions/agent-api/muscle-targets.ts';
import { BROAD_COMBINED_MUSCLES, type MuscleReportRow } from '../src/data/combined-muscles';
import { BROAD_MUSCLE_PRESET } from '../src/data/muscle-report-presets';

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
    expect(Object.keys(normalizeMuscleTargetsWrite({ expected_revision: 1, overrides: { b: 1, a: 2 } }).changes.overrides ?? {})).toEqual(['a', 'b']);
  });

  it('accepts a single change and revision 0', () => {
    expect(normalizeMuscleTargetsWrite({ expected_revision: 4, mode: 'single' })).toEqual({
      expected_revision: 4, changes: { mode: 'single' },
    });
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
    [{ default_weekly_sets: 8, count_secondary_muscles: false }, 'Unsupported field: count_secondary_muscles'],
    [{ default_weekly_sets: 8, volume_primary_only: true }, 'Unsupported field: volume_primary_only'],
    [{}, 'Name at least one of'],
    [{ overrides: {} }, 'Name at least one of'],
  ])('rejects %j', (body, message) => {
    expect(rejection(() => normalizeMuscleTargetsWrite({ expected_revision: 1, ...body }))).toContain(message);
  });

  it.each([undefined, -1, 1.5, '1', null])('requires the revision it read: %p', (revision) => {
    const body = { default_weekly_sets: 8, ...(revision === undefined ? {} : { expected_revision: revision }) };
    expect(rejection(() => normalizeMuscleTargetsWrite(body))).toContain('expected_revision must be the targets revision');
  });
});

const row = (id: string, reportGroup: string | null, tracked: number | boolean = true, sortOrder = 0,
  familyName = 'Family'): MuscleReportRow => ({ id, displayName: id, familyName, sortOrder, reportGroup, tracked });

const broadEntries = BROAD_MUSCLE_PRESET.muscles[0];
const broadRow = (entry: string, key: string | null, tracked: number | boolean = true) =>
  row(entry, key, tracked, 0, BROAD_MUSCLE_PRESET.muscles.find((muscle) => muscle.entries.includes(entry))?.family);

describe('reportedMuscleIds', () => {
  it('lists every tracked entry when nothing is combined', () => {
    expect([...reportedMuscleIds([row('chest', null), row('lats', null), row('calves', null, false)], [])].sort())
      .toEqual(['chest', 'lats']);
  });

  it('names each combined muscle by its key, never an entry id', () => {
    const rows = BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries.map((entry) => broadRow(entry, `cm_${muscle.key}`)));
    expect(reportedMuscleIds(rows, BROAD_COMBINED_MUSCLES)).toEqual(new Set(BROAD_COMBINED_MUSCLES.map((muscle) => muscle.key)));
  });

  it('reads legacy Broad keys with no stored definitions as the template', () => {
    const rows = BROAD_MUSCLE_PRESET.muscles.flatMap((muscle) => muscle.entries.map((entry) => broadRow(entry, muscle.key)));
    expect(reportedMuscleIds(rows, null)).toEqual(new Set(BROAD_COMBINED_MUSCLES.map((muscle) => muscle.key)));
  });

  it('keeps a combined muscle while any of its members is tracked', () => {
    const [first, ...rest] = broadEntries.entries;
    const key = `cm_${broadEntries.key}`;
    const rows = [broadRow(first, key, false), ...rest.map((entry) => broadRow(entry, key))];
    expect(reportedMuscleIds(rows, BROAD_COMBINED_MUSCLES).has(key)).toBe(rest.length > 0);
  });

  it('reads tracked as the app does: 1 and true count, 0 and false do not', () => {
    expect([...reportedMuscleIds([row('a', null, 1), row('b', null, 0), row('c', null, true), row('d', null, false)], null)].sort())
      .toEqual(['a', 'c']);
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
