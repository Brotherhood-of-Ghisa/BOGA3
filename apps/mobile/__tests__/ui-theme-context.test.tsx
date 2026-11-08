/* eslint-disable import/first */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, render, screen } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { Suspense } from 'react';
import { Appearance, AppState, Text, type AppStateStatus, type ColorSchemeName } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { makeStyles, useUiMode, useUiRoles } from '@/components/ui/theme-context';
import { APPEARANCE_STORAGE_KEY, launchTheme, saveAppearance } from '@/components/ui/theme-launch';
import { appearanceRoles as rolesOn, DEFAULT_APPEARANCE, startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';
import { serialiseAppearanceRecord } from '@/components/ui/theme-record';

import { requireWithReactCompiler } from './helpers/react-compiler';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The theme the app is drawn in while it runs (`components/ui/theme-context.tsx`):
// the provider starts from the stored choice and follows every save, and a
// component reads it through `useUiRoles`, `useUiMode` or a `makeStyles` sheet.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const FOREST_LIGHT: AppearanceChoice = { theme: 'forest', mode: 'light', custom: null };

let seen: { roles: UiRoles; mode: string }[] = [];
function Probe() {
  const roles = useUiRoles();
  const mode = useUiMode();
  seen.push({ roles, mode });
  return <Text testID="probe">{`${mode} ${roles.paper}`}</Text>;
}
const latest = () => seen[seen.length - 1];

beforeEach(() => {
  seen = [];
  mockLogEvent.mockClear();
});

describe('AppThemeProvider', () => {
  it('starts from the stored choice', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    renderWithTheme(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(SLATE_DARK), mode: 'dark' });
  });

  it('re-resolves the roles and the mode on every save', async () => {
    renderWithTheme(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(DEFAULT_APPEARANCE), mode: 'light' });

    await switchTheme(SLATE_DARK);
    expect(latest()).toEqual({ roles: rolesFor(SLATE_DARK), mode: 'dark' });
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${rolesFor(SLATE_DARK).paper}`);

    await switchTheme(FOREST_LIGHT);
    expect(latest()).toEqual({ roles: rolesFor(FOREST_LIGHT), mode: 'light' });
  });

  it('keeps the same roles, and renders nothing, when a save changes nothing', async () => {
    renderWithTheme(<Probe />);
    await switchTheme(SLATE_DARK);
    const before = latest().roles;
    const renders = seen.length;

    await switchTheme(SLATE_DARK);
    expect(seen).toHaveLength(renders);
    expect(latest().roles).toBe(before);
  });

  it('keeps the same roles when a save resolves to the same colours', async () => {
    // System on a light launch draws exactly what Light draws.
    const systemOnLight: AppearanceChoice = { ...DEFAULT_APPEARANCE, mode: 'system' };
    expect(rolesFor(systemOnLight)).toEqual(rolesFor(DEFAULT_APPEARANCE));
    renderWithTheme(<Probe />);
    const before = latest().roles;

    await switchTheme(systemOnLight);
    expect(latest().roles).toBe(before);
  });

  it('starts in the launch theme, and logs, when the store cannot be read as it mounts', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    const read = jest.spyOn(Storage, 'getItemSync').mockImplementation(() => {
      throw new Error('disk gone');
    });
    try {
      renderWithTheme(<Probe />);
    } finally {
      read.mockRestore();
    }
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'theme.read_failed' }));
  });

  it('stays in the theme it is drawn in, and logs, when the saved choice cannot be read', async () => {
    renderWithTheme(<Probe />);
    const before = latest().roles;
    const read = jest.spyOn(Storage, 'getItemSync').mockImplementation(() => {
      throw new Error('disk gone');
    });
    try {
      await switchTheme(SLATE_DARK);
    } finally {
      read.mockRestore();
    }
    expect(latest().roles).toBe(before);
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'disk gone' } }),
    );
  });

  it('repaints as a transition: a screen not ready for the new theme keeps the old one, never a fallback', async () => {
    // A suspended render in an urgent update would swap the screen for its
    // fallback; in a transition React keeps the committed screen until all of
    // it can change theme in one commit.
    let ready: () => void = () => {};
    const notReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let waiting = true;
    void notReady.then(() => {
      waiting = false;
    });
    function SlowScreen() {
      const roles = useUiRoles();
      if (roles.paper === rolesFor(SLATE_DARK).paper && waiting) throw notReady;
      return <Probe />;
    }
    renderWithTheme(
      <Suspense fallback={<Text testID="fallback">loading</Text>}>
        <SlowScreen />
      </Suspense>,
    );
    const launchText = `light ${rolesFor(DEFAULT_APPEARANCE).paper}`;

    await switchTheme(SLATE_DARK);
    expect(screen.queryByTestId('fallback')).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(launchText);

    await act(async () => {
      ready();
      await notReady;
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${rolesFor(SLATE_DARK).paper}`);
  });

  it('stops following saves once unmounted', async () => {
    const { unmount } = renderWithTheme(<Probe />);
    unmount();
    const renders = seen.length;
    await saveAppearance(SLATE_DARK);
    expect(seen).toHaveLength(renders);
  });

  it('leaves a component outside any provider in the launch theme', async () => {
    render(<Probe />);
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
    await switchTheme(SLATE_DARK);
    expect(latest()).toEqual({ roles: rolesFor(launchTheme.appearance), mode: 'light' });
  });
});

// Native UI is drawn in the app's mode: pinned to it, or with System unpinned
// and the phone followed (`components/ui/theme-native.ts`). The phone is a
// fake: the mode it reports and the change events the OS would send.
describe('native UI and the phone', () => {
  // The fake OS, as React Native's Appearance behaves: `getColorScheme` returns
  // what the OS last reported, which while native UI is pinned is the pin.
  // Pinning reports the pin when it differs; unpinning reports the phone's own
  // mode, a moment later, only when it differs from the pin just lifted.
  let phone: ColorSchemeName;
  let reported: ColorSchemeName | null;
  let pinned: ColorSchemeName | null;
  let listeners: Set<(preferences: { colorScheme: ColorSchemeName | null }) => void>;
  let pin: jest.SpyInstance;
  const report = (scheme: ColorSchemeName) => {
    if (reported === scheme) return;
    reported = scheme;
    listeners.forEach((listener) => listener({ colorScheme: scheme }));
  };

  beforeEach(() => {
    phone = 'light';
    reported = null;
    pinned = null;
    listeners = new Set();
    jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => reported ?? phone);
    pin = jest.spyOn(Appearance, 'setColorScheme').mockImplementation((scheme) => {
      reported ??= phone;
      if (scheme === 'light' || scheme === 'dark') {
        pinned = scheme;
        queueMicrotask(() => report(scheme));
      } else {
        pinned = null;
        queueMicrotask(() => report(phone));
      }
    });
    jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) } as ReturnType<typeof Appearance.addChangeListener>;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  // The phone switches mode; the OS reports it only while native UI is unpinned.
  const phoneSwitches = async (scheme: ColorSchemeName) => {
    phone = scheme;
    await act(async () => {
      if (!pinned) report(scheme);
    });
  };
  // The modes the app drew from `from` on, each change once.
  const drawnModes = (from: number) =>
    seen.slice(from).map((render) => render.mode).filter((mode, index, modes) => index === 0 || mode !== modes[index - 1]);
  const SLATE_SYSTEM: AppearanceChoice = { ...SLATE_DARK, mode: 'system' };

  it('pins native UI to the stored mode as it mounts, whatever the phone', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    renderWithTheme(<Probe />);
    expect(pin.mock.calls).toEqual([['dark']]);
    expect(listeners.size).toBe(0);
  });

  it('re-pins native UI to the mode of each save, and pins nothing for a save that keeps the mode', async () => {
    renderWithTheme(<Probe />);
    await switchTheme(SLATE_DARK);
    await switchTheme(FOREST_LIGHT);
    await switchTheme({ ...FOREST_LIGHT, theme: 'plum' });
    expect(pin.mock.calls).toEqual([['light'], ['dark'], ['light']]);
  });

  it('pins a custom theme to its page’s mode, whatever its stored mode and the phone', async () => {
    renderWithTheme(<Probe />);
    const darkPage: AppearanceChoice = { theme: 'custom', mode: 'system', custom: startingCustom(SLATE_DARK, 'dark') };
    await switchTheme(darkPage);
    expect(latest().mode).toBe('dark');
    expect(pin).toHaveBeenLastCalledWith('dark');
    await phoneSwitches('light');
    expect(latest().mode).toBe('dark');
  });

  it('unpins native UI for System and repaints when the phone changes mode', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_SYSTEM));
    renderWithTheme(<Probe />);
    expect(pin.mock.calls).toEqual([['unspecified']]);
    expect(latest()).toEqual({ roles: rolesOn(SLATE_SYSTEM, 'light'), mode: 'light' });

    await phoneSwitches('dark');
    expect(latest()).toEqual({ roles: rolesOn(SLATE_SYSTEM, 'dark'), mode: 'dark' });
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${rolesOn(SLATE_SYSTEM, 'dark').paper}`);

    await phoneSwitches('light');
    expect(latest().mode).toBe('light');
    // The mode changed but the choice did not: native UI stays unpinned.
    expect(pin.mock.calls).toEqual([['unspecified']]);
  });

  it('switches from a pinned Dark into System on a light phone in one repaint, when the OS reports the phone', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    renderWithTheme(<Probe />);
    await act(async () => {});
    expect(latest().mode).toBe('dark');
    const before = seen.length;

    await switchTheme(SLATE_SYSTEM);

    expect(pin).toHaveBeenLastCalledWith('unspecified');
    expect(drawnModes(before)).toEqual(['dark', 'light']);
  });

  it('stays in a pinned Dark switched into System when the phone turned dark while pinned, with no OS report', async () => {
    // Cold start on a light phone, Dark stored and pinned; then the phone goes
    // dark, unseen behind the pin.
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_DARK));
    renderWithTheme(<Probe />);
    await phoneSwitches('dark');
    const before = seen.length;

    await switchTheme(SLATE_SYSTEM);

    expect(drawnModes(before)).toEqual(['dark']);
    expect(latest()).toEqual({ roles: rolesOn(SLATE_SYSTEM, 'dark'), mode: 'dark' });
  });

  it('stops following the phone once a fixed mode is saved, and draws System in the phone’s last mode', async () => {
    phone = 'dark';
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_SYSTEM));
    renderWithTheme(<Probe />);
    expect(latest().mode).toBe('dark');

    await switchTheme({ ...SLATE_SYSTEM, mode: 'light' });
    expect(pin).toHaveBeenLastCalledWith('light');
    expect(listeners.size).toBe(0);
    await phoneSwitches('light');
    await phoneSwitches('dark');
    expect(latest().mode).toBe('light');
  });

  it('switches from a pinned Light into System on a dark phone without drawing the stale reading', async () => {
    // Cold start: the phone is dark, Light is stored; the read before the pin saw dark.
    phone = 'dark';
    renderWithTheme(<Probe />);
    await act(async () => {});
    expect(latest().mode).toBe('light');
    const before = seen.length;

    await switchTheme({ ...DEFAULT_APPEARANCE, mode: 'system' });

    expect(drawnModes(before)).toEqual(['light', 'dark']);
  });

  it('ignores the mode flips iOS makes in the background, and reads the phone on return', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_SYSTEM));
    const returns = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      returns.add(listener);
      return { remove: () => returns.delete(listener) } as ReturnType<typeof AppState.addEventListener>;
    });
    renderWithTheme(<Probe />);
    expect(latest().mode).toBe('light');

    AppState.currentState = 'background';
    await phoneSwitches('dark');
    await phoneSwitches('light');
    expect(seen.every((render) => render.mode === 'light')).toBe(true);

    // The phone went dark while the app was away; the report came unheard.
    await phoneSwitches('dark');
    expect(latest().mode).toBe('light');
    AppState.currentState = 'active';
    await act(async () => returns.forEach((listener) => listener('active')));
    expect(latest().mode).toBe('dark');
  });

  it('stops following the phone once unmounted', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(SLATE_SYSTEM));
    const { unmount } = renderWithTheme(<Probe />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

describe('makeStyles', () => {
  // A fresh sheet declaration per test: sheets are cached per set of roles for
  // as long as the module lives.
  function declare() {
    const build = jest.fn((roles: UiRoles) => ({ card: { backgroundColor: roles.surface } }));
    const useStyles = makeStyles(build);
    const sheets: object[] = [];
    function Card({ testID }: { testID: string }) {
      const styles = useStyles();
      sheets.push(styles);
      return <Text style={styles.card} testID={testID}>card</Text>;
    }
    return { build, sheets, Card };
  }

  it('builds one sheet per set of roles, shared by every component, and a new one after a switch', async () => {
    const { build, sheets, Card } = declare();
    renderWithTheme(
      <>
        <Card testID="first" />
        <Card testID="second" />
      </>,
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(sheets[0]).toBe(sheets[1]);
    const launchSheet = sheets[0];

    await switchTheme(SLATE_DARK);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenLastCalledWith(rolesFor(SLATE_DARK));
    const [first, second] = sheets.slice(-2);
    expect(first).toBe(second);
    expect(first).not.toBe(launchSheet);
    expect(screen.getByTestId('first')).toHaveStyle({ backgroundColor: rolesFor(SLATE_DARK).surface });
  });

  it('returns the same sheet across re-renders and remounts while the roles hold', () => {
    const { build, sheets, Card } = declare();
    const { rerender, unmount } = renderWithTheme(<Card testID="first" />);
    rerender(<Card testID="first" />);
    unmount();
    renderWithTheme(<Card testID="first" />);
    expect(sheets).toHaveLength(3);
    expect(new Set(sheets).size).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('a component drawn through the theme, compiled as the device runs it', () => {
  // Through the React Compiler, a read of a module value during render could be
  // cached and never repaint; the hooks must not be.
  const { ThemedCard } = requireWithReactCompiler<typeof import('./fixtures/themed-card')>(
    '__tests__/fixtures/themed-card.tsx',
  );

  it('repaints its sheet, its colour props and its mode on a switch', async () => {
    renderWithTheme(<ThemedCard title="Bench" />);
    const launch = rolesFor(DEFAULT_APPEARANCE);
    expect(screen.getByTestId('themed-card')).toHaveStyle({ backgroundColor: launch.surface, borderColor: launch.rule });
    expect(screen.getByTestId('themed-card-title')).toHaveStyle({ color: launch.ink });
    expect(screen.getByTestId('themed-card-spinner').props.color).toBe(launch.accent);

    await switchTheme(SLATE_DARK);
    const slate = rolesFor(SLATE_DARK);
    expect(slate.surface).not.toBe(launch.surface);
    expect(screen.getByTestId('themed-card')).toHaveStyle({ backgroundColor: slate.surface, borderColor: slate.rule });
    expect(screen.getByTestId('themed-card-title')).toHaveStyle({ color: slate.ink });
    expect(screen.getByTestId('themed-card-spinner').props.color).toBe(slate.accent);
    expect(screen.getByTestId('themed-card-spinner').props.accessibilityHint).toBe('dark');
  });
});
