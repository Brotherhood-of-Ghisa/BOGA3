/* eslint-disable import/first */
jest.mock('expo-alternate-app-icons', () => ({
  __esModule: true,
  supportsAlternateIcons: true,
  getAppIconName: jest.fn(),
  setAlternateAppIcon: jest.fn(),
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'active', addEventListener: jest.fn() },
}));
jest.mock('@/src/logging', () => ({ logEvent: jest.fn() }));

import { AppState, type AppStateStatus } from 'react-native';

import * as appIcons from 'expo-alternate-app-icons';
import { Storage } from 'expo-sqlite/kv-store';

import { startThemeAppIcon } from '@/components/appearance/theme-app-icon';
import { readLaunchTheme, THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import { customTheme, getThemePreset, resolveThemePreset, type ThemePresetId } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

const listeners = new Set<(state: AppStateStatus) => void>();
let stops: (() => void)[] = [];
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function changeState(state: AppStateStatus) {
  jest.replaceProperty(AppState, 'currentState', state);
  for (const listener of listeners) listener(state);
}
async function applyThemeAppIcon(preset: Parameters<typeof startThemeAppIcon>[0]) {
  stops.push(startThemeAppIcon(preset));
  await settle();
}

beforeEach(() => {
  jest.replaceProperty(AppState, 'currentState', 'active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  jest.mocked(appIcons.getAppIconName).mockReturnValue(null);
  jest.mocked(appIcons.setAlternateAppIcon).mockResolvedValue(null);
});

afterEach(async () => {
  stops.forEach((stop) => stop());
  stops = [];
  await settle();
  expect(listeners.size).toBe(0);
  Storage.removeItemSync(THEME_PRESET_STORAGE_KEY);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it.each<[ThemePresetId, string | null]>([
  ['warm', null], ['slate', 'Slate'], ['forest', 'Forest'], ['plum', 'Plum'],
])('applies %s using the native icon name', async (id, expectedName) => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('PreviousIcon');
  await applyThemeAppIcon(getThemePreset(id));
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith(expectedName);
});

it.each([0, 200, 359])('uses the Rainbow icon for custom hue %s', async (hue) => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Forest');
  await applyThemeAppIcon(customTheme(hue));
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith('Rainbow');
});

it('keeps Rainbow between custom colours and restores Warm when chosen', async () => {
  let activeIcon: string | null = 'Forest';
  jest.mocked(appIcons.getAppIconName).mockImplementation(() => activeIcon);
  jest.mocked(appIcons.setAlternateAppIcon).mockImplementation(async (name) => {
    activeIcon = name;
    return name;
  });

  await applyThemeAppIcon(customTheme(0));
  await applyThemeAppIcon(customTheme(200));
  await applyThemeAppIcon(customTheme(359));
  await applyThemeAppIcon(getThemePreset('warm'));

  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Rainbow'], [null]]);
});

it.each([null, 'neon', 'hue:400'])('uses Warm when the saved theme is absent or invalid (%s)', async (storedId) => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Plum');
  await applyThemeAppIcon(resolveThemePreset(storedId).preset);
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith(null);
});

it('uses Warm when the saved theme cannot be read', async () => {
  jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Slate');
  await applyThemeAppIcon(readLaunchTheme().preset);
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith(null);
});

it('does not ask the OS to change an icon that already matches', async () => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Forest');
  await applyThemeAppIcon(getThemePreset('forest'));
  expect(appIcons.setAlternateAppIcon).not.toHaveBeenCalled();
});

it('does nothing on platforms without alternate icons', async () => {
  jest.replaceProperty(appIcons, 'supportsAlternateIcons', false);
  await applyThemeAppIcon(getThemePreset('slate'));
  expect(appIcons.getAppIconName).not.toHaveBeenCalled();
  expect(appIcons.setAlternateAppIcon).not.toHaveBeenCalled();
});

it.each([new Error('OS refused the icon'), 'OS refused the icon'])(
  'logs a rejected icon change without rejecting boot (%s)',
  async (error) => {
    jest.mocked(appIcons.setAlternateAppIcon).mockRejectedValueOnce(error);
    await expect(applyThemeAppIcon(getThemePreset('plum'))).resolves.toBeUndefined();
    expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Plum'], [null]]);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn', event: 'theme.icon_failed',
      context: { presetId: 'plum', error: 'OS refused the icon', fallbackError: null },
    }));
  },
);

it('logs an OS icon-read failure without rejecting boot', async () => {
  jest.mocked(appIcons.getAppIconName).mockImplementationOnce(() => { throw new Error('OS unavailable'); });
  await expect(applyThemeAppIcon(getThemePreset('slate'))).resolves.toBeUndefined();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith(null);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'theme.icon_failed' }));
});

it('does not loop when the OS refuses the default icon', async () => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Slate');
  jest.mocked(appIcons.setAlternateAppIcon).mockRejectedValueOnce(new Error('OS unavailable'));
  await expect(applyThemeAppIcon(getThemePreset('warm'))).resolves.toBeUndefined();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([[null]]);
  expect(logEvent).toHaveBeenCalledTimes(1);
});

it.each([new Error('OS unavailable'), 'OS unavailable'])('logs a failed default fallback (%s)', async (cause) => {
  jest.mocked(appIcons.setAlternateAppIcon)
    .mockRejectedValueOnce(new Error('alternate icon missing'))
    .mockRejectedValueOnce(cause);
  await expect(applyThemeAppIcon(getThemePreset('slate'))).resolves.toBeUndefined();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Slate'], [null]]);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
    context: { presetId: 'slate', error: 'alternate icon missing', fallbackError: 'OS unavailable' },
  }));
});

it.each(['background', 'inactive', null] as const)('defers a launch in %s until active', async (state) => {
  jest.replaceProperty(AppState, 'currentState', state);
  await applyThemeAppIcon(getThemePreset('slate'));
  expect(appIcons.setAlternateAppIcon).not.toHaveBeenCalled();
  changeState('active');
  await settle();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith('Slate');
});

it.each([false, true])('recovers cancellation when foreground arrives before rejection: %s', async (foregroundFirst) => {
  let reject!: (error: Error) => void;
  jest.mocked(appIcons.setAlternateAppIcon).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await applyThemeAppIcon(getThemePreset('forest'));
  changeState('background');
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  if (foregroundFirst) changeState('active');
  reject(new Error('UIKit cancelled the request'));
  await settle();
  if (!foregroundFirst) {
    expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Forest']]);
    changeState('active');
    await settle();
  }
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Forest'], ['Forest']]);
  expect(logEvent).not.toHaveBeenCalled();
  changeState('inactive');
  changeState('active');
  changeState('background');
  changeState('active');
  await settle();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledTimes(2);
});

it('rechecks the icon after cancellation rather than prompting for an already applied icon', async () => {
  jest.mocked(appIcons.setAlternateAppIcon).mockImplementationOnce(async () => {
    changeState('background');
    jest.mocked(appIcons.getAppIconName).mockReturnValue('Rainbow');
    throw new Error('interrupted after applying');
  });
  await applyThemeAppIcon(customTheme(200));
  changeState('active');
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Rainbow']]);
});

it('serializes foreground events and remounts while an icon request is pending', async () => {
  let resolve!: (icon: string | null) => void;
  jest.mocked(appIcons.setAlternateAppIcon).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await applyThemeAppIcon(getThemePreset('slate'));
  stops[0]();
  await applyThemeAppIcon(getThemePreset('slate'));
  changeState('inactive');
  changeState('active');
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledTimes(1);
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Slate');
  resolve('Slate');
  await settle();
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledTimes(1);
});

it('does not retry ordinary failures on every foreground', async () => {
  jest.mocked(appIcons.setAlternateAppIcon).mockRejectedValueOnce(new Error('missing icon'));
  await applyThemeAppIcon(getThemePreset('slate'));
  changeState('background');
  changeState('active');
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Slate'], [null]]);
});

it('does not retry or fall back after recovery has stopped', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(appIcons.setAlternateAppIcon).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await applyThemeAppIcon(getThemePreset('plum'));
  stops[0]();
  reject(new Error('cancelled'));
  await settle();
  changeState('active');
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Plum']]);
  expect(logEvent).not.toHaveBeenCalled();
});

it('defers an interrupted Warm fallback and retries the launch theme after resuming', async () => {
  jest.mocked(appIcons.setAlternateAppIcon)
    .mockRejectedValueOnce(new Error('alternate icon refused'))
    .mockImplementationOnce(async () => {
      changeState('background');
      throw new Error('fallback cancelled');
    });
  await applyThemeAppIcon(getThemePreset('plum'));
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Plum'], [null]]);
  changeState('active');
  await settle();
  expect(jest.mocked(appIcons.setAlternateAppIcon).mock.calls).toEqual([['Plum'], [null], ['Plum']]);
});
