import { Storage } from 'expo-sqlite/kv-store';

import { DIRECTION_PAIRS, generateRoles, THEME_DIRECTIONS, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import { customFromSeeds, generateCustomRoles } from '@/components/ui/theme-custom';
import { seedsFromHue } from '@/components/ui/theme-hue';
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  readStoredTheme,
  THEME_PRESET_STORAGE_KEY,
} from '@/components/ui/theme-launch';
import { themePresets, type AppearanceChoice, type ThemePreset } from '@/components/ui/theme-presets';

import { contrastRatio, isAscending, lightnessOf } from './helpers/contrast';
import { rolesFor } from './helpers/theme';

// The surface look, end to end (`docs/specs/ui/design-language.md` §2, §4):
// the gates every shipped theme passes together, read the way the app reads
// a choice — `rolesFor`, which resolves an appearance on the phone's mode as
// the theme provider does — over every preset `themePresets` lists (so a new
// one cannot skip a gate), both modes, all 360 hue themes and a custom theme
// converted from each preset. The per-rule detail lives beside each rule:
// `ui-theme.test.ts`, `ui-theme-custom.test.ts`, `ui-theme-launch.test.ts`,
// `ui-page-ink-guard.test.tsx`.

const MODES: readonly ThemeMode[] = ['light', 'dark'];
const EVERY_HUE = Array.from({ length: 360 }, (_, hue) => hue);

const inkPaper = (preset: ThemePreset) => preset.ladder === 'ink-paper';
const presetChoice = (preset: ThemePreset, mode: ThemeMode): AppearanceChoice => ({ theme: preset.id, mode, custom: null });

type Drawn = { name: string; roles: UiRoles; darkPage: boolean };

// Every shipped preset in both modes, as the app draws it.
const PRESETS: Drawn[] = MODES.flatMap((mode) =>
  themePresets.map((preset) => ({ name: `${preset.id} ${mode}`, roles: rolesFor(presetChoice(preset, mode)), darkPage: inkPaper(preset) })),
);
// Every hue theme in both modes.
const HUES: Drawn[] = MODES.flatMap((mode) =>
  EVERY_HUE.map((hue) => ({ name: `hue ${hue}° ${mode}`, roles: generateRoles(seedsFromHue(hue), mode), darkPage: false })),
);
// A custom theme started from each preset, in each mode (Settings converts the
// preset in use when Custom is chosen).
const CUSTOM_FROM_PRESETS: Drawn[] = MODES.flatMap((mode) =>
  themePresets.map((preset) => ({
    name: `custom from ${preset.id} ${mode}`,
    roles: rolesFor({ theme: 'custom', mode, custom: customFromSeeds(preset.seeds, mode) }),
    darkPage: false,
  })),
);

const names = (drawn: Drawn[]) => drawn.map(({ name }) => name);

describe('the ground ladder', () => {
  it('runs well < paper < surface < raised, a card at least 4 L* off the page, for every preset, hue and converted custom theme', () => {
    const broken = [...PRESETS, ...HUES, ...CUSTOM_FROM_PRESETS]
      .filter(({ darkPage }) => !darkPage)
      .filter(({ roles }) => !isAscending([roles.well, roles.paper, roles.surface, roles.raised]) || lightnessOf(roles.surface) - lightnessOf(roles.paper) < 4);
    expect(names(broken)).toEqual([]);
  });

  it('lays Ink + paper’s dark page under its light cards: paper < well < surface < raised, in both modes', () => {
    const inkPaperDrawn = PRESETS.filter(({ darkPage }) => darkPage);
    expect(inkPaperDrawn).toHaveLength(MODES.length);
    const broken = inkPaperDrawn.filter(
      ({ roles }) => !isAscending([roles.paper, roles.well, roles.surface, roles.raised]) || lightnessOf(roles.surface) - lightnessOf(roles.paper) < 4,
    );
    expect(names(broken)).toEqual([]);
  });

  it('never draws a light card white', () => {
    const light = [...PRESETS, ...HUES].filter(({ name }) => name.endsWith(' light'));
    expect(names(light.filter(({ roles }) => roles.surface === '#FFFFFF'))).toEqual([]);
  });
});

describe('the three inks', () => {
  it('has no `inkGhost` in any theme', () => {
    expect(names([...PRESETS, ...HUES, ...CUSTOM_FROM_PRESETS].filter(({ roles }) => 'inkGhost' in roles))).toEqual([]);
  });

  it('clears 3:1 for `inkFaint` on the card and the page, for every preset and hue, in both modes', () => {
    // On Ink + paper the page is dark: faint text on it is `pageInkFaint`, and
    // `inkFaint` is drawn on the cards and the inset inside them.
    const broken = [...PRESETS, ...HUES].filter(({ roles, darkPage }) =>
      darkPage
        ? [roles.surface, roles.inset].some((ground) => contrastRatio(roles.inkFaint, ground) < 3) || contrastRatio(roles.pageInkFaint, roles.paper) < 3
        : [roles.surface, roles.paper].some((ground) => contrastRatio(roles.inkFaint, ground) < 3),
    );
    expect(names(broken)).toEqual([]);
  });
});

describe('the change directions', () => {
  // The grounds a change figure sits on: the page and a card, or on Ink +
  // paper the card and the inset inside it.
  const figureGrounds = ({ roles, darkPage }: Drawn) => (darkPage ? [roles.surface, roles.inset] : [roles.surface, roles.paper]);
  const illegible = (drawn: Drawn) =>
    [drawn.roles.gain, drawn.roles.loss].some((change) => figureGrounds(drawn).some((ground) => contrastRatio(change, ground) < 4.5));

  it('clears 4.5:1 for `gain` and `loss` as text in every preset’s own direction, in both modes', () => {
    expect(names(PRESETS.filter(illegible))).toEqual([]);
  });

  it.each(THEME_DIRECTIONS)('clears 4.5:1 for `gain` and `loss` under %s on every hue theme and every preset’s seeds', (direction) => {
    const drawn = MODES.flatMap((mode) => [
      ...EVERY_HUE.map((hue) => ({ name: `hue ${hue}° ${mode}`, roles: generateRoles({ ...seedsFromHue(hue), direction }, mode), darkPage: false })),
      ...themePresets
        .filter((preset) => !inkPaper(preset))
        .map((preset) => ({ name: `${preset.id} ${mode}`, roles: generateRoles({ ...preset.seeds, direction }, mode), darkPage: false })),
    ]);
    expect(names(drawn.filter(illegible))).toEqual([]);
  });

  it('draws each preset’s pair from its direction', () => {
    for (const mode of MODES) {
      for (const preset of themePresets.filter((one) => !inkPaper(one) && one.seeds.direction !== 'ink')) {
        const roles = rolesFor(presetChoice(preset, mode));
        expect({ gain: roles.gain, loss: roles.loss }).toEqual(DIRECTION_PAIRS[preset.seeds.direction as Exclude<typeof preset.seeds.direction, 'ink'>][mode]);
      }
    }
  });
});

// Every value the current and earlier builds can have stored opens in the
// closest new theme, with no problem reported.
describe('stored themes still open', () => {
  // A custom theme as the previous build wrote it: Charts and Borders parts
  // the editor no longer has, and no direction.
  const OLDER_CUSTOM = {
    background: { hue: 200, strength: 30, mode: 'dark', lightness: 20, depth: 150 },
    borders: { hue: 120, strength: 70, match: false, contrast: 250 },
    ink: { hue: 265, strength: 30, lightness: 95 },
    text: { hue: 60, strength: 10, contrast: 100 },
    accent: { hue: 330, strength: 80 },
    highlight: { hue: 330, strength: 20, match: true, contrast: 100 },
    record: { hue: 90, strength: 60 },
    viz: { hue: 150, strength: 50, gamut: true },
  };
  const record = (theme: string, mode: string, custom: unknown = null) => JSON.stringify({ theme, mode, custom });

  const cases: [string, string, string, Pick<AppearanceChoice, 'theme' | 'mode'>][] = [
    ...themePresets.flatMap((preset) =>
      ['light', 'dark', 'system'].map((mode): [string, string, string, Pick<AppearanceChoice, 'theme' | 'mode'>] => [
        `the ${preset.id} preset in ${mode}`,
        APPEARANCE_STORAGE_KEY,
        record(preset.id, mode),
        { theme: preset.id, mode: mode as AppearanceChoice['mode'] },
      ]),
    ),
    ['a preset holding older custom colours', APPEARANCE_STORAGE_KEY, record('forest', 'dark', OLDER_CUSTOM), { theme: 'forest', mode: 'dark' }],
    ['an older custom theme with Charts and Borders parts', APPEARANCE_STORAGE_KEY, record('custom', 'light', OLDER_CUSTOM), { theme: 'custom', mode: 'light' }],
    ['a custom theme with a direction', APPEARANCE_STORAGE_KEY, record('custom', 'light', { ...OLDER_CUSTOM, direction: 'blue-orange' }), { theme: 'custom', mode: 'light' }],
    ['the record before custom themes, a preset', LEGACY_APPEARANCE_STORAGE_KEY, '{"accent":"plum","background":"match","text":"match","mode":"dark"}', { theme: 'plum', mode: 'dark' }],
    ['the record before custom themes, a tinted hue', LEGACY_APPEARANCE_STORAGE_KEY, '{"accent":"hue:200","background":"cool","text":"navy","mode":"light"}', { theme: 'custom', mode: 'light' }],
    ['the accent id alone, a preset', THEME_PRESET_STORAGE_KEY, 'slate', { theme: 'slate', mode: 'light' }],
    ['the accent id alone, a hue', THEME_PRESET_STORAGE_KEY, 'hue:47', { theme: 'custom', mode: 'light' }],
  ];

  it.each(cases)('opens %s', (_name, key, stored, expected) => {
    Storage.setItemSync(key, stored);
    const { appearance, problem } = readStoredTheme();
    expect(problem).toBeNull();
    expect(appearance).toMatchObject(expected);
    const roles = rolesFor(appearance);
    expect(roles).not.toHaveProperty('inkGhost');
    expect(isAscending([roles.surface, roles.raised])).toBe(true);
  });

  it('opens an older custom theme in green and crimson, its dropped parts ignored', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, record('custom', 'light', OLDER_CUSTOM));
    const { appearance } = readStoredTheme();
    expect(appearance.custom?.direction).toBe('green-crimson');
    expect(appearance.custom).not.toHaveProperty('borders');
    expect(appearance.custom).not.toHaveProperty('viz');
  });

  it('opens a stored direction in it', () => {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, record('custom', 'light', { ...OLDER_CUSTOM, direction: 'blue-orange' }));
    expect(readStoredTheme().appearance.custom?.direction).toBe('blue-orange');
  });
});

describe('page inks', () => {
  it('sets Ink + paper’s page text apart from its card text, legible on the dark page', () => {
    for (const { roles } of PRESETS.filter(({ darkPage }) => darkPage)) {
      expect(roles.pageInk).not.toBe(roles.ink);
      expect(roles.pageInkMuted).not.toBe(roles.inkMuted);
      expect(contrastRatio(roles.pageInk, roles.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.pageInkMuted, roles.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the page inks as the inks in every other preset, hue and custom theme', () => {
    const apart = [...PRESETS, ...HUES, ...CUSTOM_FROM_PRESETS]
      .filter(({ darkPage }) => !darkPage)
      .filter(({ roles }) => roles.pageInk !== roles.ink || roles.pageInkMuted !== roles.inkMuted);
    expect(names(apart)).toEqual([]);
  });

  it('draws custom colours converted from Ink + paper on an ordinary page', () => {
    // Custom themes have one ladder per mode; their page inks are their inks.
    const preset = themePresets.find(inkPaper);
    expect(preset).toBeDefined();
    const roles = generateCustomRoles(customFromSeeds(preset!.seeds, 'light'));
    expect([roles.pageInk, roles.pageInkMuted]).toEqual([roles.ink, roles.inkMuted]);
  });
});
