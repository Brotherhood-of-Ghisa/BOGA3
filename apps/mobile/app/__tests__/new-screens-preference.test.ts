/* eslint-disable import/first */

// `mock`-prefixed so the hoisted jest factory may reference them.
const mockKeychain = new Map<string, string>();
const mockGetItemAsync = jest.fn(async (key: string) => mockKeychain.get(key) ?? null);
const mockSetItemAsync = jest.fn(async (key: string, value: string) => {
  mockKeychain.set(key, value);
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => mockGetItemAsync(key),
  setItemAsync: (key: string, value: string) => mockSetItemAsync(key, value),
}));

import {
  __resetNewScreensPreferenceForTests,
  DEFAULT_NEW_SCREENS_ENABLED,
  ensureNewScreensEnabledLoaded,
  getNewScreensEnabledSnapshot,
  setNewScreensEnabled,
  subscribeToNewScreensEnabled,
} from '@/src/session-recorder/new-screens-preference';

const STORAGE_KEY = 'boga3.newExerciseSessionScreens.v1';
const originalNodeEnv = process.env.NODE_ENV;

// The module uses an in-memory store under NODE_ENV=test; switch it to the
// SecureStore path so these tests cover the device read/write and a real reload.
const useDeviceStore = () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
};

describe('new exercise/session screens preference', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockGetItemAsync.mockClear();
    mockSetItemAsync.mockClear();
    __resetNewScreensPreferenceForTests();
    useDeviceStore();
  });

  afterAll(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it('defaults off, before and after loading an empty store', async () => {
    expect(DEFAULT_NEW_SCREENS_ENABLED).toBe(false);
    expect(getNewScreensEnabledSnapshot()).toBe(false);

    await ensureNewScreensEnabledLoaded();

    expect(mockGetItemAsync).toHaveBeenCalledWith(STORAGE_KEY);
    expect(getNewScreensEnabledSnapshot()).toBe(false);
  });

  it('persists under the versioned key and reads it back after a reload', async () => {
    await setNewScreensEnabled(true);

    expect(mockSetItemAsync).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify({ enabled: true }));

    // A fresh process: module state gone, the device keychain kept.
    __resetNewScreensPreferenceForTests();
    expect(getNewScreensEnabledSnapshot()).toBe(false);
    await ensureNewScreensEnabledLoaded();
    expect(getNewScreensEnabledSnapshot()).toBe(true);

    await setNewScreensEnabled(false);
    __resetNewScreensPreferenceForTests();
    await ensureNewScreensEnabledLoaded();
    expect(getNewScreensEnabledSnapshot()).toBe(false);
  });

  it('loads the store once', async () => {
    mockKeychain.set(STORAGE_KEY, JSON.stringify({ enabled: true }));

    await Promise.all([ensureNewScreensEnabledLoaded(), ensureNewScreensEnabledLoaded()]);
    await ensureNewScreensEnabledLoaded();

    expect(mockGetItemAsync).toHaveBeenCalledTimes(1);
    expect(getNewScreensEnabledSnapshot()).toBe(true);
  });

  it('notifies subscribers on load and on set, and stops after unsubscribe', async () => {
    mockKeychain.set(STORAGE_KEY, JSON.stringify({ enabled: true }));
    const listener = jest.fn();
    const unsubscribe = subscribeToNewScreensEnabled(listener);

    await ensureNewScreensEnabledLoaded();
    expect(listener).toHaveBeenCalledTimes(1);

    await setNewScreensEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getNewScreensEnabledSnapshot()).toBe(false);

    unsubscribe();
    await setNewScreensEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['not JSON', '{enabled: true'],
    ['a non-boolean flag', JSON.stringify({ enabled: 'yes' })],
    ['a missing flag', JSON.stringify({})],
    ['JSON null', 'null'],
    ['a bare boolean', 'true'],
  ])('falls back to the default when the stored value is %s', async (_label, stored) => {
    mockKeychain.set(STORAGE_KEY, stored);

    await ensureNewScreensEnabledLoaded();

    expect(getNewScreensEnabledSnapshot()).toBe(DEFAULT_NEW_SCREENS_ENABLED);
  });

  it('falls back to the default when the device store cannot be read', async () => {
    mockGetItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    await ensureNewScreensEnabledLoaded();

    expect(getNewScreensEnabledSnapshot()).toBe(false);
  });

  it('keeps the chosen value in memory when the device store cannot be written', async () => {
    mockSetItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(setNewScreensEnabled(true)).resolves.toBeUndefined();

    expect(getNewScreensEnabledSnapshot()).toBe(true);
  });

  it('keeps an explicit choice made while the stored value is still loading', async () => {
    mockKeychain.set(STORAGE_KEY, JSON.stringify({ enabled: false }));

    const loading = ensureNewScreensEnabledLoaded();
    await setNewScreensEnabled(true);
    await loading;

    expect(getNewScreensEnabledSnapshot()).toBe(true);
  });

  it('test reset restores the default and drops listeners', async () => {
    const listener = jest.fn();
    subscribeToNewScreensEnabled(listener);
    await setNewScreensEnabled(true);
    listener.mockClear();

    __resetNewScreensPreferenceForTests();
    await setNewScreensEnabled(true);

    expect(listener).not.toHaveBeenCalled();
    __resetNewScreensPreferenceForTests();
    expect(getNewScreensEnabledSnapshot()).toBe(false);
  });

  it('uses only the in-memory store under the test runtime', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';

    await setNewScreensEnabled(true);
    await ensureNewScreensEnabledLoaded();

    expect(mockSetItemAsync).not.toHaveBeenCalled();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(getNewScreensEnabledSnapshot()).toBe(true);
  });
});
