/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: { id: 'A' } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useLocalSearchParams: () => ({}),
  useIsFocused: () => true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native navigation boundary.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));

import { eq } from 'drizzle-orm';
import { muscleGroups } from '@/src/data/schema';
import { BROAD_MUSCLE_PRESET } from '@/src/data/muscle-report-presets';
import {
  buildSettingsMuscleSections,
  deriveMuscleReportPreset,
  listMuscleReportRows,
  setMuscleReportPreset,
  setMuscleTracked,
} from '@/src/data/muscle-report-settings';
import {
  __resetAccountLocalPreferencesForTests,
} from '@/src/preferences/account-local';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

type Setup = { reportGroup: string | null; tracked: number; localDirty: boolean };

const stored = (): Map<string, Setup> =>
  new Map(localDatabase().select({
    id: muscleGroups.id, reportGroup: muscleGroups.reportGroup, tracked: muscleGroups.tracked, localDirty: muscleGroups.localDirty,
  }).from(muscleGroups).all().map(({ id, ...setup }) => [id, setup]));

const cleanAll = () => localDatabase().update(muscleGroups).set({ localDirty: false }).run();

const broadGroups = () => new Map(BROAD_MUSCLE_PRESET.muscles.flatMap(muscle =>
  muscle.entries.map(entry => [entry, muscle.key] as const)));

beforeEach(() => { resetLocalData(); __resetAccountLocalPreferencesForTests(); });
afterEach(() => closeLocalData());

describe('muscle setup writes', () => {
  it('writes Broad\'s merge table onto every row\'s reportGroup, marking each changed row dirty', async () => {
    await listMuscleReportRows();
    cleanAll();
    await setMuscleReportPreset('broad');
    const rows = stored();
    expect(rows.size).toBeGreaterThanOrEqual(25);
    for (const [id, row] of rows) {
      expect(row.reportGroup).toBe(broadGroups().get(id) ?? null);
      expect(row.tracked).toBe(1);
      expect(row.localDirty).toBe(row.reportGroup !== null);
    }
    expect(rows.get('spinal_erectors')).toMatchObject({ reportGroup: null, tracked: 1, localDirty: false });
    expect(rows.get('serratus_anterior')).toMatchObject({ reportGroup: 'chest', tracked: 1, localDirty: true });
  });

  it('clears reportGroup when Detailed is chosen', async () => {
    await listMuscleReportRows();
    await setMuscleReportPreset('broad');
    cleanAll();
    await setMuscleReportPreset('detailed');
    for (const row of stored().values()) {
      expect(row).toMatchObject({ reportGroup: null, tracked: 1 });
    }
    expect(stored().get('chest')?.localDirty).toBe(true);
  });

  it('never changes a row\'s tracked value when a preset is chosen', async () => {
    await listMuscleReportRows();
    await setMuscleTracked(['calves', 'forearms_grip'], false);
    await setMuscleReportPreset('broad');
    expect(stored().get('calves')).toMatchObject({ reportGroup: 'calves', tracked: 0 });
    expect(stored().get('forearms_grip')).toMatchObject({ reportGroup: null, tracked: 0 });
    expect(stored().get('quads')).toMatchObject({ reportGroup: 'quads', tracked: 1 });
    await setMuscleReportPreset('detailed');
    expect(stored().get('calves')).toMatchObject({ reportGroup: null, tracked: 0 });
    expect(stored().get('forearms_grip')).toMatchObject({ reportGroup: null, tracked: 0 });
  });

  it('writes nothing when the rows already hold the choice', async () => {
    await listMuscleReportRows();
    cleanAll();
    await setMuscleReportPreset('detailed');
    expect([...stored().values()].some(row => row.localDirty)).toBe(false);
    await setMuscleReportPreset('broad');
    cleanAll();
    await setMuscleReportPreset('broad');
    expect([...stored().values()].some(row => row.localDirty)).toBe(false);
  });

  it('sets tracked = 0 on every entry of a switched-off muscle and only those', async () => {
    await setMuscleReportPreset('broad');
    cleanAll();
    await setMuscleTracked(['quads', 'adductors', 'hip_flexors'], false);
    const rows = stored();
    for (const id of ['quads', 'adductors', 'hip_flexors']) {
      expect(rows.get(id)).toMatchObject({ reportGroup: 'quads', tracked: 0, localDirty: true });
    }
    expect(rows.get('calves')).toMatchObject({ tracked: 1, localDirty: false });
    await setMuscleTracked(['quads', 'adductors', 'hip_flexors'], true);
    expect(stored().get('adductors')).toMatchObject({ reportGroup: 'quads', tracked: 1 });
  });

  it('keeps custom muscles their own under Broad and leaves deleted rows alone', async () => {
    const database = localDatabase();
    await listMuscleReportRows();
    database.insert(muscleGroups).values({ id: 'custom-neck', displayName: 'Neck', familyName: 'Back', sortOrder: 99, isEditable: 1 }).run();
    database.insert(muscleGroups).values({ id: 'custom-gone', displayName: 'Gone', familyName: 'Back', sortOrder: 100, isEditable: 1, deletedAt: new Date() }).run();
    await setMuscleReportPreset('broad');
    expect(stored().get('custom-neck')).toMatchObject({ reportGroup: null, tracked: 1 });
    expect(stored().get('custom-gone')?.localDirty).toBe(false);
    expect((await listMuscleReportRows()).map(row => row.id)).not.toContain('custom-gone');
    expect(deriveMuscleReportPreset(await listMuscleReportRows())).toBe('broad');
    database.update(muscleGroups).set({ reportGroup: 'chest' }).where(eq(muscleGroups.id, 'custom-neck')).run();
    expect(deriveMuscleReportPreset(await listMuscleReportRows())).toBe('custom');
  });
});

describe('muscle setup derived from rows', () => {
  it('reads Detailed, Broad and neither', async () => {
    const detailed = await listMuscleReportRows();
    expect(deriveMuscleReportPreset(detailed)).toBe('detailed');
    expect(deriveMuscleReportPreset([])).toBe('detailed');
    await setMuscleReportPreset('broad');
    const broad = await listMuscleReportRows();
    expect(deriveMuscleReportPreset(broad)).toBe('broad');
    expect(deriveMuscleReportPreset(broad.map(row => row.id === 'chest' ? { ...row, reportGroup: null } : row))).toBe('custom');
  });

  it('keeps the preset when a Track switch changes', async () => {
    await setMuscleReportPreset('broad');
    await setMuscleTracked(['forearms_grip'], false);
    await setMuscleTracked(['calves', 'tibialis_anterior'], false);
    expect(deriveMuscleReportPreset(await listMuscleReportRows())).toBe('broad');
  });

  it('lists the muscles in family sections that show a header only above two or more', async () => {
    await setMuscleReportPreset('broad');
    const sections = buildSettingsMuscleSections(await listMuscleReportRows());
    const shape = Object.fromEntries(sections.map(section => [section.family, [section.showHeader, section.muscles.map(muscle => muscle.label)]]));
    expect(shape.Shoulders).toEqual([true, ['Front Delts', 'Lateral Delts', 'Rear Delts', 'Rotator Cuff']]);
    expect(shape.Chest).toEqual([false, ['Chest']]);
    expect(shape.Legs).toEqual([true, ['Quads', 'Glutes & Hams']]);
    const quads = sections.flatMap(section => section.muscles).find(muscle => muscle.id === 'quads');
    expect(quads?.entryIds.sort()).toEqual(['adductors', 'hip_flexors', 'quads']);
    const own = sections.flatMap(section => section.muscles).find(muscle => muscle.id === 'spinal_erectors');
    expect(own).toMatchObject({ tracked: true, entryIds: ['spinal_erectors'] });
  });

  it('counts a muscle as tracked while any of its entries is', async () => {
    await setMuscleReportPreset('broad');
    await setMuscleTracked(['adductors'], false);
    const quads = buildSettingsMuscleSections(await listMuscleReportRows()).flatMap(section => section.muscles).find(muscle => muscle.id === 'quads');
    expect(quads?.tracked).toBe(true);
  });
});
