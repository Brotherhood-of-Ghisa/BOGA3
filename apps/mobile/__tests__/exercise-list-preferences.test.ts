import * as SecureStore from 'expo-secure-store';
import { Storage } from 'expo-sqlite/kv-store';
import {
  __resetExerciseListPreferencesForTests,
  ensureExerciseListPreferencesLoaded as load,
  getExerciseListPreferencesSnapshot as values,
  setExerciseListPreferences as update,
  subscribeToExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import {
  getAccountLocalPreferenceState as state,
  retryAccountLocalPreferences as retry,
  setAccountLocalPreferenceAccount as account,
} from '@/src/preferences/account-local';
import {
  LEGACY_PREFERENCES_KEY, LEGACY_PREFERENCES_OWNER_KEY, migrationCompleteKey,
} from '@/src/preferences/migration';
import { DEFAULT_EXERCISE_LIST_PREFERENCES as defaults, DEFAULT_ACCOUNT_LOCAL_PREFERENCES as allDefaults } from '@/src/preferences/model';
import { preferenceKey } from '@/src/preferences/storage';

const nativeWrite = Storage.setItemSync;
let read: jest.SpyInstance;
let removeLegacy: jest.SpyInstance;
let write: jest.SpyInstance;
let scopedRead: jest.SpyInstance;
const select = async (id: string | null, configured = true) => { account(id, configured); await load(); };
const put = (field: keyof typeof defaults, value: string, id = 'A') =>
  Storage.setItemSync(preferenceKey(`account:${id}`, field), value);
const deferred = () => {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>(done => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  read = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  removeLegacy = jest.spyOn(SecureStore, 'deleteItemAsync').mockResolvedValue(undefined);
  write = jest.spyOn(Storage, 'setItemSync');
  scopedRead = jest.spyOn(Storage, 'getItemSync');
});
afterEach(() => { jest.restoreAllMocks(); });

it.each([true, false])('migrates legacy recents %s, retains active fields and ignores grouping/range', async recentsOnTop => {
  read.mockResolvedValue(JSON.stringify({ recentsOnTop, dateRange: 7, groupByMuscleFamily: false,
    showNeverDone: false, dateFormat: 'YYYY-MM-DD', pastRecordsGymScope: 'current-gym' }));
  await select('A');
  expect(values()).toEqual({ sort: recentsOnTop ? 'favourite' : 'name', showNeverDone: false,
    dateFormat: 'YYYY-MM-DD', pastRecordsGymScope: 'current-gym' });
  expect(Storage.getItemSync(preferenceKey('account:A', 'showNeverDone'))).toBe('false');
  expect(read).toHaveBeenCalledWith(LEGACY_PREFERENCES_KEY);
});

it.each([null, 'bad-json', 'null', '[]', '3', '{"sort":"recent","showNeverDone":"no","dateFormat":"invalid","pastRecordsGymScope":"elsewhere"}'])
('defaults malformed or absent legacy preferences %s', async stored => {
  read.mockResolvedValue(stored);
  await select('A');
  expect(values()).toEqual(defaults);
});

it('valid scoped values win over legacy data and invalid scalar values receive migrated defaults', async () => {
  put('sort', 'name'); put('showNeverDone', 'nonsense');
  put('dateFormat', 'MM-DD-YYYY'); put('pastRecordsGymScope', 'current-gym');
  read.mockResolvedValue('{"sort":"favourite","dateFormat":"YYYY-MM-DD"}');
  await select('A');
  expect(values()).toEqual({ sort: 'name', showNeverDone: true,
    dateFormat: 'MM-DD-YYYY', pastRecordsGymScope: 'current-gym' });
});

it('persists ordered partial edits across reload, preserves unrelated values and unsubscribes', async () => {
  await select('A');
  const listener = jest.fn();
  const unsubscribe = subscribeToExerciseListPreferences(listener);
  update({ sort: 'name' }); update({ showNeverDone: false }); update({ dateFormat: 'YYYY-MM-DD' });
  expect(listener).toHaveBeenCalled();
  unsubscribe(); listener.mockClear(); update({ pastRecordsGymScope: 'current-gym' });
  expect(listener).not.toHaveBeenCalled();
  __resetExerciseListPreferencesForTests();
  await select('A');
  expect(values()).toEqual({ sort: 'name', showNeverDone: false,
    dateFormat: 'YYYY-MM-DD', pastRecordsGymScope: 'current-gym' });
});

it('keeps edits during the legacy read, preserving unrelated migrated fields', async () => {
  const slow = deferred(); read.mockReturnValue(slow.promise);
  account('A', true); const loading = load();
  update({ showNeverDone: false });
  slow.resolve('{"recentsOnTop":false,"dateFormat":"MM-DD-YYYY"}'); await loading;
  expect(values()).toEqual({ sort: 'name', showNeverDone: false,
    dateFormat: 'MM-DD-YYYY', pastRecordsGymScope: 'all' });
});

it('does not claim while signed out or local-only; the first migrating account owns the source', async () => {
  await select(null); update({ sort: 'name' });
  expect(values()).toEqual(defaults);
  expect(Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY)).toBeNull();
  await select(null, false); update({ showNeverDone: false });
  expect(read).not.toHaveBeenCalled();
  read.mockResolvedValue('{"sort":"name"}');
  await select('A'); expect(values().sort).toBe('name');
  expect(values().showNeverDone).toBe(true);
  expect(Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY)).toBe('account:A');
  await select('B'); expect(values()).toEqual(defaults);
  update({ dateFormat: 'YYYY-MM-DD' });
  await select('A'); expect(values().dateFormat).toBe('DD-MM-YYYY');
  await select('B'); expect(values().dateFormat).toBe('YYYY-MM-DD');
  await select(null); expect(values()).toEqual(defaults); expect(state().pending).toEqual({});
  await select('A'); expect(values().sort).toBe('name');
  await select(null, false); expect(values().showNeverDone).toBe(false);
});

it('clears failed input on account switches and isolates a user named local', async () => {
  await select(null, false); update({ sort: 'name' });
  await select('local'); expect(values()).toEqual(defaults);
  jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  update({ showNeverDone: false }); expect(state().pending).toEqual({ showNeverDone: false });
  await select('B'); expect(state()).toEqual({ values: allDefaults, error: null, pending: {} });
});

it('discards late migration results after switching to B, signing out and returning to A', async () => {
  const slow = deferred(); read.mockReturnValue(slow.promise);
  account('A', true); const initial = load();
  await select('B'); update({ dateFormat: 'YYYY-MM-DD' });
  slow.resolve('{"sort":"name"}'); await initial;
  expect(values()).toEqual({ ...defaults, dateFormat: 'YYYY-MM-DD' });
  await select(null); expect(values()).toEqual(defaults);
  await select('A'); expect(values()).toEqual({ ...defaults, sort: 'name' });
});

it('a stale failed request cannot publish its error into a later account', async () => {
  let reject!: (error: Error) => void;
  read.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  account('A', true); const initial = load();
  await select('B'); reject(Error('locked')); await initial;
  expect(state()).toEqual({ values: allDefaults, pending: {}, error: null });
});

it('a failed read blocks saving defaults over stored values and preserves retry input', async () => {
  put('sort', 'name');
  const nativeRead = jest.spyOn(Storage, 'getItemSync');
  nativeRead.mockImplementation(() => { throw Error('locked'); });
  await select('A'); write.mockClear(); update({ showNeverDone: false });
  expect(write).not.toHaveBeenCalled(); expect(values()).toEqual(defaults);
  expect(state().pending).toEqual({ showNeverDone: false }); expect(state().error).toMatch(/loaded/);
  nativeRead.mockRestore(); await retry();
  expect(values()).toEqual({ ...defaults, sort: 'name', showNeverDone: false });
  expect(state().error).toBeNull();
});

it('failed saves retain durable values and requested input, which Retry saves', async () => {
  await select('A');
  jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
  update({ sort: 'name' });
  expect(values()).toEqual(defaults); expect(state().error).toMatch(/saved/);
  expect(state().pending).toEqual({ sort: 'name' });
  await retry(); expect(values().sort).toBe('name'); expect(state().pending).toEqual({});
  expect(state().error).toBeNull();
});

it('a partially failed update publishes only durable scalar edits and retries the remainder', async () => {
  await select('A');
  jest.spyOn(Storage, 'setItemSync').mockImplementation((key, value) => {
    if (key.endsWith('.showNeverDone')) throw Error('disk full');
    nativeWrite(key, value);
  });
  update({ sort: 'name', showNeverDone: false });
  expect(values()).toEqual({ ...defaults, sort: 'name' });
  expect(state().pending).toEqual({ showNeverDone: false });
  write.mockRestore(); await retry(); expect(values().showNeverDone).toBe(false);
});

it('reserves a failed owner claim for A during account switches and retries it when A returns', async () => {
  write.mockImplementationOnce(() => { throw Error('disk full'); });
  read.mockResolvedValue('{"sort":"name"}');
  await select('A');
  expect(Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY)).toBeNull();
  await select('B');
  expect(values()).toEqual(defaults);
  expect(Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  await select('A');
  expect(values().sort).toBe('name');
  expect(Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY)).toBe('account:A');
});

it('retains the migration claim and source after failed legacy reads, retrying only for A', async () => {
  read.mockRejectedValueOnce(Error('keychain locked')).mockResolvedValue('{"sort":"name"}');
  await select('A'); expect(state().error).toMatch(/loaded/);
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBeNull();
  await select('B'); expect(values()).toEqual(defaults); expect(read).toHaveBeenCalledTimes(1);
  await select('A'); expect(values().sort).toBe('name');
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBe('true');
});

it('a successful edit retains a failed migration notice until Retry loads the other choices', async () => {
  read.mockRejectedValueOnce(Error('keychain locked')).mockResolvedValue('{"sort":"name","showNeverDone":false}');
  await select('A');
  update({ dateFormat: 'YYYY-MM-DD' });
  expect(state().error).toMatch(/loaded/);
  await retry();
  expect(values()).toEqual({ ...defaults, sort: 'name', showNeverDone: false, dateFormat: 'YYYY-MM-DD' });
  expect(state().error).toBeNull();
});

it('retries failed source cleanup without losing edits or marking incomplete migration as finished', async () => {
  read.mockResolvedValue('{"sort":"name"}');
  removeLegacy.mockRejectedValueOnce(Error('keychain locked')).mockResolvedValue(undefined);
  await select('A');
  expect(values().sort).toBe('name');
  expect(state().error).toMatch(/loaded/);
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBeNull();
  update({ showNeverDone: false });
  await retry();
  expect(values()).toMatchObject({ sort: 'name', showNeverDone: false });
  expect(removeLegacy).toHaveBeenCalledTimes(2);
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBe('true');
});

it('removes the keychain source after durable conversion so a reinstall starts with defaults', async () => {
  let legacy: string | null = '{"sort":"name","showNeverDone":false}';
  read.mockImplementation(async () => legacy);
  removeLegacy.mockImplementation(async () => {
    expect(values()).toEqual(defaults); // UI publishes after the whole migration.
    expect(Storage.getItemSync(preferenceKey('account:A', 'sort'))).toBe('name');
    legacy = null;
  });
  await select('A');
  expect(legacy).toBeNull();
  removeLegacy.mockResolvedValue(undefined);
  Storage.clearSync(); __resetExerciseListPreferencesForTests();
  await select('B');
  expect(values()).toEqual(defaults);
});

it.each(['claim', 'field', 'complete'])('retries an interrupted migration at %s across a reload without replacing edits', async failure => {
  let failed = false;
  jest.spyOn(Storage, 'setItemSync').mockImplementation((key, value) => {
    const match = failure === 'claim' ? key === LEGACY_PREFERENCES_OWNER_KEY
      : failure === 'field' ? key.endsWith('.dateFormat') : key === migrationCompleteKey('account:A');
    if (match && !failed) { failed = true; throw Error('interrupted'); }
    nativeWrite(key, value);
  });
  read.mockResolvedValue('{"sort":"name","showNeverDone":false,"dateFormat":"YYYY-MM-DD"}');
  await select('A'); expect(state().error).toMatch(/loaded/);
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBeNull();
  write.mockRestore(); update({ sort: 'favourite' });
  __resetExerciseListPreferencesForTests(); await select('A');
  expect(values()).toEqual({ sort: 'favourite', showNeverDone: false,
    dateFormat: 'YYYY-MM-DD', pastRecordsGymScope: 'all' });
  expect(Storage.getItemSync(migrationCompleteKey('account:A'))).toBe('true');
  read.mockClear(); await load(); expect(read).not.toHaveBeenCalled();
});

it('rejects invalid runtime patches without storing an invalid scalar', async () => {
  await select('A');
  update({ sort: 'recent', showNeverDone: 'no' } as never);
  expect(values()).toEqual(defaults); expect(state().pending).toEqual({});
});
