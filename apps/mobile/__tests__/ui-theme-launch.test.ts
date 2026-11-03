/* eslint-disable import/first */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { Storage } from 'expo-sqlite/kv-store';
import { Appearance } from 'react-native';

import { generateRoles } from '@/components/ui/theme';
import {
  APPEARANCE_STORAGE_KEY,
  pinLaunchMode,
  readIntendedTheme,
  readLaunchTheme,
  readStoredTheme,
  resolveMode,
  saveAppearance,
  saveAppearancePart,
  saveThemeAccent,
  THEME_PRESET_STORAGE_KEY,
} from '@/components/ui/theme-launch';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { withNeutrals } from '@/components/ui/theme-neutrals';
import {
  customTheme,
  DEFAULT_APPEARANCE,
  defaultTheme,
  getThemePreset,
  resolveAppearance,
  resolveThemePreset,
  storedThemeId,
  type AppearanceChoice,
} from '@/components/ui/theme-presets';
import { parseAppearanceRecord, serialiseAppearanceRecord } from '@/components/ui/theme-record';
import { reportLaunchThemeProblem } from '@/src/appearance/launch-theme-report';

// The chosen appearance (`docs/specs/ui/design-language.md` §2, "Choosing
// one"): a record stored per device, resolved to seeds when `tokens.ts` first
// evaluates. Before the record existed the choice was an accent id alone; that
// value is read while no record exists. An unusable value or an unreadable
// store falls back to the default, and the root layout logs why.

const WARM = getThemePreset('warm');

// The theme an accent alone draws: background and text left to match.
const accentOnly = (accent: AppearanceChoice['accent']) => resolveAppearance({ ...DEFAULT_APPEARANCE, accent });

const storedRecord = (): unknown => JSON.parse(Storage.getItemSync(APPEARANCE_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  mockLogEvent.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveThemePreset: the accent id stored before the record', () => {
  it('is the default, with no problem, when nothing is stored', () => {
    expect(resolveThemePreset(null)).toEqual({
      preset: WARM,
      appearance: DEFAULT_APPEARANCE,
      seeds: WARM.seeds,
      problem: null,
    });
  });

  it('is the stored preset, with background and text matching it', () => {
    expect(resolveThemePreset('slate')).toEqual({
      preset: getThemePreset('slate'),
      appearance: { ...DEFAULT_APPEARANCE, accent: 'slate' },
      seeds: getThemePreset('slate').seeds,
      problem: null,
    });
  });

  it('is a custom theme for a stored hue', () => {
    expect(resolveThemePreset('hue:200')).toEqual({
      preset: { id: 'custom', label: 'Custom', hue: 200, seeds: seedsFromHue(200) },
      appearance: { ...DEFAULT_APPEARANCE, accent: 'hue:200' },
      seeds: seedsFromHue(200),
      problem: null,
    });
    expect(storedThemeId(customTheme(200))).toBe('hue:200');
    expect(storedThemeId(getThemePreset('plum'))).toBe('plum');
  });

  it('falls back to the default and reports a hue out of range', () => {
    expect(resolveThemePreset('hue:400')).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'hue:400' }));
  });

  it('falls back to the default and reports an id no preset has', () => {
    expect(resolveThemePreset('neon')).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'neon' }));
  });
});

describe('the appearance record', () => {
  const chosen: AppearanceChoice = { accent: 'hue:47', background: { hue: 200, tint: 2 }, text: 'navy', mode: 'light' };

  it('is JSON with the four fields in a fixed order, and reads back', () => {
    const stored = serialiseAppearanceRecord(chosen);
    expect(stored).toBe('{"accent":"hue:47","background":{"hue":200,"tint":2},"text":"navy","mode":"light"}');
    expect(parseAppearanceRecord(stored)).toEqual({ appearance: chosen, problem: null });
    expect(serialiseAppearanceRecord(DEFAULT_APPEARANCE)).toBe(
      '{"accent":"warm","background":"match","text":"match","mode":"light"}',
    );
  });

  it('reads every background and text a build offers, and every mode', () => {
    for (const background of ['match', 'white', 'warm', 'cool', 'sage', 'rose', { hue: 0, tint: 1 }, { hue: 359, tint: 3 }]) {
      const record = JSON.stringify({ ...DEFAULT_APPEARANCE, background });
      expect(parseAppearanceRecord(record).appearance?.background).toEqual(background);
    }
    for (const text of ['match', 'navy', 'espresso', 'forest', 'plum']) {
      expect(parseAppearanceRecord(JSON.stringify({ ...DEFAULT_APPEARANCE, text })).appearance?.text).toBe(text);
    }
    for (const mode of ['light', 'dark', 'system']) {
      expect(parseAppearanceRecord(JSON.stringify({ ...DEFAULT_APPEARANCE, mode })).appearance?.mode).toBe(mode);
    }
  });

  it('ignores fields it does not know, and normalises a custom accent', () => {
    const record = JSON.stringify({ ...DEFAULT_APPEARANCE, accent: 'hue:007', contrast: 'high' });
    expect(parseAppearanceRecord(record)).toEqual({ appearance: { ...DEFAULT_APPEARANCE, accent: 'hue:7' }, problem: null });
  });

  it('reports an accent no preset has as an unknown preset', () => {
    const record = JSON.stringify({ ...DEFAULT_APPEARANCE, accent: 'neon' });
    expect(parseAppearanceRecord(record)).toEqual({
      appearance: null,
      problem: { kind: 'unknown-preset', storedId: 'neon' },
    });
  });

  it.each([
    ['json', 'not json'],
    ['json', '"warm"'],
    ['json', '[]'],
    ['json', 'null'],
    ['accent', '{"background":"match","text":"match","mode":"light"}'],
    ['accent', '{"accent":7,"background":"match","text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","background":"neon","text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","background":{"hue":360,"tint":1},"text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","background":{"hue":20.5,"tint":1},"text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","background":{"hue":20,"tint":4},"text":"match","mode":"light"}'],
    ['background', '{"accent":"warm","background":null,"text":"match","mode":"light"}'],
    ['text', '{"accent":"warm","background":"match","text":"teal","mode":"light"}'],
    ['text', '{"accent":"warm","background":"match","text":{},"mode":"light"}'],
    ['mode', '{"accent":"warm","background":"match","text":"match","mode":"dusk"}'],
    ['mode', '{"accent":"warm","background":"match","text":"match"}'],
  ])('reports a record with a bad %s field: %s', (field, stored) => {
    expect(parseAppearanceRecord(stored)).toEqual({ appearance: null, problem: { kind: 'invalid-record', field, stored } });
  });
});

describe('the launch theme', () => {
  it('opens in the default, with no problem, when nothing is stored', () => {
    expect(readLaunchTheme()).toEqual(defaultTheme(null));
  });

  it.each([
    ['a preset', 'forest', accentOnly('forest')],
    ['a custom hue', 'hue:265', accentOnly('hue:265')],
    ['an unknown id, reported', 'neon', defaultTheme({ kind: 'unknown-preset', storedId: 'neon' })],
  ])('reads %s stored before the record existed', (_name, storedId, expected) => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, storedId);
    expect(readLaunchTheme()).toEqual(expected);
  });

  it('reads a valid record, drawing its background and text', () => {
    const appearance: AppearanceChoice = { accent: 'plum', background: 'sage', text: 'espresso', mode: 'light' };
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(appearance));
    expect(readLaunchTheme()).toEqual({
      preset: getThemePreset('plum'),
      appearance,
      seeds: withNeutrals(getThemePreset('plum').seeds, 'sage', 'espresso'),
      problem: null,
    });
  });

  it('prefers the record to the older accent id', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'forest');
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, accent: 'slate' }));
    expect(readLaunchTheme().preset.id).toBe('slate');
  });

  it('opens in the default, reported, for an invalid record — even with an older accent id stored', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'forest');
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"plum"');
    expect(readLaunchTheme()).toEqual(
      defaultTheme({ kind: 'invalid-record', field: 'json', stored: '{"accent":"plum"' }),
    );
  });

  it('opens in the default, reported, for a record naming an unknown accent', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, accent: 'neon' as 'warm', background: 'rose' }));
    expect(readLaunchTheme()).toEqual(defaultTheme({ kind: 'unknown-preset', storedId: 'neon' }));
  });

  it('falls back to the default and reports why when the store cannot be read', () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    expect(readLaunchTheme()).toEqual(defaultTheme({ kind: 'read-failed', message: 'database is locked' }));
  });

  it('draws `uiRoles` in the custom hue stored before the record existed', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'hue:265');
    jest.isolateModules(() => {
      const { uiRoles } = require('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
      expect(uiRoles).toEqual(generateRoles(seedsFromHue(265)));
    });
  });

  it('draws `uiRoles` in the preset stored before the record existed', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
    jest.isolateModules(() => {
      const { uiRoles } = require('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
      expect(uiRoles).toEqual(generateRoles(getThemePreset('plum').seeds));
    });
  });

  it('draws `uiRoles` in the background and text of the record', () => {
    Storage.setItemSync(
      APPEARANCE_STORAGE_KEY,
      serialiseAppearanceRecord({ accent: 'hue:120', background: { hue: 30, tint: 1 }, text: 'navy', mode: 'light' }),
    );
    jest.isolateModules(() => {
      const { uiRoles } = require('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
      expect(uiRoles).toEqual(generateRoles(withNeutrals(seedsFromHue(120), { hue: 30, tint: 1 }, 'navy')));
    });
  });

  it('keeps the launch theme when the choice changes while the app runs', async () => {
    let launch!: typeof import('@/components/ui/theme-launch');
    jest.isolateModules(() => {
      launch = require('@/components/ui/theme-launch');
    });
    expect(launch.launchTheme.preset.id).toBe('warm');
    await launch.saveThemeAccent('slate');
    expect(launch.readStoredTheme().preset.id).toBe('slate');
    expect(launch.readLaunchTheme().preset.id).toBe('slate');
    expect(launch.launchTheme.preset.id).toBe('warm');
  });
});

// What a launch resolves when the OS is in `osScheme`, loaded afresh as the app
// would: the mode, the roles `tokens.ts` draws, and the pins made.
function launchWith(osScheme: 'light' | 'dark' | null) {
  let result!: {
    launch: typeof import('@/components/ui/theme-launch');
    tokens: typeof import('@/components/ui/tokens');
    pins: unknown[];
    read: jest.SpyInstance;
    pin: jest.SpyInstance;
  };
  jest.isolateModules(() => {
    const { Appearance: FreshAppearance } = require('react-native') as typeof import('react-native');
    const read = jest.spyOn(FreshAppearance, 'getColorScheme').mockReturnValue(osScheme);
    const pin = jest.spyOn(FreshAppearance, 'setColorScheme').mockImplementation(() => {});
    const tokens = require('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
    const launch = require('@/components/ui/theme-launch') as typeof import('@/components/ui/theme-launch');
    result = { launch, tokens, pins: pin.mock.calls.map(([scheme]) => scheme), read, pin };
  });
  return result;
}

const storeMode = (mode: AppearanceChoice['mode']) =>
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, accent: 'slate', mode }));

describe('the launch mode', () => {
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
  ] as const)('resolves a stored %s on an OS in %s to %s', (mode, osScheme, expected) => {
    expect(resolveMode(mode, osScheme)).toBe(expected);
  });

  it('reads the OS mode before it pins native UI to the resolved mode', () => {
    const read = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const pin = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    expect(pinLaunchMode('system')).toEqual({ osScheme: 'dark', mode: 'dark' });
    expect(pin).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledWith('dark');
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(pin.mock.invocationCallOrder[0]);
  });

  it('resolves without pinning where Appearance cannot pin (react-native-web)', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const original = Appearance.setColorScheme;
    (Appearance as { setColorScheme?: unknown }).setColorScheme = undefined;
    try {
      expect(pinLaunchMode('system')).toEqual({ osScheme: 'dark', mode: 'dark' });
    } finally {
      Appearance.setColorScheme = original;
    }
  });

  it('pins light, whatever the OS, for a light choice', () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    const pin = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    expect(pinLaunchMode('light')).toEqual({ osScheme: 'dark', mode: 'light' });
    expect(pin).toHaveBeenCalledWith('light');
  });

  it('opens a new device in light, pinned, on a dark OS', () => {
    const { launch, tokens, pins } = launchWith('dark');
    expect(launch.launchMode).toBe('light');
    expect(launch.launchOsScheme).toBe('dark');
    expect(tokens.uiMode).toBe('light');
    expect(tokens.uiRoles).toEqual(generateRoles(WARM.seeds, 'light'));
    expect(pins).toEqual(['light']);
  });

  it.each([
    ['dark', 'light', 'dark'],
    ['system', 'dark', 'dark'],
    ['system', 'light', 'light'],
    ['light', 'dark', 'light'],
  ] as const)('draws `uiRoles` for a stored %s on an OS in %s on the %s ladder, and pins it', (mode, osScheme, expected) => {
    storeMode(mode);
    const { launch, tokens, pins } = launchWith(osScheme);
    expect(launch.launchMode).toBe(expected);
    expect(tokens.uiMode).toBe(expected);
    expect(tokens.uiRoles).toEqual(generateRoles(getThemePreset('slate').seeds, expected));
    expect(pins).toEqual([expected]);
  });

  it('opens an unreadable record in light, with its problem to log, even on a dark OS', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"slate","background":"match","text":"match","mode":"dusk"}');
    const { launch, tokens, pins } = launchWith('dark');
    expect(launch.launchTheme.problem).toMatchObject({ kind: 'invalid-record', field: 'mode' });
    expect(launch.launchMode).toBe('light');
    expect(tokens.uiRoles).toEqual(generateRoles(WARM.seeds, 'light'));
    expect(pins).toEqual(['light']);
  });

  it('keeps the launch mode when the OS mode or the stored mode changes while the app runs', async () => {
    storeMode('system');
    const { launch, tokens, read, pin } = launchWith('dark');
    // The phone switches to light, then the user picks Light.
    read.mockReturnValue('light');
    await launch.saveAppearancePart({ mode: 'light' });
    expect(launch.readStoredTheme().appearance.mode).toBe('light');
    expect(launch.launchMode).toBe('dark');
    expect(tokens.uiMode).toBe('dark');
    expect(pin.mock.calls).toEqual([['dark']]);
  });
});

describe('saving', () => {
  it('writes the whole choice as the record', async () => {
    const appearance: AppearanceChoice = { accent: 'forest', background: 'white', text: 'plum', mode: 'light' };
    await saveAppearance(appearance);
    expect(storedRecord()).toEqual(appearance);
    expect(readStoredTheme().appearance).toEqual(appearance);
  });

  it('writes a new accent into the record, keeping the rest of the choice', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord({ ...DEFAULT_APPEARANCE, background: 'rose', text: 'navy' }));
    await saveThemeAccent('hue:90');
    expect(storedRecord()).toEqual({ accent: 'hue:90', background: 'rose', text: 'navy', mode: 'light' });
  });

  it('migrates on the first save: the older accent id becomes a record, and is left in place', async () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
    expect(readStoredTheme().preset.id).toBe('plum');
    await saveThemeAccent('forest');
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, accent: 'forest' });
    expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('plum');
    expect(readLaunchTheme().preset.id).toBe('forest');
  });

  it('replaces an unusable record with the default\'s rest', async () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, 'not json');
    await saveThemeAccent('slate');
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, accent: 'slate' });
  });

  it('saves nothing when the store cannot be read', async () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    await expect(saveThemeAccent('slate')).rejects.toThrow('database is locked');
    expect(Storage.getItemSync(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  // The Jest fake store (jest.setup.ts) shows an async write only once it
  // settles, as the real one does, so a test cannot read a saved value before
  // the code awaiting the write has resumed.
  it('holds a saved choice only once the write settles', async () => {
    const write = saveThemeAccent('slate');
    expect(readStoredTheme().preset.id).toBe('warm');
    await write;
    expect(readStoredTheme().preset.id).toBe('slate');
  });

  it('reads the saves still on their way as the intended choice, and only until they settle', async () => {
    const first = saveAppearancePart({ background: 'rose' });
    const second = saveAppearancePart({ text: 'navy' });
    expect(readStoredTheme().appearance).toEqual(DEFAULT_APPEARANCE);
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, background: 'rose', text: 'navy' });
    await Promise.all([first, second]);
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, background: 'rose', text: 'navy' });
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, background: 'rose', text: 'navy' });
  });

  it('forgets a field whose save failed, even while a later save for another field waits', async () => {
    jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const failed = saveAppearancePart({ background: 'rose' });
    const later = saveAppearancePart({ text: 'navy' });
    await expect(failed).rejects.toThrow('disk full');
    // The later save has not settled: its field still counts, the failed one does not.
    expect(readIntendedTheme()).toEqual({ ...DEFAULT_APPEARANCE, text: 'navy' });
    await later;
    expect(storedRecord()).toEqual({ ...DEFAULT_APPEARANCE, text: 'navy' });
  });

  it('keeps a field queued by a newer save when an older save of it settles', async () => {
    const older = saveAppearancePart({ background: 'rose' });
    const newer = saveAppearancePart({ background: 'cool' });
    await older;
    expect(readIntendedTheme().background).toBe('cool');
    await newer;
    expect(readStoredTheme().appearance.background).toBe('cool');
    expect(readIntendedTheme().background).toBe('cool');
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
