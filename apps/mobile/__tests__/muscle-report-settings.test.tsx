/* eslint-disable import/first */
// The muscle setup in the local database ([[muscle.report-groups]]): every
// combined-muscle change writes the rows and definitions it produces, dirty,
// and the first write on a legacy account migrates it.
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/exercise-catalog/invalidation', () => ({
  ...jest.requireActual('@/src/exercise-catalog/invalidation'), invalidateExerciseCatalogCache: jest.fn(),
}));

import { eq } from 'drizzle-orm';
import { BROAD_COMBINED_MUSCLES, broadTemplateKeyOf } from '@/src/data/combined-muscles';
import { muscleGroups, userSettings } from '@/src/data/schema';
import {
  applyBroadTemplate,
  buildSettingsMuscleSections,
  clearCombinedMuscles,
  CombinedMuscleError,
  createCombinedMuscle,
  deleteCombinedMuscle,
  deriveMuscleReportPreset,
  listMuscleReportRows,
  migrateLegacyMuscleSetup,
  newCombinedMuscleKey,
  readCombinedMuscleDefinitions,
  readMuscleSetup,
  renameCombinedMuscle,
  setMuscleState,
  setMuscleTracked,
  updateCombinedMuscle,
} from '@/src/data/muscle-report-settings';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { closeLocalData, localDataClient, localDatabase, resetLocalData } from './helpers/local-data';

type Setup = { reportGroup: string | null; tracked: number; localDirty: boolean };

const stored = (): Map<string, Setup> =>
  new Map(localDatabase().select({
    id: muscleGroups.id, reportGroup: muscleGroups.reportGroup, tracked: muscleGroups.tracked, localDirty: muscleGroups.localDirty,
  }).from(muscleGroups).all().map(({ id, ...setup }) => [id, setup]));
const settings = () => localDatabase().select().from(userSettings).where(eq(userSettings.id, 'settings')).get();
const definitions = () => JSON.parse(settings()?.combinedMuscles ?? 'null');

const cleanAll = () => {
  localDatabase().update(muscleGroups).set({ localDirty: false }).run();
  localDatabase().update(userSettings).set({ localDirty: false }).run();
};
/** The rows of an account that chose Broad before combined muscles: bare Broad keys. */
const legacyBroad = () => {
  const update = localDataClient().prepare('UPDATE muscle_groups SET report_group = ? WHERE id = ?');
  for (const id of stored().keys()) update.run(broadTemplateKeyOf(id)?.slice('cm_'.length) ?? null, id);
};
const membersOf = (key: string) => [...stored()].filter(([, row]) => row.reportGroup === key).map(([id]) => id).sort();

beforeEach(() => {
  resetLocalData();
  jest.mocked(notifyLocalWrite).mockClear();
  jest.mocked(invalidateExerciseCatalogCache).mockClear();
});
afterEach(() => closeLocalData());

describe('Start from Broad and Detailed', () => {
  it('stores the 11 Broad combined muscles and writes each tracked entry\'s key, dirtying only what changed', async () => {
    await listMuscleReportRows();
    cleanAll();
    await applyBroadTemplate();
    expect(definitions()).toEqual(BROAD_COMBINED_MUSCLES);
    expect(settings()).toMatchObject({ localDirty: true });
    for (const [id, row] of stored()) {
      expect(row.reportGroup).toBe(broadTemplateKeyOf(id));
      expect(row.localDirty).toBe(row.reportGroup !== null);
    }
    expect(stored().get('serratus_anterior')).toMatchObject({ reportGroup: 'cm_chest', tracked: 1 });
    expect(stored().get('spinal_erectors')).toMatchObject({ reportGroup: null, localDirty: false });
    expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
    expect(invalidateExerciseCatalogCache).toHaveBeenCalledTimes(1);
  });

  it('replaces every other combined muscle, and leaves Off entries out', async () => {
    const key = await createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps', 'triceps', 'forearms_grip'] });
    await setMuscleState(['calves'], { kind: 'off' });
    await applyBroadTemplate();
    expect(definitions().map((muscle: { key: string }) => muscle.key)).not.toContain(key);
    expect(stored().get('forearms_grip')).toMatchObject({ reportGroup: null, tracked: 1 });
    expect(stored().get('calves')).toMatchObject({ reportGroup: null, tracked: 0 });
    expect(stored().get('tibialis_anterior')).toMatchObject({ reportGroup: 'cm_calves', tracked: 1 });
  });

  it('clears every combined muscle for Detailed, keeping tracking', async () => {
    await applyBroadTemplate();
    await setMuscleTracked(['quads'], false);
    cleanAll();
    await clearCombinedMuscles();
    expect(definitions()).toEqual([]);
    for (const row of stored().values()) expect(row.reportGroup).toBeNull();
    expect(stored().get('quads')).toMatchObject({ tracked: 0, localDirty: true });
    expect(stored().get('spinal_erectors')?.localDirty).toBe(false);
  });

  it('writes nothing when the setup already holds the choice', async () => {
    await applyBroadTemplate();
    cleanAll();
    jest.mocked(notifyLocalWrite).mockClear();
    await applyBroadTemplate();
    expect([...stored().values()].some(row => row.localDirty)).toBe(false);
    expect(settings()?.localDirty).toBe(false);
    expect(notifyLocalWrite).not.toHaveBeenCalled();
  });
});

describe('combined muscles', () => {
  it('creates one with a cm_ key in its family, switching its members on', async () => {
    await setMuscleState(['traps_lower'], { kind: 'off' });
    const key = await createCombinedMuscle({ name: ' Traps ', family: 'Back', memberIds: ['traps_upper', 'traps_lower'] });
    expect(key).toMatch(/^cm_[a-z0-9]+$/);
    expect(await readCombinedMuscleDefinitions()).toEqual([{ key, name: 'Traps', family: 'Back' }]);
    expect(membersOf(key)).toEqual(['traps_lower', 'traps_upper']);
    expect(stored().get('traps_lower')?.tracked).toBe(1);
  });

  it('allows one member and custom muscles of the family', async () => {
    localDatabase().insert(muscleGroups).values({ id: 'custom-neck', displayName: 'Neck', familyName: 'Back', sortOrder: 99, isEditable: 1 }).run();
    const key = await createCombinedMuscle({ name: 'Neck & traps', family: 'Back', memberIds: ['custom-neck'] });
    expect(membersOf(key)).toEqual(['custom-neck']);
    await updateCombinedMuscle({ key, name: 'Neck & traps', memberIds: ['custom-neck', 'traps_upper'] });
    expect(membersOf(key)).toEqual(['custom-neck', 'traps_upper']);
  });

  it('rejects a member of another family, writing nothing', async () => {
    await expect(createCombinedMuscle({ name: 'Mixed', family: 'Back', memberIds: ['back_lats', 'biceps'] }))
      .rejects.toThrow(CombinedMuscleError);
    const key = await createCombinedMuscle({ name: 'Lats', family: 'Back', memberIds: ['back_lats'] });
    await expect(setMuscleState(['biceps'], { kind: 'combined', key })).rejects.toThrow(/only Back muscles/);
    await expect(updateCombinedMuscle({ key, name: 'Lats', memberIds: ['back_lats', 'chest'] })).rejects.toThrow(CombinedMuscleError);
    expect(membersOf(key)).toEqual(['back_lats']);
    expect(stored().get('biceps')?.reportGroup).toBeNull();
  });

  it('rejects a blank or long name, no member, no family or an unknown key', async () => {
    await expect(createCombinedMuscle({ name: '  ', family: 'Back', memberIds: ['back_lats'] })).rejects.toThrow(/name/);
    await expect(createCombinedMuscle({ name: 'x'.repeat(61), family: 'Back', memberIds: ['back_lats'] })).rejects.toThrow(/name/);
    await expect(createCombinedMuscle({ name: 'Back', family: 'Back', memberIds: [] })).rejects.toThrow(/at least one/);
    await expect(createCombinedMuscle({ name: 'Back', family: ' ', memberIds: ['back_lats'] })).rejects.toThrow(/family/);
    await expect(updateCombinedMuscle({ key: 'chest', name: 'Back', memberIds: ['back_lats'] })).rejects.toThrow(/key/);
    await expect(renameCombinedMuscle('cm_missing', 'Back')).rejects.toThrow(/No combined muscle/);
    await expect(deleteCombinedMuscle('cm_missing')).rejects.toThrow(/No combined muscle/);
    await expect(setMuscleState(['back_lats'], { kind: 'combined', key: 'cm_missing' })).rejects.toThrow(/No combined muscle/);
    expect(settings()).toBeUndefined();
  });

  it('edits exactly the members, dropping removed ones back to their own muscle', async () => {
    const key = await createCombinedMuscle({ name: 'Back', family: 'Back', memberIds: ['back_lats', 'back_upper'] });
    await updateCombinedMuscle({ key, name: 'Upper back', memberIds: ['back_upper', 'traps_upper'] });
    expect(membersOf(key)).toEqual(['back_upper', 'traps_upper']);
    expect(stored().get('back_lats')).toMatchObject({ reportGroup: null, tracked: 1 });
    expect(await readCombinedMuscleDefinitions()).toEqual([{ key, name: 'Upper back', family: 'Back' }]);
  });

  it('renames without touching members, Off ones included', async () => {
    const key = await createCombinedMuscle({ name: 'Back', family: 'Back', memberIds: ['back_lats', 'back_upper'] });
    await setMuscleTracked(['back_upper'], false);
    cleanAll();
    await renameCombinedMuscle(key, 'Lats & upper');
    expect(await readCombinedMuscleDefinitions()).toEqual([{ key, name: 'Lats & upper', family: 'Back' }]);
    expect(membersOf(key)).toEqual(['back_lats', 'back_upper']);
    expect([...stored().values()].some(row => row.localDirty)).toBe(false);
    await expect(renameCombinedMuscle(key, ' ')).rejects.toThrow(/name/);
  });

  it('deletes one, its members becoming their own muscles with tracking unchanged', async () => {
    await applyBroadTemplate();
    await setMuscleTracked(['hamstrings'], false);
    await deleteCombinedMuscle('cm_glutes_hams');
    expect(definitions()).toHaveLength(10);
    expect(stored().get('hamstrings')).toMatchObject({ reportGroup: null, tracked: 0 });
    expect(stored().get('glutes_max')).toMatchObject({ reportGroup: null, tracked: 1 });
  });

  it('sets a muscle Off, On on its own, or into a combined muscle', async () => {
    const key = await createCombinedMuscle({ name: 'Arms', family: 'Arms', memberIds: ['biceps'] });
    await setMuscleState(['brachialis'], { kind: 'combined', key });
    expect(stored().get('brachialis')).toMatchObject({ reportGroup: key, tracked: 1 });
    await setMuscleState(['brachialis'], { kind: 'off' });
    expect(stored().get('brachialis')).toMatchObject({ reportGroup: null, tracked: 0 });
    await setMuscleState(['brachialis'], { kind: 'own' });
    expect(stored().get('brachialis')).toMatchObject({ reportGroup: null, tracked: 1 });
  });

  it('makes keys that are never an entry id', () => {
    const keys = new Set(Array.from({ length: 20 }, newCombinedMuscleKey));
    expect(keys.size).toBe(20);
    for (const key of keys) expect(key).toMatch(/^cm_[a-z0-9_]{1,64}$/);
  });

  it('leaves deleted rows alone', async () => {
    localDatabase().insert(muscleGroups).values({ id: 'custom-gone', displayName: 'Gone', familyName: 'Back', sortOrder: 100,
      isEditable: 1, deletedAt: new Date() }).run();
    await expect(createCombinedMuscle({ name: 'Gone', family: 'Back', memberIds: ['custom-gone'] })).rejects.toThrow(/at least one/);
    await applyBroadTemplate();
    expect(stored().get('custom-gone')).toMatchObject({ reportGroup: null, localDirty: false });
  });
});

describe('the one-time migration of a legacy account', () => {
  const legacyTargets = (overrides: unknown) => localDatabase().insert(userSettings).values({ id: 'settings',
    muscleTargetOverrides: JSON.stringify(overrides), weeklyWorkingSetTarget: 8, muscleTargetMode: 'per_muscle' }).run();

  it('reads legacy Broad keys as the template\'s combined muscles before anything is stored', async () => {
    await listMuscleReportRows();
    legacyBroad();
    const setup = await readMuscleSetup();
    expect(setup.definitions).toEqual(BROAD_COMBINED_MUSCLES);
    expect(setup.rows.find(row => row.id === 'adductors')?.reportGroup).toBe('cm_quads');
    expect(deriveMuscleReportPreset(setup)).toBe('broad');
    expect(await readCombinedMuscleDefinitions()).toBeNull();
  });

  it('stores the Broad keys in use as definitions and rewrites their members, with the active setup\'s targets as the map', async () => {
    await listMuscleReportRows();
    // A custom setup: only Chest and part of Back merged.
    localDataClient().prepare("UPDATE muscle_groups SET report_group = 'chest' WHERE id IN ('chest', 'serratus_anterior')").run();
    localDataClient().prepare("UPDATE muscle_groups SET report_group = 'back' WHERE id = 'back_upper'").run();
    legacyTargets({ detailed: { chest: 20 }, custom: { chest: 12, back_lats: 10, calves: 6 }, broad: { chest: 99 } });
    cleanAll();

    expect(await migrateLegacyMuscleSetup()).toBe(true);
    expect(definitions()).toEqual([
      { key: 'cm_chest', name: 'Chest', family: 'Chest' }, { key: 'cm_back', name: 'Back', family: 'Back' },
    ]);
    expect(membersOf('cm_chest')).toEqual(['chest', 'serratus_anterior']);
    expect(membersOf('cm_back')).toEqual(['back_upper']);
    expect(stored().get('chest')?.localDirty).toBe(true);
    // Chest's and Back's preset anchor ids move to their keys; the rest stay.
    expect(JSON.parse(settings()!.muscleTargets!)).toEqual({ cm_chest: 12, cm_back: 10, calves: 6 });
    expect(settings()).toMatchObject({ localDirty: true, muscleTargetOverrides: expect.any(String) });

    expect(await migrateLegacyMuscleSetup()).toBe(false);
  });

  it('takes Detailed targets as they are and stores no definitions for a Detailed account', async () => {
    await listMuscleReportRows();
    legacyTargets({ detailed: { chest: 14 }, broad: { chest: 9 } });
    expect(await migrateLegacyMuscleSetup()).toBe(true);
    expect(definitions()).toEqual([]);
    expect(JSON.parse(settings()!.muscleTargets!)).toEqual({ chest: 14 });
  });

  it('does nothing for an account with neither legacy keys nor legacy targets, nor once definitions exist', async () => {
    await listMuscleReportRows();
    expect(await migrateLegacyMuscleSetup()).toBe(false);
    expect(settings()).toBeUndefined();
    await applyBroadTemplate();
    legacyBroad();
    expect(await migrateLegacyMuscleSetup()).toBe(false);
  });

  it('leaves combined keys whose definitions have not arrived alone, refusing a setup write until they do', async () => {
    await listMuscleReportRows();
    localDataClient().prepare("UPDATE muscle_groups SET report_group = 'cm_chest' WHERE id IN ('chest', 'serratus_anterior')").run();
    legacyTargets({ broad: { chest: 15 } });
    cleanAll();
    expect(await migrateLegacyMuscleSetup()).toBe(false);
    await expect(setMuscleTracked(['calves'], false)).rejects.toThrow(/still syncing/);
    expect(membersOf('cm_chest')).toEqual(['chest', 'serratus_anterior']);
    expect(settings()).toMatchObject({ combinedMuscles: null, muscleTargets: null, localDirty: false });
  });

  it('migrates on the first setup write too, never overwriting a target map already stored', async () => {
    await listMuscleReportRows();
    legacyBroad();
    legacyTargets({ broad: { chest: 15 } });
    await setMuscleTracked(['calves'], false);
    expect(definitions()).toEqual(BROAD_COMBINED_MUSCLES);
    expect(stored().get('calves')).toMatchObject({ reportGroup: 'cm_calves', tracked: 0 });
    expect(JSON.parse(settings()!.muscleTargets!)).toEqual({ cm_chest: 15 });

    localDatabase().update(userSettings).set({ muscleTargets: '{"chest":3}' }).run();
    await clearCombinedMuscles();
    expect(JSON.parse(settings()!.muscleTargets!)).toEqual({ chest: 3 });
  });
});

describe('the setup screens read', () => {
  it('reads Detailed, Broad and neither', async () => {
    expect(deriveMuscleReportPreset(await readMuscleSetup())).toBe('detailed');
    expect(deriveMuscleReportPreset({ rows: [], definitions: [] })).toBe('detailed');
    await applyBroadTemplate();
    const broad = await readMuscleSetup();
    expect(deriveMuscleReportPreset(broad)).toBe('broad');
    expect(deriveMuscleReportPreset({ ...broad, rows: broad.rows.map(row => row.id === 'chest' ? { ...row, reportGroup: null } : row) }))
      .toBe('custom');
    await renameCombinedMuscle('cm_chest', 'Pecs');
    expect(deriveMuscleReportPreset(await readMuscleSetup())).toBe('custom');
  });

  it('keeps Broad when a Track switch changes', async () => {
    await applyBroadTemplate();
    await setMuscleTracked(['forearms_grip'], false);
    await setMuscleTracked(['calves', 'tibialis_anterior'], false);
    expect(deriveMuscleReportPreset(await readMuscleSetup())).toBe('broad');
  });

  it('lists the muscles in family sections that show a header only above two or more', async () => {
    await applyBroadTemplate();
    const setup = await readMuscleSetup();
    const sections = buildSettingsMuscleSections(setup.rows, setup.definitions);
    const shape = Object.fromEntries(sections.map(section => [section.family, [section.showHeader, section.muscles.map(muscle => muscle.label)]]));
    expect(shape.Shoulders).toEqual([true, ['Front Delts', 'Lateral Delts', 'Rear Delts', 'Rotator Cuff']]);
    expect(shape.Chest).toEqual([false, ['Chest']]);
    expect(shape.Legs).toEqual([true, ['Quads', 'Glutes & Hams']]);
    const quads = sections.flatMap(section => section.muscles).find(muscle => muscle.id === 'cm_quads');
    expect(quads?.entryIds.sort()).toEqual(['adductors', 'hip_flexors', 'quads']);
    const own = sections.flatMap(section => section.muscles).find(muscle => muscle.id === 'spinal_erectors');
    expect(own).toMatchObject({ tracked: true, entryIds: ['spinal_erectors'] });
  });

  it('counts a muscle as tracked while any of its entries is', async () => {
    await applyBroadTemplate();
    await setMuscleTracked(['adductors'], false);
    const setup = await readMuscleSetup();
    const quads = buildSettingsMuscleSections(setup.rows, setup.definitions).flatMap(section => section.muscles)
      .find(muscle => muscle.id === 'cm_quads');
    expect(quads?.tracked).toBe(true);
  });
});
