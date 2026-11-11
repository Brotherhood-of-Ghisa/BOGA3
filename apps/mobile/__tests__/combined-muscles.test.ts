// Combined muscles as every reader takes them ([[muscle.report-groups]],
// [[muscle.weekly-targets]]): stored definitions, the family rule, legacy
// Broad keys read as the template, and legacy per-setup targets read as one map.
import {
  BROAD_COMBINED_MUSCLES,
  broadTemplateKeyOf,
  buildMuscleReportAssignment,
  combinedMuscleAnchors,
  isCombinedMuscleList,
  legacyMuscleTargets,
  parseStoredCombinedMuscles,
  resolveCombinedMuscleSetup,
  type MuscleReportRow,
} from '@/src/data/combined-muscles';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { BROAD_MUSCLE_PRESET } from '@/src/data/muscle-report-presets';
import { buildMuscleSetup, writableEntryOf } from '@/src/exercise-catalog/muscle-setup';
import { canonicalOrientationForMuscle } from '@/components/stats/muscle-body-projection';

const row = (id: string, familyName: string, reportGroup: string | null = null, tracked: number | boolean = 1,
  sortOrder = 0): MuscleReportRow => ({ id, displayName: id, familyName, sortOrder, reportGroup, tracked });
const seeds = (reportGroupOf: (id: string) => string | null = () => null): MuscleReportRow[] =>
  SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) =>
    ({ id, displayName, familyName, sortOrder, reportGroup: reportGroupOf(id), tracked: 1 }));
const legacyKeyOf = (id: string) => broadTemplateKeyOf(id)?.slice('cm_'.length) ?? null;
const PUSH = { key: 'cm_push', name: 'Push', family: 'Arms' };

describe('stored definitions', () => {
  it('accepts a list of cm_ keys with a name and family, keys distinct', () => {
    expect(isCombinedMuscleList([])).toBe(true);
    expect(isCombinedMuscleList(BROAD_COMBINED_MUSCLES)).toBe(true);
    expect(isCombinedMuscleList([{ ...PUSH, extra: 1 }])).toBe(true);
  });

  it.each([
    null, {}, [null], [{ ...PUSH, key: 'push' }], [{ ...PUSH, key: 'cm_Push' }], [{ ...PUSH, key: 'cm_' }],
    [{ ...PUSH, key: `cm_${'a'.repeat(65)}` }], [{ ...PUSH, name: ' ' }], [{ ...PUSH, name: 'x'.repeat(61) }],
    [{ ...PUSH, family: '' }], [{ ...PUSH, family: 3 }], [PUSH, { ...PUSH, name: 'Again' }],
  ])('rejects %j', (value) => {
    expect(isCombinedMuscleList(value)).toBe(false);
  });

  it('parses JSON text or parsed jsonb, dropping extra keys; anything unreadable is "none stored"', () => {
    expect(parseStoredCombinedMuscles(JSON.stringify([{ ...PUSH, extra: 1 }]))).toEqual([PUSH]);
    expect(parseStoredCombinedMuscles([PUSH])).toEqual([PUSH]);
    expect(parseStoredCombinedMuscles('[]')).toEqual([]);
    for (const raw of [null, undefined, '{broken', '{"key":"cm_x"}', '[{"key":"x"}]']) {
      expect(parseStoredCombinedMuscles(raw)).toBeNull();
    }
  });

  it('gives the Broad template its 11 muscles under cm_ keys, in preset order', () => {
    expect(BROAD_COMBINED_MUSCLES.map((muscle) => muscle.key)).toEqual(BROAD_MUSCLE_PRESET.muscles.map((muscle) => `cm_${muscle.key}`));
    expect(BROAD_COMBINED_MUSCLES[0]).toEqual({ key: 'cm_chest', name: 'Chest', family: 'Chest' });
    expect(broadTemplateKeyOf('adductors')).toBe('cm_quads');
    expect(broadTemplateKeyOf('spinal_erectors')).toBeNull();
  });
});

describe('the family rule and other invalid memberships', () => {
  const rows = [row('chest', 'Arms', 'cm_push'), row('triceps', 'Arms', 'cm_push'), row('lats', 'Back', 'cm_push'),
    row('neck', 'Back', 'cm_gone')];

  it('reports only members of the definition\'s own family under it; any other key leaves the row its own', () => {
    const assignment = buildMuscleReportAssignment(rows, [PUSH]);
    expect(assignment.get('chest')?.muscle).toEqual({ id: 'cm_push', displayName: 'Push', familyName: 'Arms', sortOrder: 0 });
    expect(assignment.get('triceps')?.muscle.id).toBe('cm_push');
    expect(assignment.get('lats')?.muscle).toMatchObject({ id: 'lats', familyName: 'Back' });
    expect(assignment.get('neck')?.muscle.id).toBe('neck');
    expect(resolveCombinedMuscleSetup(rows, [PUSH]).rows.map((entry) => entry.reportGroup))
      .toEqual(['cm_push', 'cm_push', null, null]);
  });

  it('ignores a definition whose key is an entry id, and a repeated key', () => {
    const colliding = [row('cm_push', 'Arms'), row('triceps', 'Arms', 'cm_push')];
    expect(buildMuscleReportAssignment(colliding, [PUSH]).get('triceps')?.muscle.id).toBe('triceps');
    expect(resolveCombinedMuscleSetup(colliding, [PUSH]).definitions).toEqual([]);
    expect(resolveCombinedMuscleSetup(rows, [PUSH, { ...PUSH, name: 'Second' }]).definitions).toEqual([PUSH]);
  });

  it('keeps a stored definition with no members, and stored definitions replace the legacy reading', () => {
    expect(resolveCombinedMuscleSetup([row('chest', 'Chest', 'chest')], [PUSH])).toMatchObject({
      definitions: [PUSH], rows: [{ reportGroup: null }], fromLegacy: false,
    });
  });
});

describe('anchors', () => {
  it('is the first tracked member by sort order, else the first member; the muscle sorts there', () => {
    const rows = [row('b', 'Arms', 'cm_push', 0, 1), row('c', 'Arms', 'cm_push', 1, 3), row('a', 'Arms', 'cm_push', 1, 2)];
    expect(combinedMuscleAnchors(rows).get('cm_push')?.id).toBe('a');
    expect(buildMuscleReportAssignment(rows, [PUSH]).get('b')?.muscle.sortOrder).toBe(2);
    expect(combinedMuscleAnchors(rows.map((entry) => ({ ...entry, tracked: 0 }))).get('cm_push')?.id).toBe('b');
  });

  it('is where the editor writes a new mapping, and the 3D body faces it', () => {
    const rows = seeds((id) => (['back_upper', 'traps_upper', 'back_lats'].includes(id) ? 'cm_upper' : null))
      .map((entry) => (['back_lats', 'calves'].includes(entry.id) ? { ...entry, tracked: 0 } : entry));
    const setup = buildMuscleSetup(rows, [{ key: 'cm_upper', name: 'Upper', family: 'Back' }]);
    expect(writableEntryOf(setup.assignment, 'cm_upper')).toBe('back_upper');
    expect(writableEntryOf(setup.assignment, 'quads')).toBe('quads');
    expect(writableEntryOf(setup.assignment, 'calves')).toBeUndefined();
    expect(writableEntryOf(setup.assignment, 'not-a-muscle')).toBe('not-a-muscle');
    expect(canonicalOrientationForMuscle('cm_upper', setup.assignment)).toBe('back');
    expect(canonicalOrientationForMuscle('cm_upper')).toBe('front');
  });
});

describe('legacy Broad keys, with no definitions stored', () => {
  it('read as the template\'s combined muscles in use, rows remapped to their keys', () => {
    const setup = resolveCombinedMuscleSetup(seeds(legacyKeyOf), null);
    expect(setup.fromLegacy).toBe(true);
    expect(setup.definitions).toEqual(BROAD_COMBINED_MUSCLES);
    expect(setup.rows.find((entry) => entry.id === 'hip_flexors')?.reportGroup).toBe('cm_quads');
  });

  it('read only the Broad muscles some row is a member of, and a key on a non-member as its own muscle', () => {
    const rows = seeds((id) => ({ chest: 'chest', serratus_anterior: 'chest', biceps: 'chest', quads: 'newer' }[id] ?? null));
    const setup = resolveCombinedMuscleSetup(rows, null);
    expect(setup.definitions).toEqual([{ key: 'cm_chest', name: 'Chest', family: 'Chest' }]);
    expect(setup.rows.filter((entry) => entry.reportGroup !== null).map((entry) => entry.id)).toEqual(['chest', 'serratus_anterior']);
    expect(resolveCombinedMuscleSetup(seeds(), null).definitions).toEqual([]);
  });

  it('read the same when a caller passes no definitions at all', () => {
    expect(buildMuscleReportAssignment(seeds(legacyKeyOf), undefined as never).get('brachialis')?.muscle.id).toBe('cm_biceps');
  });
});

describe('legacy weekly targets', () => {
  const overrides = { detailed: { chest: 20, calves: 5 }, broad: { chest: 12, back_lats: 9, spinal_erectors: 4 }, custom: { chest: 7 } };

  it('take the map of the setup the rows spell out', () => {
    expect(legacyMuscleTargets(overrides, seeds(), null)).toEqual({ chest: 20, calves: 5 });
    expect(legacyMuscleTargets(overrides, seeds(legacyKeyOf), null)).toEqual({ cm_chest: 12, cm_back: 9, spinal_erectors: 4 });
    const custom = seeds((id) => (id === 'serratus_anterior' || id === 'chest' ? 'chest' : null));
    expect(legacyMuscleTargets(overrides, custom, null)).toEqual({ cm_chest: 7 });
    expect(legacyMuscleTargets(JSON.stringify(overrides), seeds(), null)).toEqual({ chest: 20, calves: 5 });
  });

  it('keep an anchor id its own when its Broad muscle is not in effect', () => {
    const custom = seeds((id) => (id === 'back_upper' ? 'back' : null));
    expect(legacyMuscleTargets({ custom: { chest: 3, back_lats: 6 } }, custom, null)).toEqual({ chest: 3, cm_back: 6 });
    expect(legacyMuscleTargets({ custom: { chest: 3 } }, seeds((id) => (id === 'quads' ? 'quads' : null)), null))
      .toEqual({ chest: 3 });
  });

  it('drop invalid entries and read anything else as no targets', () => {
    expect(legacyMuscleTargets({ detailed: { chest: 0, calves: 1.5, quads: '8', ' ': 3, triceps: 6 } }, seeds(), null))
      .toEqual({ triceps: 6 });
    for (const value of [null, '{broken', [], { detailed: [] }, { detailed: null }, {}]) {
      expect(legacyMuscleTargets(value, seeds(), null)).toEqual({});
    }
  });
});
