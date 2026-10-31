/* eslint-disable import/first */
/**
 * The synced weekly muscle targets and count-secondary switch on the settings
 * row ([[muscle.weekly-targets]]): the data layer's read, edit and adopt
 * writes, and the conversion that guards every stored value before the app
 * uses it.
 */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { eq } from 'drizzle-orm';

import { stampLocalDataOwner } from '@/src/data/local-wipe';
import { userSettings } from '@/src/data/schema';
import { configurePersonalMuscleCounting } from '@/src/config/personal-muscles';
import {
  adoptMuscleTargetSettings,
  readMuscleTargetSettings,
  writeBodyweightCalculationsEnabled,
  writeMuscleTargetSettings,
} from '@/src/data/user-settings';
import { storedFromSyncedPreferences, syncedPreferencesFromStored } from '@/src/preferences/synced';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

const row = () => localDatabase().select().from(userSettings).where(eq(userSettings.id, 'settings')).get();
const TARGETS = {
  weeklyWorkingSetTarget: 12, muscleTargetMode: 'per_muscle', muscleTargetOverrides: '{"broad":{"chest":16}}',
  countSecondaryMuscles: false, volumePrimaryOnly: false,
};

beforeEach(() => resetLocalData());
afterEach(() => closeLocalData());

describe('settings row', () => {
  it('pins a legacy profile choice on creation and never resets it on later bodyweight edits', async () => {
    configurePersonalMuscleCounting({ countSecondarySets: true, countSecondaryVolume: true });
    await writeBodyweightCalculationsEnabled(true);
    expect(row()).toMatchObject({ countSecondaryMuscles: true, volumePrimaryOnly: null });
    configurePersonalMuscleCounting({ countSecondarySets: false, countSecondaryVolume: true });
    await writeBodyweightCalculationsEnabled(false);
    expect(row()).toMatchObject({ countSecondaryMuscles: true, volumePrimaryOnly: null });
  });

  it('reads null before any row exists, then round-trips an edit as one dirty row', async () => {
    expect(await readMuscleTargetSettings('A')).toBeNull();
    await writeMuscleTargetSettings(TARGETS);
    expect(await readMuscleTargetSettings('A')).toEqual(TARGETS);
    expect(row()).toMatchObject({ localDirty: true, deletedAt: null });
  });

  it('keeps targets and Volume unknown while pinning fresh Sets when bodyweight creates a row', async () => {
    await writeBodyweightCalculationsEnabled(true);
    expect(await readMuscleTargetSettings('A')).toEqual({
      weeklyWorkingSetTarget: null, muscleTargetMode: null, muscleTargetOverrides: null,
      countSecondaryMuscles: false, volumePrimaryOnly: null,
    });
  });

  it('edits a row the bodyweight switch created without changing the switch', async () => {
    await writeBodyweightCalculationsEnabled(true);
    const before = row()!.localUpdatedAtMs;
    await writeMuscleTargetSettings(TARGETS);
    expect(row()).toMatchObject({ ...TARGETS, bodyweightCalculationsEnabled: true, localDirty: true });
    expect(row()!.localUpdatedAtMs).toBeGreaterThan(before);
  });

  it('adopts server values without dirtying the row or moving its LWW stamp', async () => {
    expect(await adoptMuscleTargetSettings(TARGETS)).toBe(false);
    localDatabase().insert(userSettings).values({ id: 'settings', localDirty: false, localUpdatedAtMs: 500 }).run();
    expect(await adoptMuscleTargetSettings(TARGETS)).toBe(true);
    expect(row()).toMatchObject({ ...TARGETS, localDirty: false, localUpdatedAtMs: 500 });
  });

  it('never reads another account\'s row, and the local-only build reads any', async () => {
    await writeMuscleTargetSettings(TARGETS);
    stampLocalDataOwner(localDatabase(), 'A');
    expect(await readMuscleTargetSettings('A')).toEqual(TARGETS);
    expect(await readMuscleTargetSettings('B')).toBeNull();
    expect(await readMuscleTargetSettings(null)).toEqual(TARGETS);
  });
});

describe('stored values', () => {
  it('maps the wire mode and parses the overrides', () => {
    expect(syncedPreferencesFromStored({ ...TARGETS })).toEqual({
      weeklyWorkingSetTarget: 12, muscleTargetMode: 'per-muscle', muscleTargetOverrides: { broad: { chest: 16 } },
      progressCountSecondary: false,
      muscleVolumePrimaryOnly: false,
    });
    expect(syncedPreferencesFromStored({ ...TARGETS, muscleTargetMode: 'single' }).muscleTargetMode).toBe('single');
  });

  it.each([
    ['a missing row', null],
    ['null columns', { weeklyWorkingSetTarget: null, muscleTargetMode: null, muscleTargetOverrides: null, countSecondaryMuscles: null }],
    ['invalid values', { weeklyWorkingSetTarget: 0, muscleTargetMode: 'weekly', muscleTargetOverrides: '{"broad":{"chest":1.5}}', countSecondaryMuscles: null }],
    ['unreadable overrides', { weeklyWorkingSetTarget: -2, muscleTargetMode: null, muscleTargetOverrides: '{broken', countSecondaryMuscles: null }],
    ['an unknown scope', { weeklyWorkingSetTarget: null, muscleTargetMode: null, muscleTargetOverrides: '{"region":{"chest":8}}', countSecondaryMuscles: null }],
  ])('leaves out %s, so the kv value or the default applies', (_label, stored) => {
    expect(syncedPreferencesFromStored(stored)).toEqual({});
  });

  it('writes all settings columns, filling unset fields with independent defaults', () => {
    expect(storedFromSyncedPreferences({ weeklyWorkingSetTarget: 10 })).toEqual({
      weeklyWorkingSetTarget: 10, muscleTargetMode: 'single', muscleTargetOverrides: '{}', countSecondaryMuscles: false, volumePrimaryOnly: false,
    });
    const values = { weeklyWorkingSetTarget: 9, muscleTargetMode: 'per-muscle' as const,
      muscleTargetOverrides: { detailed: { chest: 12 } }, progressCountSecondary: false, muscleVolumePrimaryOnly: false };
    expect(syncedPreferencesFromStored(storedFromSyncedPreferences(values))).toEqual(values);
  });
});
