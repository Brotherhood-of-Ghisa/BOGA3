import { Platform, Settings } from 'react-native';

import {
  isNotificationPromptSuppressed,
  suppressNotificationPrompt,
  SUPPRESS_NOTIFICATION_PROMPT_KEY,
} from '@/src/session-recorder/notification-prompt-suppression';
import { getAppFlavor } from '@/src/utils/app-flavor';
import { isDevMode } from '@/src/utils/isDevMode';

jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: jest.fn(() => true) }));
jest.mock('@/src/utils/app-flavor', () => ({ getAppFlavor: jest.fn(() => 'local') }));
// The real module reads the iOS SettingsManager native module, absent in Jest.
jest.mock('react-native/Libraries/Settings/Settings', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

describe('isNotificationPromptSuppressed', () => {
  const originalOs = Platform.OS;
  const settingsGet = jest.mocked(Settings.get);
  const settingsSet = jest.mocked(Settings.set);

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    jest.mocked(isDevMode).mockReturnValue(true);
    jest.mocked(getAppFlavor).mockReturnValue('local');
    settingsGet.mockReset();
    settingsSet.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  });

  it.each([true, 1])('is on for a local iOS dev client whose defaults hold %p', value => {
    settingsGet.mockReturnValue(value);
    expect(isNotificationPromptSuppressed()).toBe(true);
    expect(settingsGet).toHaveBeenCalledWith(SUPPRESS_NOTIFICATION_PROMPT_KEY);
  });

  it.each([undefined, null, false, 0, 'true', 'YES'])('is off when the key holds %p', value => {
    settingsGet.mockReturnValue(value);
    expect(isNotificationPromptSuppressed()).toBe(false);
  });

  it('ignores the key outside developer builds', () => {
    jest.mocked(isDevMode).mockReturnValue(false);
    settingsGet.mockReturnValue(true);
    expect(isNotificationPromptSuppressed()).toBe(false);
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it('ignores the key on the TestFlight dev build (preview flavor)', () => {
    jest.mocked(getAppFlavor).mockReturnValue('preview');
    settingsGet.mockReturnValue(true);
    expect(isNotificationPromptSuppressed()).toBe(false);
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it('ignores the key off iOS, where Settings does not exist', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    settingsGet.mockReturnValue(true);
    expect(isNotificationPromptSuppressed()).toBe(false);
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it('treats an unreadable Settings module as not suppressed', () => {
    settingsGet.mockImplementation(() => {
      throw new Error('Settings native module missing');
    });
    expect(isNotificationPromptSuppressed()).toBe(false);
  });

  describe('suppressNotificationPrompt', () => {
    it('persists the key in a dev iOS build', () => {
      suppressNotificationPrompt();
      expect(settingsSet).toHaveBeenCalledWith({ [SUPPRESS_NOTIFICATION_PROMPT_KEY]: true });
    });

    it('writes nothing in a release build', () => {
      jest.mocked(isDevMode).mockReturnValue(false);
      suppressNotificationPrompt();
      expect(settingsSet).not.toHaveBeenCalled();
    });

    it('writes nothing on the TestFlight dev build (preview flavor)', () => {
      jest.mocked(getAppFlavor).mockReturnValue('preview');
      suppressNotificationPrompt();
      expect(settingsSet).not.toHaveBeenCalled();
    });

    it('writes nothing off iOS', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      suppressNotificationPrompt();
      expect(settingsSet).not.toHaveBeenCalled();
    });

    it('swallows a missing Settings module', () => {
      settingsSet.mockImplementation(() => {
        throw new Error('Settings native module missing');
      });
      expect(() => suppressNotificationPrompt()).not.toThrow();
    });
  });
});
