/* eslint-disable import/first */
jest.mock('expo-alternate-app-icons', () => ({
  __esModule: true,
  supportsAlternateIcons: true,
  getAppIconName: jest.fn(),
  setAlternateAppIcon: jest.fn(),
}));
jest.mock('@/src/logging', () => ({ logEvent: jest.fn() }));

import * as appIcons from 'expo-alternate-app-icons';
import { Storage } from 'expo-sqlite/kv-store';

import { applyThemeAppIcon } from '@/components/appearance/theme-app-icon';
import { readLaunchTheme } from '@/components/ui/theme-launch';
import { customTheme, getThemePreset, resolveThemePreset, type ThemePresetId } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

beforeEach(() => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue(null);
  jest.mocked(appIcons.setAlternateAppIcon).mockResolvedValue(null);
});

afterEach(() => {
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

it.each([0, 200, 359])('uses the default Warm icon for custom hue %s', async (hue) => {
  jest.mocked(appIcons.getAppIconName).mockReturnValue('Forest');
  await applyThemeAppIcon(customTheme(hue));
  expect(appIcons.setAlternateAppIcon).toHaveBeenCalledWith(null);
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
