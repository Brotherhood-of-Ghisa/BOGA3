/* eslint-disable import/first */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { Storage } from 'expo-sqlite/kv-store';

import { generateRoles } from '@/components/ui/theme';
import {
  readLaunchTheme,
  readStoredThemePresetId,
  saveThemePresetId,
  THEME_PRESET_STORAGE_KEY,
} from '@/components/ui/theme-launch';
import { getThemePreset, resolveThemePreset } from '@/components/ui/theme-presets';
import { reportLaunchThemeProblem } from '@/src/appearance/launch-theme-report';

// The chosen theme (`docs/specs/ui/design-language.md` §2, "Presets"): a preset
// id stored per device, resolved to seeds when `tokens.ts` first evaluates. An
// unknown id or an unreadable store falls back to the default, and the root
// layout logs why.

beforeEach(() => {
  mockLogEvent.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveThemePreset', () => {
  it('is the default, with no problem, when nothing is stored', () => {
    expect(resolveThemePreset(null)).toEqual({ preset: getThemePreset('warm'), problem: null });
  });

  it('is the stored preset', () => {
    expect(resolveThemePreset('slate')).toEqual({ preset: getThemePreset('slate'), problem: null });
  });

  it('falls back to the default and reports an id no preset has', () => {
    expect(resolveThemePreset('neon')).toEqual({
      preset: getThemePreset('warm'),
      problem: { kind: 'unknown-preset', storedId: 'neon' },
    });
  });
});

describe('the launch theme', () => {
  it('reads back what Settings saved', async () => {
    await saveThemePresetId('forest');
    expect(readStoredThemePresetId()).toBe('forest');
    expect(readLaunchTheme()).toEqual({ preset: getThemePreset('forest'), problem: null });
  });

  it('falls back to the default and reports why when the store cannot be read', () => {
    jest.spyOn(Storage, 'getItemSync').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    expect(readLaunchTheme()).toEqual({
      preset: getThemePreset('warm'),
      problem: { kind: 'read-failed', message: 'database is locked' },
    });
  });

  it('draws `uiRoles` in the preset stored before launch', () => {
    Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'plum');
    jest.isolateModules(() => {
      const { uiRoles } = require('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
      expect(uiRoles).toEqual(generateRoles(getThemePreset('plum').seeds));
    });
  });

  it('keeps the launch theme when the choice changes while the app runs', async () => {
    let launch!: typeof import('@/components/ui/theme-launch');
    jest.isolateModules(() => {
      launch = require('@/components/ui/theme-launch');
    });
    expect(launch.launchTheme.preset.id).toBe('warm');
    await launch.saveThemePresetId('slate');
    expect(launch.readStoredThemePresetId()).toBe('slate');
    expect(launch.readLaunchTheme().preset.id).toBe('slate');
    expect(launch.launchTheme.preset.id).toBe('warm');
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

  it('logs an unreadable store as an error', () => {
    reportLaunchThemeProblem({ kind: 'read-failed', message: 'database is locked' });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', event: 'theme.read_failed', context: { error: 'database is locked' } }),
    );
  });
});
