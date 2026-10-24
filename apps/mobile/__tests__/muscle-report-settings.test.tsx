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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import SettingsRoute from '../app/(tabs)/settings';
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
  __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount,
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
  it('writes Broad\'s table onto every row, marking each changed row dirty', async () => {
    await listMuscleReportRows();
    cleanAll();
    await setMuscleReportPreset('broad');
    const rows = stored();
    expect(rows.size).toBeGreaterThanOrEqual(25);
    for (const [id, row] of rows) {
      expect(row.reportGroup).toBe(broadGroups().get(id) ?? null);
      expect(row.tracked).toBe(BROAD_MUSCLE_PRESET.untracked.includes(id) ? 0 : 1);
      const changed = row.reportGroup !== null || row.tracked === 0;
      expect(row.localDirty).toBe(changed);
    }
    expect(rows.get('spinal_erectors')).toMatchObject({ reportGroup: null, tracked: 0, localDirty: true });
    expect(rows.get('serratus_anterior')).toMatchObject({ reportGroup: 'chest', tracked: 1, localDirty: true });
  });

  it('clears the setup when Detailed is chosen', async () => {
    await listMuscleReportRows();
    await setMuscleReportPreset('broad');
    cleanAll();
    await setMuscleReportPreset('detailed');
    for (const row of stored().values()) {
      expect(row).toMatchObject({ reportGroup: null, tracked: 1 });
    }
    expect(stored().get('chest')?.localDirty).toBe(true);
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
    await setMuscleTracked(['forearms_grip'], true);
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
    const hidden = sections.flatMap(section => section.muscles).find(muscle => muscle.id === 'spinal_erectors');
    expect(hidden).toMatchObject({ tracked: false });
  });

  it('counts a muscle as tracked while any of its entries is', async () => {
    await setMuscleReportPreset('broad');
    await setMuscleTracked(['adductors'], false);
    const quads = buildSettingsMuscleSections(await listMuscleReportRows()).flatMap(section => section.muscles).find(muscle => muscle.id === 'quads');
    expect(quads?.tracked).toBe(true);
  });
});

describe('Settings → Progress → Muscles', () => {
  const openMuscles = async () => {
    setAccountLocalPreferenceAccount('A', true);
    await ensureAccountLocalPreferencesLoaded();
    render(<SettingsRoute />);
    await waitFor(() => expect(screen.getByTestId('settings-muscles-row')).toHaveTextContent(/Detailed/));
    fireEvent.press(screen.getByTestId('settings-muscles-row'));
    await screen.findByTestId('settings-muscle-preset-row');
  };
  const selected = (id: string) => screen.getByTestId(`settings-muscle-preset-${id}`).props.accessibilityState.selected;

  it('shows Detailed, then switches to Broad and back, writing the rows', async () => {
    await openMuscles();
    expect(selected('detailed')).toBe(true);
    expect(screen.getByTestId('settings-track-chest')).toBeTruthy();
    expect(screen.getByTestId('settings-track-serratus_anterior')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
    await waitFor(() => expect(selected('broad')).toBe(true));
    expect(stored().get('serratus_anterior')?.reportGroup).toBe('chest');
    expect(screen.queryByTestId('settings-track-serratus_anterior')).toBeNull();
    expect(screen.getByTestId('settings-track-back_lats')).toBeTruthy();
    expect(screen.getByTestId('settings-muscles-row')).toHaveTextContent(/Broad/);
    fireEvent.press(screen.getByTestId('settings-muscle-preset-detailed'));
    await waitFor(() => expect(selected('detailed')).toBe(true));
    expect(stored().get('serratus_anterior')).toMatchObject({ reportGroup: null, tracked: 1 });
  });

  it('switches a muscle off and on across all its entries and shows only family headers over several muscles', async () => {
    await openMuscles();
    fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
    await waitFor(() => expect(selected('broad')).toBe(true));
    expect(within(screen.getByTestId('settings-muscles-family-Shoulders')).getByText('Shoulders')).toBeTruthy();
    expect(within(screen.getByTestId('settings-muscles-family-Chest')).queryByText('Chest', { exact: true })).toBeTruthy();
    expect(within(screen.getByTestId('settings-muscles-family-Lower Legs')).queryByRole('header')).toBeNull();
    const calves = () => screen.getByTestId('settings-track-calves');
    expect(calves().props.accessibilityState.checked).toBe(true);
    fireEvent.press(calves());
    await waitFor(() => expect(calves().props.accessibilityState.checked).toBe(false));
    expect(stored().get('calves')?.tracked).toBe(0);
    expect(stored().get('tibialis_anterior')?.tracked).toBe(0);
    expect(selected('broad')).toBe(true);
    fireEvent.press(calves());
    await waitFor(() => expect(calves().props.accessibilityState.checked).toBe(true));
    expect(stored().get('tibialis_anterior')?.tracked).toBe(1);
  });

  it('names a setup that matches neither preset and lets a preset replace it', async () => {
    await listMuscleReportRows();
    localDatabase().update(muscleGroups).set({ reportGroup: 'chest' }).where(eq(muscleGroups.id, 'biceps')).run();
    setAccountLocalPreferenceAccount('A', true);
    await ensureAccountLocalPreferencesLoaded();
    render(<SettingsRoute />);
    await waitFor(() => expect(screen.getByTestId('settings-muscles-row')).toHaveTextContent(/Custom/));
    fireEvent.press(screen.getByTestId('settings-muscles-row'));
    await screen.findByTestId('settings-muscle-preset-row');
    expect(selected('detailed')).toBe(false);
    expect(selected('broad')).toBe(false);
    expect(screen.getByTestId('settings-muscle-preset-hint')).toHaveTextContent(/neither preset/);
    fireEvent.press(screen.getByTestId('settings-muscle-preset-detailed'));
    await waitFor(() => expect(selected('detailed')).toBe(true));
    expect(stored().get('biceps')?.reportGroup).toBeNull();
  });

  it('reports a failed save, keeps the shown choice and recovers on the next try', async () => {
    await openMuscles();
    const write = jest.spyOn(localDatabase(), 'transaction').mockImplementationOnce(() => { throw new Error('disk full'); });
    fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
    await screen.findByText('Couldn’t save the change. Try again.');
    expect(selected('detailed')).toBe(true);
    write.mockRestore();
    fireEvent.press(screen.getByTestId('settings-muscle-preset-broad'));
    await waitFor(() => expect(selected('broad')).toBe(true));
    expect(screen.queryByTestId('settings-muscles-error')).toBeNull();
  });
});
