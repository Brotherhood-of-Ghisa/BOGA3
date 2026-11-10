/* eslint-disable import/first */

/**
 * Settings → Appearance (`docs/specs/ui/design-language.md` "Presets"): the
 * theme presets and Custom as radio rows on a page, a choice saved per device
 * at once and drawn by the app at once, Mode for a preset, the custom
 * colours' rows that open their pickers, the preview below them, the header's
 * indicator while a choice is being drawn, and the failures that must be
 * logged rather than silent. Settings home's row names the choice and pushes the page.
 *
 * The choice lives in expo-sqlite's key-value store, faked in memory for every
 * suite by jest.setup.ts and read back here. Replaced: the router, the auth
 * hook, the bodyweight row and the sync-status panel (their own specs), and the
 * log sink, which is observed. A failed read or save is forced once with
 * `jest.spyOn`; an unusable stored choice at launch with `jest.replaceProperty`.
 */

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
// The sync-status panel has its own spec.
jest.mock('@/components/sync-status/sync-status-panel', () => ({ SyncStatusPanel: () => null }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  // The header's right control is rendered in place.
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => unknown } }) => options.headerRight?.() ?? null,
  },
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { Appearance, StyleSheet } from 'react-native';

import { appearanceRoles } from '@/components/appearance/chosen-theme';
import { generateRoles } from '@/components/ui/theme';
import { customFromSeeds, generateCustomRoles, type CustomColours } from '@/components/ui/theme-custom';
import { DEFAULT_APPEARANCE, getThemePreset } from '@/components/ui/theme-presets';
import { APPEARANCE_STORAGE_KEY, saveAppearance, THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { ensureExerciseListPreferencesLoaded } from '@/src/exercise-catalog/list-preferences';
import { waitForGone } from './helpers/wait-for-gone';
import { renderWithTheme, switchTheme } from './helpers/theme';
import SettingsAppearanceRoute from '../app/settings-appearance';
import SettingsRoute from '../app/settings';

// The theme the saved appearance record holds, or null when nothing was saved:
// a stored choice made before the record existed is read but never written.
function storedAccent(): string | null {
  return storedRecord()?.theme ?? null;
}

// The whole saved record, or null when nothing was saved.
function storedRecord(): { theme: string; mode: string; custom: CustomColours | null } | null {
  const record = Storage.getItemSync(APPEARANCE_STORAGE_KEY);
  return record === null ? null : JSON.parse(record);
}

// This suite launches in the default theme (nothing stored at import).

beforeEach(async () => {
  mockLogEvent.mockReset();
  mockPush.mockReset();
  // Settings' date-format controls load their preferences on mount; load them
  // first so the render settles inside the test.
  await ensureExerciseListPreferencesLoaded();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const radio = (name: string) => screen.getByRole('radio', { name });

it('names the theme in use on Settings home and pushes the Appearance page', () => {
  render(<SettingsRoute />);
  fireEvent.press(screen.getByLabelText('Appearance, Warm'));
  expect(mockPush).toHaveBeenCalledWith('/settings-appearance');
});

it('lists every preset as a radio row with its swatch, the current one checked', () => {
  render(<SettingsAppearanceRoute />);
  for (const id of ['warm', 'slate', 'forest', 'plum']) {
    expect(screen.getByTestId(`settings-appearance-option-${id}`)).toBeTruthy();
    // Decoration: hidden from accessibility, the label names the preset.
    expect(screen.getByTestId(`settings-appearance-swatch-${id}`, { includeHiddenElements: true })).toBeTruthy();
  }
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });
  expect(radio('Slate').props.accessibilityState).toEqual({ checked: false });
  // A choice applies at once: nothing on the page says it waits for a launch.
  expect(screen.queryByText(/next launch/i)).toBeNull();
  // The vocabulary's rows only: no button on the page.
  expect(screen.queryByRole('button', { name: /use this colour|save|apply/i })).toBeNull();
});

it('shows a preset’s detail as meta beside its swatch', () => {
  render(<SettingsAppearanceRoute />);
  expect(within(screen.getByTestId('settings-appearance-option-warm')).getByText('Default')).toHaveStyle({ fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm });
});

it('saves a choice at once, with no word that it waits for the next launch', async () => {
  render(<SettingsAppearanceRoute />);

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

  await waitFor(() => expect(storedAccent()).toBe('slate'));
  expect(radio('Slate').props.accessibilityState).toEqual({ checked: true });
  expect(screen.queryByText(/next launch/i)).toBeNull();

  fireEvent.press(screen.getByTestId('settings-appearance-option-warm'));
  await waitFor(() => expect(storedAccent()).toBe('warm'));
  expect(within(screen.getByTestId('settings-appearance-option-warm')).getByText('Default')).toBeTruthy();
});

it('draws the preview below the choices', () => {
  render(<SettingsAppearanceRoute />);
  const ids: string[] = [];
  const walk = (node: { props?: { testID?: string }; children?: unknown[] } | string) => {
    if (typeof node === 'string') return;
    if (node.props?.testID) ids.push(node.props.testID);
    (node.children ?? []).forEach((child) => walk(child as never));
  };
  walk(screen.toJSON() as never);
  const at = (id: string) => ids.indexOf(id);
  expect(at('settings-appearance-preview')).toBeGreaterThan(at('settings-appearance-mode-dark'));
  expect(at('settings-appearance-option-warm')).toBeLessThan(at('settings-appearance-mode-dark'));
});

it('shows the applying indicator from a choice until the app is drawn in it, and not after a failed save', async () => {
  let finish: () => void = () => undefined;
  jest.spyOn(Storage, 'setItem').mockImplementationOnce((key, value) => new Promise<void>((resolve) => {
    finish = () => {
      Storage.setItemSync(key, value as string);
      resolve();
    };
  }));
  renderWithTheme(<SettingsAppearanceRoute />);
  expect(screen.queryByTestId('settings-appearance-applying')).toBeNull();

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));
  expect(screen.getByRole('progressbar', { name: 'Applying the theme' })).toBeTruthy();
  // The save is queued behind earlier ones: let it reach the store first.
  await waitFor(() => expect(Storage.setItem).toHaveBeenCalled());
  expect(screen.getByRole('progressbar', { name: 'Applying the theme' })).toBeTruthy();
  await act(async () => finish());
  await waitForGone(() => screen.queryByTestId('settings-appearance-applying'));

  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  fireEvent.press(screen.getByTestId('settings-appearance-option-plum'));
  expect(await screen.findByTestId('settings-appearance-error')).toBeTruthy();
  expect(screen.queryByTestId('settings-appearance-applying')).toBeNull();
  await switchTheme(DEFAULT_APPEARANCE);
});

it('shows no applying indicator when the stored choice differs from the one drawn without a save', () => {
  // Outside a provider the app is drawn in the launch theme, the default:
  // the stored Slate differs, as an older record read on another mode would.
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"theme":"slate","mode":"dark","custom":null}');
  render(<SettingsAppearanceRoute />);
  expect(radio('Slate').props.accessibilityState).toEqual({ checked: true });
  expect(screen.queryByTestId('settings-appearance-applying')).toBeNull();
});

it('writes nothing when the choice in use is chosen again', async () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"theme":"slate","mode":"dark","custom":null}');
  const setItem = jest.spyOn(Storage, 'setItem');
  render(<SettingsAppearanceRoute />);

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));
  fireEvent.press(screen.getByTestId('settings-appearance-mode-dark'));
  await act(async () => {});

  expect(setItem).not.toHaveBeenCalled();
});

it('keeps the previous choice and says nothing changed, in a danger notice, when the save fails', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<SettingsAppearanceRoute />);

  fireEvent.press(screen.getByTestId('settings-appearance-option-forest'));

  expect(await screen.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
  expect(screen.getByTestId('settings-appearance-error').props.accessibilityRole).toBe('alert');
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });
  expect(storedAccent()).toBeNull();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'warn',
      event: 'theme.save_failed',
      context: { presetId: 'forest', error: 'disk full' },
    }),
  );
});

it('shows the theme in use, and logs why, when the store cannot be read', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
    throw new Error('database is locked');
  });
  render(<SettingsRoute />);

  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'database is locked' } }),
  );
});

it('replaces an unusable stored choice when the default is chosen again, then writes nothing more', async () => {
  // The stored id names no preset, so the app draws Warm.
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'neon');
  render(<SettingsAppearanceRoute />);
  expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });

  fireEvent.press(screen.getByTestId('settings-appearance-option-warm'));

  await waitFor(() => expect(storedAccent()).toBe('warm'));
  const setItem = jest.spyOn(Storage, 'setItem');
  fireEvent.press(screen.getByTestId('settings-appearance-option-warm'));
  await act(async () => {});
  expect(setItem).not.toHaveBeenCalled();
});

it('shows the theme the app is drawn in, not the launch one, when the store cannot be read', async () => {
  renderWithTheme(<SettingsRoute />);
  await switchTheme({ theme: 'slate', mode: 'light', custom: null });
  const read = jest.spyOn(Storage, 'getItemSync').mockImplementation(() => {
    throw new Error('database is locked');
  });
  try {
    // Another page saves; the row re-reads, and the read fails.
    await act(async () => {
      await saveAppearance({ theme: 'plum', mode: 'light', custom: null });
    });
  } finally {
    read.mockRestore();
  }
  expect(screen.getByLabelText('Appearance, Slate')).toBeTruthy();
  expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'theme.read_failed' }));
});

it('shows a choice made earlier this run, read from the store', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
  render(<SettingsRoute />);
  expect(screen.getByLabelText('Appearance, Plum')).toBeTruthy();
  expect(within(screen.getByTestId('settings-appearance-row')).getByText('Plum')).toBeTruthy();
});

it('keeps the custom colours and mode in the record when a preset is chosen', async () => {
  const custom = customFromSeeds(getThemePreset('slate').seeds, 'light');
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'plum', mode: 'dark', custom }));
  render(<SettingsAppearanceRoute />);
  expect(radio('Plum').props.accessibilityState).toEqual({ checked: true });

  fireEvent.press(screen.getByTestId('settings-appearance-option-forest'));

  await waitFor(() => expect(storedAccent()).toBe('forest'));
  expect(storedRecord()).toEqual({ theme: 'forest', mode: 'dark', custom });
});

it('updates Settings home when the Appearance page saves a choice', async () => {
  render(
    <>
      <SettingsRoute />
      <SettingsAppearanceRoute />
    </>,
  );
  expect(screen.getByLabelText('Appearance, Warm')).toBeTruthy();

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

  expect(await screen.findByLabelText('Appearance, Slate')).toBeTruthy();
});

describe('custom', () => {
  const WARM_CUSTOM = customFromSeeds(getThemePreset('warm').seeds, 'light');
  const CUSTOM: CustomColours = {
    background: { hue: 200, strength: 30, lightness: 20, depth: 150 },
    ink: { hue: 265, strength: 40 },
    text: { hue: 60, strength: 10 },
    accent: { hue: 330, strength: 80 },
    record: { hue: 90, strength: 60 },
    viz: { hue: 150, strength: 50 },
  };
  const storeCustom = (theme = 'custom') =>
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme, mode: 'light', custom: CUSTOM }));
  const previewGround = () => StyleSheet.flatten(screen.getByTestId('settings-appearance-preview', { includeHiddenElements: true }).props.style).backgroundColor;

  it('offers Custom last among the themes, unchecked, with Mode shown and no custom rows', () => {
    render(<SettingsAppearanceRoute />);
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('settings-appearance-mode')).toBeTruthy();
    expect(screen.queryByTestId('settings-appearance-custom')).toBeNull();
  });

  it('starts Custom from the preset in use, saves it at once and swaps Mode for the custom rows', async () => {
    render(<SettingsAppearanceRoute />);

    fireEvent.press(radio('Custom'));

    await waitFor(() => expect(storedRecord()).toEqual({ theme: 'custom', mode: 'light', custom: WARM_CUSTOM }));
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: true });
    expect(previewGround()).toBe(generateCustomRoles(WARM_CUSTOM).paper);
    expect(screen.queryByTestId('settings-appearance-mode')).toBeNull();
    for (const label of ['Background', 'Primary text', 'Secondary text', 'Accent', 'Best ever', 'Charts']) {
      expect(within(screen.getByTestId('settings-appearance-custom')).getByText(label)).toBeTruthy();
    }
  });

  it('goes back to the custom colours left behind', async () => {
    storeCustom('slate');
    render(<SettingsAppearanceRoute />);
    fireEvent.press(radio('Custom'));
    await waitFor(() => expect(storedRecord()).toEqual({ theme: 'custom', mode: 'light', custom: CUSTOM }));
  });

  it('names each part’s hue and strength, and the page’s lightness, and pushes its picker', () => {
    storeCustom();
    render(<SettingsAppearanceRoute />);
    const rows = screen.getByTestId('settings-appearance-custom');
    expect(within(rows).getByText('Teal, 30%, light 20')).toBeTruthy();
    expect(within(rows).getByText('Purple, 80%')).toBeTruthy();
    expect(screen.getByLabelText('Primary text, Blue, 40%')).toBeTruthy();
    expect(screen.getByLabelText('Best ever, Olive, 60%')).toBeTruthy();
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: true });

    fireEvent.press(screen.getByTestId('settings-appearance-custom-record'));

    expect(mockPush).toHaveBeenCalledWith('/theme-custom?part=record');
  });

  it('collapses Theme to Custom while it is chosen, and shows or hides the presets on request', () => {
    storeCustom();
    render(<SettingsAppearanceRoute />);
    expect(screen.queryByTestId('settings-appearance-option-warm')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Show presets' }));

    expect(screen.getByTestId('settings-appearance-option-warm')).toBeTruthy();
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: true });

    fireEvent.press(screen.getByRole('button', { name: 'Hide presets' }));

    expect(screen.queryByTestId('settings-appearance-option-warm')).toBeNull();
  });

  it('folds the presets again on a tap on Custom, writing nothing', () => {
    storeCustom();
    const setItem = jest.spyOn(Storage, 'setItem');
    render(<SettingsAppearanceRoute />);
    fireEvent.press(screen.getByRole('button', { name: 'Show presets' }));

    fireEvent.press(radio('Custom'));

    expect(screen.queryByTestId('settings-appearance-option-warm')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps the presets listed when a preset cannot be saved', async () => {
    storeCustom();
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    render(<SettingsAppearanceRoute />);
    fireEvent.press(screen.getByRole('button', { name: 'Show presets' }));

    fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

    expect(await screen.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('settings-appearance-option-slate')).toBeTruthy();
  });

  it('leaves Custom for a preset picked from the expanded list, and drops Show presets', async () => {
    storeCustom();
    render(<SettingsAppearanceRoute />);
    fireEvent.press(screen.getByTestId('settings-appearance-show-presets'));

    fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));

    await waitFor(() => expect(storedAccent()).toBe('slate'));
    expect(screen.queryByTestId('settings-appearance-show-presets')).toBeNull();
    expect(screen.getByTestId('settings-appearance-option-warm')).toBeTruthy();
  });

  it('previews a custom theme in the mode its page sets', () => {
    storeCustom();
    render(<SettingsAppearanceRoute />);
    expect(previewGround()).toBe(generateCustomRoles(CUSTOM).paper);
  });

  it('names Custom on Settings home', () => {
    storeCustom();
    render(<SettingsRoute />);
    expect(screen.getByLabelText('Appearance, Custom')).toBeTruthy();
    expect(within(screen.getByTestId('settings-appearance-row')).getByText('Custom')).toBeTruthy();
  });

  it('reads a record from before custom themes as the custom theme it drew', () => {
    Storage.setItemSync('boga3.appearance.v2', '{"accent":"hue:200","background":"rose","text":"navy","mode":"light"}');
    render(<SettingsAppearanceRoute />);
    expect(radio('Custom').props.accessibilityState).toEqual({ checked: true });
  });

  it('says nothing changed, and logs it, when Custom cannot be saved', async () => {
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    render(<SettingsAppearanceRoute />);

    fireEvent.press(radio('Custom'));

    expect(await screen.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
    expect(radio('Warm, default').props.accessibilityState).toEqual({ checked: true });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'theme.save_failed', context: { presetId: 'custom', error: 'disk full' } }),
    );
  });

  it('writes nothing when Custom is chosen again, even with a part’s save still on its way', async () => {
    storeCustom();
    const setItem = jest.spyOn(Storage, 'setItem');
    render(<SettingsAppearanceRoute />);
    fireEvent.press(radio('Custom'));
    await act(async () => {});
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('mode', () => {
  const previewGround = () => StyleSheet.flatten(screen.getByTestId('settings-appearance-preview', { includeHiddenElements: true }).props.style).backgroundColor;
  const darkPaper = generateRoles(getThemePreset('warm').seeds, 'dark').paper;
  const lightPaper = generateRoles(getThemePreset('warm').seeds, 'light').paper;

  it('offers Light, Dark and System, Light the default and checked, and says System follows the phone', () => {
    render(<SettingsAppearanceRoute />);
    expect(screen.getByRole('radio', { name: 'Light, default' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByRole('radio', { name: 'Dark' }).props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByRole('radio', { name: 'System' }).props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText('System follows the phone’s mode')).toBeTruthy();
  });

  it('saves a mode at once, keeping the rest, and repaints the preview in it', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"theme":"slate","mode":"light","custom":null}');
    render(<SettingsAppearanceRoute />);
    expect(previewGround()).toBe(appearanceRoles({ theme: 'slate', mode: 'light', custom: null }, 'light').paper);

    fireEvent.press(screen.getByTestId('settings-appearance-mode-dark'));

    expect(previewGround()).toBe(generateRoles(getThemePreset('slate').seeds, 'dark').paper);
    await waitFor(() => expect(storedRecord()).toEqual({ theme: 'slate', mode: 'dark', custom: null }));
    expect(screen.getByRole('radio', { name: 'Dark' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.queryByText(/next launch/i)).toBeNull();
  });

  it('draws the preset swatches in the mode the choice would open in', async () => {
    render(<SettingsAppearanceRoute />);
    expect(appearanceRoles({ ...DEFAULT_APPEARANCE, mode: 'dark' }, 'light').paper).toBe(darkPaper);
    expect(StyleSheet.flatten(screen.getByTestId('settings-appearance-swatch-warm', { includeHiddenElements: true }).props.style).backgroundColor).toBe(lightPaper);

    fireEvent.press(screen.getByTestId('settings-appearance-mode-dark'));
    expect(StyleSheet.flatten(screen.getByTestId('settings-appearance-swatch-warm', { includeHiddenElements: true }).props.style).backgroundColor).toBe(darkPaper);
    await waitFor(() => expect(storedRecord()?.mode).toBe('dark'));
  });

  // Native UI is not pinned in Jest: `setColorScheme` is stubbed, so the
  // phone's mode is what `getColorScheme` reports.
  const onPhone = (scheme: 'dark' | null) => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(scheme);
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  };

  it('previews System in the pinned mode, as choosing it first draws, then in the phone’s once the OS reports it', async () => {
    onPhone('dark');
    renderWithTheme(<SettingsAppearanceRoute />);
    // Pinned to Light, the OS reports light: the preview never shows a mode the app will not draw.
    fireEvent.press(screen.getByTestId('settings-appearance-mode-system'));
    expect(previewGround()).toBe(lightPaper);
    await waitFor(() => expect(storedRecord()?.mode).toBe('system'));
    // Unpinned, the phone reads dark, and preview and app follow it together.
    await waitFor(() => expect(previewGround()).toBe(darkPaper));
  });

  it('previews System light when the phone states no mode', async () => {
    onPhone(null);
    renderWithTheme(<SettingsAppearanceRoute />);
    fireEvent.press(screen.getByTestId('settings-appearance-mode-system'));
    expect(previewGround()).toBe(lightPaper);
    await waitFor(() => expect(storedRecord()?.mode).toBe('system'));
  });

  it('says nothing changed, and logs which mode failed, when a mode cannot be saved', async () => {
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    render(<SettingsAppearanceRoute />);

    fireEvent.press(screen.getByTestId('settings-appearance-mode-system'));

    expect(await screen.findByText('Couldn’t save the theme. Nothing changed.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Light, default' }).props.accessibilityState).toEqual({ checked: true });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'theme.save_failed', context: { mode: 'system', error: 'disk full' } }),
    );
  });

  it('names a mode other than light on Settings home', async () => {
    render(
      <>
        <SettingsRoute />
        <SettingsAppearanceRoute />
      </>,
    );
    fireEvent.press(screen.getByTestId('settings-appearance-mode-dark'));
    expect(await screen.findByLabelText('Appearance, Warm, Dark mode')).toBeTruthy();
    expect(within(screen.getByTestId('settings-appearance-row')).getByText('Warm, dark')).toBeTruthy();
  });
});
