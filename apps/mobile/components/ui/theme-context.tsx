import { createContext, startTransition, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { StyleSheet, type ColorSchemeName } from 'react-native';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import { launchTheme, readStoredTheme, subscribeThemeSaved } from '@/components/ui/theme-launch';
import { followsPhone, pinNativeMode, readPhoneScheme, subscribePhoneScheme } from '@/components/ui/theme-native';
import { appearanceMode, appearanceRoles, type AppearanceChoice } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// The appearance the app is drawn in while it runs: the stored choice, the
// phone's mode as last read, the mode they resolve to and its colour roles. A
// component reads the roles and the mode through `useUiRoles()`, `useUiMode()`
// or a `makeStyles` sheet, never from a module constant, so a saved choice, and
// with System a phone change, repaints it.
export type AppTheme = {
  appearance: AppearanceChoice;
  phoneScheme: ColorSchemeName | null;
  mode: ThemeMode;
  roles: UiRoles;
};

function resolveAppTheme(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): AppTheme {
  const mode = appearanceMode(appearance, phoneScheme);
  return { appearance, phoneScheme, mode, roles: appearanceRoles(appearance, mode) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// The theme a choice and a phone mode draw. Roles that resolve to the same
// colours keep the current roles object, so every cached sheet stays; a change
// that changes nothing keeps the current theme and re-renders nothing.
function withChoice(current: AppTheme, appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): AppTheme {
  const next = resolveAppTheme(appearance, phoneScheme);
  if (next.mode !== current.mode || !same(next.roles, current.roles)) return next;
  if (same(appearance, current.appearance) && phoneScheme === current.phoneScheme) return current;
  return { ...current, appearance, phoneScheme };
}

// The theme this launch is drawn in. What a component reads outside an
// `AppThemeProvider` (a test that renders it alone).
const launchAppTheme: AppTheme = resolveAppTheme(launchTheme.appearance, readPhoneScheme());

const AppThemeContext = createContext<AppTheme>(launchAppTheme);

// The stored choice, or null, logged, when the store cannot be read; the app
// then stays in the theme it is drawn in.
function readSavedAppearance(): AppearanceChoice | null {
  try {
    return readStoredTheme().appearance;
  } catch (error) {
    void logEvent({
      level: 'error',
      event: 'theme.read_failed',
      message: 'Could not read the saved appearance; the app stays in the theme it is drawn in.',
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

// The phone's mode a saved choice is drawn on. A save into System from a
// pinned mode starts from the pin, which is what the OS reports while pinned,
// and draws it until the OS reports the phone's own, rather than flicking
// through an older reading. Any other save keeps the last reading.
const phoneFor = (current: AppTheme, appearance: AppearanceChoice): ColorSchemeName | null =>
  followsPhone(appearance) && !followsPhone(current.appearance) ? current.mode : current.phoneScheme;

// Holds the theme for everything below it: the stored choice when it mounts
// (the launch theme if the store cannot be read then), then each choice saved
// while the app runs (`subscribeThemeSaved`), and with System each phone
// change. Mounted once, by the root layout.
//
// Native UI is drawn in the same mode: pinned to it, or with System unpinned so
// it follows the phone, and the phone is then followed (`theme-native.ts`).
//
// A change repaints every mounted screen that reads the theme, the stack
// behind the current one included, which costs far more than the tap that
// saved it. So the repaint is a transition: the control that saved it answers
// at once, and those screens then change theme together in one commit.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  // Read before the first pin, so at a cold start it is the phone's own mode.
  const [theme, setTheme] = useState(() =>
    withChoice(launchAppTheme, readSavedAppearance() ?? launchAppTheme.appearance, readPhoneScheme()),
  );
  useEffect(
    () =>
      subscribeThemeSaved(() => {
        const appearance = readSavedAppearance();
        if (appearance) startTransition(() => setTheme((current) => withChoice(current, appearance, phoneFor(current, appearance))));
      }),
    [],
  );
  // The mode native UI is pinned to, or null to follow the phone. Set before
  // the commit that draws the new mode paints, so both change together.
  const pin = followsPhone(theme.appearance) ? null : theme.mode;
  useLayoutEffect(() => {
    pinNativeMode(pin);
    if (pin) return undefined;
    const follow = (phoneScheme: ColorSchemeName | null) =>
      startTransition(() => setTheme((current) => withChoice(current, current.appearance, phoneScheme)));
    // Just unpinned, the OS still reports the pin it left (`phoneFor`), and
    // reports the phone's mode once it differs; read it now for the case where
    // nothing was pinned.
    follow(readPhoneScheme());
    return subscribePhoneScheme(follow);
  }, [pin]);
  return <AppThemeContext.Provider value={theme}>{children}</AppThemeContext.Provider>;
}

// The whole theme the app is drawn in now: what a module takes when it needs
// the choice itself (the launcher icon) or the phone's mode (a preview of
// System).
export function useAppTheme(): AppTheme {
  return useContext(AppThemeContext);
}

// The colour roles the app is drawn in now (`docs/specs/ui/design-language.md`
// §2). What a prop takes when it wants a colour: `placeholderTextColor`, an
// svg `fill`, an `ActivityIndicator`'s `color`.
export function useUiRoles(): UiRoles {
  return useContext(AppThemeContext).roles;
}

// The mode the app is drawn in now: what a native surface takes when it is
// told a mode rather than a colour (the date picker, the status bar).
export function useUiMode(): ThemeMode {
  return useContext(AppThemeContext).mode;
}

// A module's stylesheet drawn in the current roles. Declare it where
// `StyleSheet.create` stood, and call the hook in the component:
//
//   const useStyles = makeStyles((roles) => ({ card: { backgroundColor: roles.surface } }));
//   function Card() { const styles = useStyles(); … }
//
// Each sheet is built once per set of roles, so a theme switch builds it once
// however many components use it, and it is the same object between switches.
// What `StyleSheet.create` takes: named view, text and image styles.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<S extends NamedStyles>(build: (roles: UiRoles) => S & NamedStyles): () => Readonly<S> {
  const sheets = new WeakMap<UiRoles, Readonly<S>>();
  const sheetFor = (roles: UiRoles): Readonly<S> => {
    const cached = sheets.get(roles);
    if (cached) return cached;
    const sheet = StyleSheet.create<S>(build(roles));
    sheets.set(roles, sheet);
    return sheet;
  };
  return function useStyles(): Readonly<S> {
    return sheetFor(useUiRoles());
  };
}
