/* eslint-disable import/first */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { Storage } from 'expo-sqlite/kv-store';
import { Appearance } from 'react-native';

import { customFromSeeds, type CustomColours } from '@/components/ui/theme-custom';
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  readIntendedTheme,
  readLaunchTheme,
  readStoredTheme,
  saveAppearance,
  saveAppearancePart,
  THEME_PRESET_STORAGE_KEY,
} from '@/components/ui/theme-launch';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { withNeutrals } from '@/components/ui/theme-neutrals';
import {
  appearanceMode,
  CUSTOM_THEME,
  DEFAULT_APPEARANCE,
  defaultTheme,
  getThemePreset,
  resolveAppearance,
  resolveMode,
  resolveThemePreset,
  type AppearanceChoice,
} from '@/components/ui/theme-presets';
import {
  parseAppearanceRecord,
  parseLegacyAppearanceRecord,
  serialiseAppearanceRecord,
} from '@/components/ui/theme-record';
import { reportLaunchThemeProblem } from '@/src/appearance/launch-theme-report';

// The chosen appearance (`docs/specs/ui/design-language.md` §2, "Choosing
// one"): a record stored per device, read when the theme provider first
// loads and after each save. Two older values are read while no record exists: the record
// before custom themes, converted, and before it an accent id alone. An
// unusable value or an unreadable store falls back to the default, and the
// root layout logs why.

const WARM = getThemePreset('warm');

// Custom colours far from any preset: a dark teal page, a high-strength accent.
const CUSTOM: CustomColours = {
  background: { hue: 200, strength: 30, lightness: 20, depth: 150 },
  ink: { hue: 265, strength: 30 },
  text: { hue: 60, strength: 10 },
  accent: { hue: 330, strength: 80 },
  record: { hue: 90, strength: 60 },
  viz: { hue: 150, strength: 50 },
};
const CHOSEN: AppearanceChoice = { theme: 'custom', mode: 'light', custom: CUSTOM };

const preset = (theme: AppearanceChoice['theme']): AppearanceChoice => ({ ...DEFAULT_APPEARANCE, theme });
const storedRecord = (): unknown => JSON.parse(Storage.getItemSync(APPEARANCE_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  mockLogEvent.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveThemePreset: the accent id stored before any record', () => {
  it('is the default, with no problem, when nothing is stored', () => {
    expect(resolveThemePreset(null)).toEqual({ preset: WARM, appearance: DEFAULT_APPEARANCE, problem: null });
  });

  it('is the stored preset', () => {
    expect(resolveThemePreset('slate')).toEqual({ preset: getThemePreset('slate'), appearance: preset('slate'), problem: null });
  });

  it('is a custom theme of a stored hue’s colours, on a light page', () => {
    expect(resolveThemePreset('hue:200')).toEqual({
      preset: CUSTOM_THEME,
      appearance: { theme: 'custom', mode: 'light', custom: customFromSeeds(seedsFromHue(200), 'light') },
      problem: null,
    });
  });

  it('falls back to the default and reports a hue out of range', () => {
    expect(resolveThemePreset('hue:400')).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'hue:400' }));
  });

  it('falls back to the default and reports an id no preset has', () => {
    expect(resolveThemePreset('neon')).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'neon' }));
  });
});

describe('the appearance record', () => {
  it('is JSON with the three fields in a fixed order, and reads back', () => {
    const stored = serialiseAppearanceRecord(CHOSEN);
    expect(stored.startsWith('{"theme":"custom","mode":"light","custom":{"background":{"hue":200,')).toBe(true);
    expect(parseAppearanceRecord(stored)).toEqual({ appearance: CHOSEN, problem: null });
    expect(serialiseAppearanceRecord(DEFAULT_APPEARANCE)).toBe('{"theme":"warm","mode":"light","custom":null}');
  });

  it('reads every preset and mode, and keeps custom colours while a preset is chosen', () => {
    for (const theme of ['warm', 'slate', 'forest', 'plum']) {
      for (const mode of ['light', 'dark', 'system']) {
        expect(parseAppearanceRecord(JSON.stringify({ theme, mode, custom: null })).appearance).toEqual({ theme, mode, custom: null });
      }
    }
    const kept = { theme: 'slate', mode: 'dark', custom: CUSTOM } as const;
    expect(parseAppearanceRecord(JSON.stringify(kept)).appearance).toEqual(kept);
  });

  it('ignores fields it does not know', () => {
    const record = JSON.stringify({ ...DEFAULT_APPEARANCE, contrast: 'high' });
    expect(parseAppearanceRecord(record)).toEqual({ appearance: DEFAULT_APPEARANCE, problem: null });
  });

  it('reports a theme no preset has as an unknown preset', () => {
    expect(parseAppearanceRecord(JSON.stringify({ ...DEFAULT_APPEARANCE, theme: 'neon' }))).toEqual({
      appearance: null,
      problem: { kind: 'unknown-preset', storedId: 'neon' },
    });
  });

  it.each([
    ['json', 'not json'],
    ['json', '"warm"'],
    ['json', '[]'],
    ['json', 'null'],
    ['theme', '{"mode":"light","custom":null}'],
    ['theme', '{"theme":7,"mode":"light","custom":null}'],
    ['mode', '{"theme":"warm","mode":"dusk","custom":null}'],
    ['mode', '{"theme":"warm","custom":null}'],
    ['custom', '{"theme":"custom","mode":"light","custom":null}'],
    ['custom', '{"theme":"warm","mode":"light"}'],
    ['custom', '{"theme":"warm","mode":"light","custom":{"text":{"hue":1,"strength":1}}}'],
  ])('reports a record with a bad %s field: %s', (field, stored) => {
    expect(parseAppearanceRecord(stored)).toEqual({ appearance: null, problem: { kind: 'invalid-record', field, stored } });
  });
});

describe('the record before custom themes', () => {
  const legacy = (fields: Record<string, unknown>) =>
    JSON.stringify({ accent: 'warm', background: 'match', text: 'match', mode: 'light', ...fields });

  it('reads a preset left to match as that preset, keeping its mode', () => {
    expect(parseLegacyAppearanceRecord(legacy({ accent: 'plum', mode: 'system' }))).toEqual({
      appearance: { theme: 'plum', mode: 'system', custom: null },
      problem: null,
    });
  });

  it.each([
    ['a swatch and an ink', { accent: 'plum', background: 'sage', text: 'espresso' }, withNeutrals(getThemePreset('plum').seeds, 'sage', 'espresso'), 'light'],
    ['a custom hue and background', { accent: 'hue:120', background: { hue: 30, tint: 1 }, text: 'navy' }, withNeutrals(seedsFromHue(120), { hue: 30, tint: 1 }, 'navy'), 'light'],
    ['a custom hue left to match', { accent: 'hue:47' }, seedsFromHue(47), 'light'],
    ['a tinted dark theme', { background: 'cool', mode: 'dark' }, withNeutrals(WARM.seeds, 'cool', 'match'), 'dark'],
    ['a tinted system theme on a light OS', { background: 'cool', mode: 'system' }, withNeutrals(WARM.seeds, 'cool', 'match'), 'light'],
  ] as const)('converts %s into the custom theme it drew', (_name, fields, seeds, ladder) => {
    const { appearance } = parseLegacyAppearanceRecord(legacy(fields), 'light');
    expect(appearance).toEqual({ theme: 'custom', mode: (fields as { mode?: string }).mode ?? 'light', custom: customFromSeeds(seeds, ladder) });
  });

  it('draws a tinted system theme on the page of the OS’s mode as read', () => {
    const { appearance } = parseLegacyAppearanceRecord(legacy({ background: 'cool', mode: 'system' }), 'dark');
    expect(appearance).toEqual({ theme: 'custom', mode: 'system', custom: customFromSeeds(withNeutrals(WARM.seeds, 'cool', 'match'), 'dark') });
    expect(parseLegacyAppearanceRecord(legacy({ background: 'cool', mode: 'system' })).appearance?.custom?.background.lightness).toBe(96);
  });

  it('reports an accent no preset has as an unknown preset', () => {
    expect(parseLegacyAppearanceRecord(legacy({ accent: 'neon' })).problem).toEqual({ kind: 'unknown-preset', storedId: 'neon' });
  });

  it.each([
    ['json', 'not json'],
    ['accent', '{"background":"match","text":"match","mode":"light"}'],
    ['background', legacy({ background: 'neon' })],
    ['background', legacy({ background: { hue: 360, tint: 1 } })],
    ['background', legacy({ background: { hue: 20, tint: 4 } })],
    ['text', legacy({ text: 'teal' })],
    ['mode', legacy({ mode: 'dusk' })],
  ])('reports a bad %s field: %s', (field, stored) => {
    expect(parseLegacyAppearanceRecord(stored)).toEqual({ appearance: null, problem: { kind: 'invalid-record', field, stored } });
  });
});

describe('the launch theme', () => {
  it('opens in the default, with no problem, when nothing is stored', () => {
    expect(readLaunchTheme()).toEqual(defaultTheme(null));
  });

  it.each([
    ['a preset', 'forest', resolveAppearance(preset('forest'))],
    ['an unknown id, reported', 'neon', defaultTheme({ kind: 'unknown-preset', storedId: 'neon' })],
  ])('reads %s stored before any record existed', (_name, storedId, expected) => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, storedId);
    expect(readLaunchTheme()).toEqual(expected);
  });

  it('reads a valid record', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(CHOSEN));
    expect(readLaunchTheme()).toEqual({ preset: CUSTOM_THEME, appearance: CHOSEN, problem: null });
  });

  it('prefers the record to the older record, and the older record to the accent id', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'forest');
    Storage.setItemSync(LEGACY_APPEARANCE_STORAGE_KEY, '{"accent":"plum","background":"match","text":"match","mode":"light"}');
    expect(readLaunchTheme().preset.id).toBe('plum');
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(preset('slate')));
    expect(readLaunchTheme().preset.id).toBe('slate');
  });

  it('opens in the default, reported, for an invalid record — even with an older value stored', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'forest');
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"theme":"plum"');
    expect(readLaunchTheme()).toEqual(defaultTheme({ kind: 'invalid-record', field: 'json', stored: '{"theme":"plum"' }));
  });

  it('converts an older system record on the OS’s mode at launch', () => {
    Storage.setItemSync(LEGACY_APPEARANCE_STORAGE_KEY, '{"accent":"hue:200","background":"match","text":"match","mode":"system"}');
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    expect(readLaunchTheme().appearance.custom?.background.lightness).toBe(10);
  });

  it('opens in the default, reported, for an invalid older record', () => {
    Storage.setItemSync(LEGACY_APPEARANCE_STORAGE_KEY, '{"accent":"neon"}');
    expect(readLaunchTheme()).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'neon' }));
  });

  it('falls back to the default and reports why when the store cannot be read', () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    expect(readLaunchTheme()).toEqual(defaultTheme({ kind: 'read-failed', message: 'database is locked' }));
  });

  it('opens in the preset stored before any record existed', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
    expect(launchWith('light').launch.launchTheme.appearance).toEqual(preset('plum'));
  });

  it('opens in the custom colours of the record, in the mode its page sets', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(CHOSEN));
    const { launchTheme } = launchWith('light').launch;
    expect(launchTheme.appearance).toEqual(CHOSEN);
    expect(appearanceMode(launchTheme.appearance, 'light')).toBe('dark');
  });

  it('keeps the launch theme when the choice changes while the app runs', async () => {
    let launch!: typeof import('@/components/ui/theme-launch');
    jest.isolateModules(() => {
      launch = require('@/components/ui/theme-launch');
    });
    expect(launch.launchTheme.preset.id).toBe('warm');
    await launch.saveAppearancePart({ theme: 'slate' });
    expect(launch.readStoredTheme().preset.id).toBe('slate');
    expect(launch.readLaunchTheme().preset.id).toBe('slate');
    expect(launch.launchTheme.preset.id).toBe('warm');
  });
});

// The launch theme as the app loads it afresh with the OS in `osScheme`, and
// the pins made while it loads.
function launchWith(osScheme: 'light' | 'dark' | null) {
  let result!: { launch: typeof import('@/components/ui/theme-launch'); pins: unknown[] };
  jest.isolateModules(() => {
    const { Appearance: FreshAppearance } = require('react-native') as typeof import('react-native');
    jest.spyOn(FreshAppearance, 'getColorScheme').mockReturnValue(osScheme);
    const pin = jest.spyOn(FreshAppearance, 'setColorScheme').mockImplementation(() => {});
    const launch = require('@/components/ui/theme-launch') as typeof import('@/components/ui/theme-launch');
    result = { launch, pins: pin.mock.calls.map(([scheme]) => scheme) };
  });
  return result;
}

describe('the mode a choice draws in', () => {
  it.each([
    ['light', 'light', 'light'],
    ['light', 'dark', 'light'],
    ['light', null, 'light'],
    ['dark', 'light', 'dark'],
    ['dark', 'dark', 'dark'],
    ['dark', null, 'dark'],
    ['system', 'light', 'light'],
    ['system', 'dark', 'dark'],
    ['system', null, 'light'],
  ] as const)('resolves a stored %s on a phone in %s to %s', (mode, osScheme, expected) => {
    expect(resolveMode(mode, osScheme)).toBe(expected);
  });

  it.each([
    [20, 'dark'],
    [49, 'dark'],
    [50, 'light'],
    [96, 'light'],
  ] as const)('draws a custom page of %s in %s, whatever the stored mode and the phone', (lightness, expected) => {
    const custom = { ...CUSTOM, background: { ...CUSTOM.background, lightness } };
    for (const osScheme of ['light', 'dark', null] as const) {
      expect(appearanceMode({ theme: 'custom', mode: 'system', custom }, osScheme)).toBe(expected);
    }
  });

  it('is not pinned by loading the stored choice: the theme provider pins it (`theme-context.tsx`)', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, theme: 'slate', mode: 'dark' }));
    const { launch, pins } = launchWith('light');
    expect(launch.launchTheme.appearance.mode).toBe('dark');
    expect(pins).toEqual([]);
  });

  it('keeps the launch theme, and pins nothing, when the choice is saved while the app runs', async () => {
    const { launch, pins } = launchWith('dark');
    await launch.saveAppearancePart({ mode: 'dark' });
    expect(launch.readStoredTheme().appearance.mode).toBe('dark');
    expect(launch.launchTheme.appearance.mode).toBe('light');
    expect(pins).toEqual([]);
  });
});

describe('saving', () => {
  it('writes the whole choice as the record', async () => {
    await saveAppearance(CHOSEN);
    expect(storedRecord()).toEqual(CHOSEN);
    expect(readStoredTheme().appearance).toEqual(CHOSEN);
  });

  it('writes a new theme into the record, keeping the rest of the choice', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...CHOSEN, mode: 'dark' }));
    await saveAppearancePart({ theme: 'forest' });
    expect(storedRecord()).toEqual({ theme: 'forest', mode: 'dark', custom: CUSTOM });
  });

  it('migrates on the first save: an older value becomes a record, and is left in place', async () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
    expect(readStoredTheme().preset.id).toBe('plum');
    await saveAppearancePart({ mode: 'dark' });
    expect(storedRecord()).toEqual({ ...preset('plum'), mode: 'dark' });
    expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('plum');
  });

  it('migrates a converted older record on the first save, leaving it in place', async () => {
    const legacy = '{"accent":"hue:47","background":"match","text":"match","mode":"light"}';
    Storage.setItemSync(LEGACY_APPEARANCE_STORAGE_KEY, legacy);
    await saveAppearancePart({ mode: 'dark' });
    expect(storedRecord()).toEqual({ theme: 'custom', mode: 'dark', custom: customFromSeeds(seedsFromHue(47), 'light') });
    expect(Storage.getItemSync(LEGACY_APPEARANCE_STORAGE_KEY)).toBe(legacy);
  });

  it('replaces an unusable record with the default\'s rest', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, 'not json');
    await saveAppearancePart({ theme: 'slate' });
    expect(storedRecord()).toEqual(preset('slate'));
  });

  it('saves nothing when the store cannot be read', async () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    await expect(saveAppearancePart({ theme: 'slate' })).rejects.toThrow('database is locked');
    expect(Storage.getItemSync(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  // The Jest fake store (jest.setup.ts) shows an async write only once it
  // settles, as the real one does, so a test cannot read a saved value before
  // the code awaiting the write has resumed.
  it('holds a saved choice only once the write settles', async () => {
    const write = saveAppearancePart({ theme: 'slate' });
    expect(readStoredTheme().preset.id).toBe('warm');
    await write;
    expect(readStoredTheme().preset.id).toBe('slate');
  });

  it('reads the saves still on their way as the intended choice, and only until they settle', async () => {
    const first = saveAppearancePart({ custom: CUSTOM });
    const second = saveAppearancePart({ mode: 'dark' });
    expect(readStoredTheme().appearance).toEqual(DEFAULT_APPEARANCE);
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, custom: CUSTOM, mode: 'dark' });
    await Promise.all([first, second]);
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, custom: CUSTOM, mode: 'dark' });
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, custom: CUSTOM, mode: 'dark' });
  });

  it('forgets a field whose save failed, even while a later save for another field waits', async () => {
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const failed = saveAppearancePart({ custom: CUSTOM });
    const later = saveAppearancePart({ mode: 'dark' });
    await expect(failed).rejects.toThrow('disk full');
    // The later save has not settled: its field still counts, the failed one does not.
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark' });
    await later;
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark' });
  });

  it('keeps a field queued by a newer save when an older save of it settles', async () => {
    const older = saveAppearancePart({ theme: 'plum' });
    const newer = saveAppearancePart({ theme: 'forest' });
    await older;
    expect(readIntendedTheme().theme).toBe('forest');
    await newer;
    expect(readStoredTheme().appearance.theme).toBe('forest');
    expect(readIntendedTheme().theme).toBe('forest');
  });

  it('orders an async read after a write still settling', async () => {
    const write = Storage.setItem(APPEARANCE_STORAGE_KEY, 'x');
    await expect(Storage.getItem(APPEARANCE_STORAGE_KEY)).resolves.toBe('x');
    await write;
  });
});

describe('reportLaunchThemeProblem', () => {
  it('logs nothing when the stored choice was used', () => {
    reportLaunchThemeProblem(null);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it('warns about an unknown preset, naming it', () => {
    reportLaunchThemeProblem({ kind: 'unknown-preset', storedId: 'neon' });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', event: 'theme.unknown_preset', context: { storedId: 'neon' } }),
    );
  });

  it('warns about an invalid record, naming the field and quoting what is stored', () => {
    reportLaunchThemeProblem({ kind: 'invalid-record', field: 'text', stored: '{"text":"teal"}' });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'theme.invalid_record',
        context: { field: 'text', stored: '{"text":"teal"}' },
      }),
    );
  });

  it('quotes at most 200 characters of a corrupted record', () => {
    reportLaunchThemeProblem({ kind: 'invalid-record', field: 'json', stored: 'x'.repeat(5000) });
    expect(mockLogEvent.mock.calls[0][0].context.stored).toHaveLength(200);
  });

  it('logs an unreadable store as an error', () => {
    reportLaunchThemeProblem({ kind: 'read-failed', message: 'database is locked' });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'database is locked' } }),
    );
  });
});
