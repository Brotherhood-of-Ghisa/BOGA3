import * as SecureStore from 'expo-secure-store';
import {
  __resetExerciseListPreferencesForTests,
  ensureExerciseListPreferencesLoaded,
  getExerciseListPreferencesSnapshot,
  setExerciseListPreferences,
  subscribeToExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import { DEFAULT_EXERCISE_LIST_PREFERENCES } from '@/src/exercise-catalog/list-model';

const read = jest.spyOn(SecureStore, 'getItemAsync');
const write = jest.spyOn(SecureStore, 'setItemAsync');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  read.mockReset().mockResolvedValue(null);
  write.mockReset().mockResolvedValue();
});

it.each([true, false])('migrates legacy recents %s and ignores flat/range while retaining detail date format', async (recentsOnTop) => {
  read.mockResolvedValue(JSON.stringify({ recentsOnTop, dateRange: 7, groupByMuscleFamily: false, dateFormat: 'YYYY-MM-DD' }));
  await ensureExerciseListPreferencesLoaded();
  expect(getExerciseListPreferencesSnapshot()).toEqual({ sort: recentsOnTop ? 'favourite' : 'name', showNeverDone: true, dateFormat: 'YYYY-MM-DD' });
});

it.each([null, 'bad-json', 'null', '[]', '3', '{"sort":"recent","showNeverDone":"no"}'])('defaults malformed or absent preferences %s', async (stored) => {
  read.mockResolvedValue(stored);
  await ensureExerciseListPreferencesLoaded();
  expect(getExerciseListPreferencesSnapshot()).toEqual(DEFAULT_EXERCISE_LIST_PREFERENCES);
});

it('persists shared edits across reload and notifies subscribers', async () => {
  await ensureExerciseListPreferencesLoaded();
  const listener = jest.fn();
  const unsubscribe = subscribeToExerciseListPreferences(listener);
  setExerciseListPreferences({ sort: 'name', showNeverDone: false });
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);
  const stored = write.mock.calls.at(-1)![1];
  unsubscribe();
  __resetExerciseListPreferencesForTests();
  read.mockResolvedValue(stored);
  await ensureExerciseListPreferencesLoaded();
  expect(getExerciseListPreferencesSnapshot()).toMatchObject({ sort: 'name', showNeverDone: false });
});

it('keeps edits made during a slow initial read and preserves unrelated stored values', async () => {
  let resolve!: (value: string) => void;
  read.mockReturnValue(new Promise((done) => { resolve = done; }));
  const loading = ensureExerciseListPreferencesLoaded();
  setExerciseListPreferences({ showNeverDone: false });
  resolve(JSON.stringify({ recentsOnTop: false, dateFormat: 'MM-DD-YYYY' }));
  await loading;
  await flush();
  expect(getExerciseListPreferencesSnapshot()).toEqual({ sort: 'name', showNeverDone: false, dateFormat: 'MM-DD-YYYY' });
  expect(JSON.parse(write.mock.calls.at(-1)![1])).toEqual(getExerciseListPreferencesSnapshot());
});

it('keeps usable in-memory controls when reads and writes fail', async () => {
  read.mockRejectedValue(new Error('unavailable'));
  write.mockRejectedValue(new Error('unavailable'));
  await ensureExerciseListPreferencesLoaded();
  setExerciseListPreferences({ showNeverDone: false, sort: 'name' });
  await flush();
  expect(getExerciseListPreferencesSnapshot()).toMatchObject({ showNeverDone: false, sort: 'name' });
});

it('serializes writes so an older slow save cannot overwrite the latest selection', async () => {
  await ensureExerciseListPreferencesLoaded();
  let resolve!: () => void;
  write.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  setExerciseListPreferences({ sort: 'name' });
  await flush();
  setExerciseListPreferences({ showNeverDone: false });
  expect(write).toHaveBeenCalledTimes(1);
  resolve();
  await flush();
  expect(write).toHaveBeenCalledTimes(2);
  expect(JSON.parse(write.mock.calls[1][1])).toMatchObject({ sort: 'name', showNeverDone: false });
});
