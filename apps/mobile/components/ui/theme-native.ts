import { Appearance, AppState, type ColorSchemeName } from 'react-native';

import type { ThemeMode } from '@/components/ui/theme';
import { appearanceMode, type AppearanceChoice } from '@/components/ui/theme-presets';

// The one module that reads the phone's mode and sets the mode native UI
// (alerts, the keyboard, the date picker, the status bar's default) is drawn
// in. `userInterfaceStyle: "automatic"` (`app.config.ts`) is what lets a read
// see a dark phone at all.
//
// While pinned to a mode, the OS reports the pin rather than the phone, so the
// phone is read, and followed, only while unpinned: a choice that follows the
// phone (System) unpins, every other choice pins.

// Whether a choice's mode is the phone's: a preset in System. A custom theme's
// mode is its page's, whatever the stored mode.
export function followsPhone(appearance: AppearanceChoice): boolean {
  return appearanceMode(appearance, 'light') !== appearanceMode(appearance, 'dark');
}

// The phone's mode, or null when the OS states none. Pinned, it is the pin.
export function readPhoneScheme(): ColorSchemeName | null {
  return Appearance.getColorScheme() ?? null;
}

// Pins native UI to `mode`, or with null unpins it so native UI and the read
// follow the phone. react-native-web's Appearance cannot pin; the web build has
// no native UI to pin.
export function pinNativeMode(mode: ThemeMode | null): void {
  Appearance.setColorScheme?.(mode ?? 'unspecified');
}

// Calls `listener` with the phone's mode each time the OS reports a change
// while the app is active, and again on each return to it. In the background
// iOS flips the mode to snapshot the app in both, which is no change of the
// phone's.
export function subscribePhoneScheme(listener: (scheme: ColorSchemeName | null) => void): () => void {
  const modes = Appearance.addChangeListener(({ colorScheme }) => {
    if (AppState.currentState === 'active') listener(colorScheme ?? null);
  });
  const returns = AppState.addEventListener('change', (state) => {
    if (state === 'active') listener(readPhoneScheme());
  });
  return () => {
    modes.remove();
    returns.remove();
  };
}
