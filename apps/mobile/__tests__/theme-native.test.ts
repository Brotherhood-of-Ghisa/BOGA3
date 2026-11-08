import { Appearance, AppState, type AppStateStatus } from 'react-native';

import { followsPhone, pinNativeMode, readPhoneScheme, subscribePhoneScheme } from '@/components/ui/theme-native';
import { DEFAULT_APPEARANCE, startingCustom } from '@/components/ui/theme-presets';

// The one reader and pinner of the phone's mode (`components/ui/theme-native.ts`).
// The provider's use of it is `ui-theme-context.test.tsx`.

afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = 'active';
});

describe('followsPhone', () => {
  it('is true only for a preset in System: a custom theme takes its page’s mode', () => {
    expect(followsPhone({ ...DEFAULT_APPEARANCE, mode: 'system' })).toBe(true);
    expect(followsPhone({ ...DEFAULT_APPEARANCE, mode: 'light' })).toBe(false);
    expect(followsPhone({ ...DEFAULT_APPEARANCE, mode: 'dark' })).toBe(false);
    expect(followsPhone({ theme: 'custom', mode: 'system', custom: startingCustom(DEFAULT_APPEARANCE, 'dark') })).toBe(false);
  });
});

describe('pinNativeMode', () => {
  it('pins a mode, and unpins with null', () => {
    const pin = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    pinNativeMode('dark');
    pinNativeMode(null);
    expect(pin.mock.calls).toEqual([['dark'], ['unspecified']]);
  });

  it('does nothing where Appearance cannot pin (react-native-web)', () => {
    const original = Appearance.setColorScheme;
    (Appearance as { setColorScheme?: unknown }).setColorScheme = undefined;
    try {
      expect(() => pinNativeMode('dark')).not.toThrow();
    } finally {
      Appearance.setColorScheme = original;
    }
  });
});

describe('readPhoneScheme', () => {
  it('is what the OS reports, or null when it states none', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValueOnce('dark').mockReturnValueOnce(null);
    expect(readPhoneScheme()).toBe('dark');
    expect(readPhoneScheme()).toBeNull();
  });
});

describe('subscribePhoneScheme', () => {
  it('hears the OS while the app is active, not in the background, reads again on return, and stops', () => {
    let modes: ((preferences: { colorScheme: 'light' | 'dark' }) => void) | undefined;
    let returns: ((state: AppStateStatus) => void) | undefined;
    const removed: string[] = [];
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
      modes = listener;
      return { remove: () => removed.push('modes') } as ReturnType<typeof Appearance.addChangeListener>;
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      returns = listener;
      return { remove: () => removed.push('returns') } as ReturnType<typeof AppState.addEventListener>;
    });
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const heard: unknown[] = [];
    const stop = subscribePhoneScheme((scheme) => heard.push(scheme));

    modes!({ colorScheme: 'dark' });
    AppState.currentState = 'background';
    modes!({ colorScheme: 'light' });
    returns!('background');
    AppState.currentState = 'active';
    returns!('active');
    expect(heard).toEqual(['dark', 'dark']);

    stop();
    expect(removed.sort()).toEqual(['modes', 'returns']);
  });
});
