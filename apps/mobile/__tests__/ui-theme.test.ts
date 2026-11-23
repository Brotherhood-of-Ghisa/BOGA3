import { createHash } from 'crypto';

import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import {
  defaultThemeSeeds,
  DIRECTION_PAIRS,
  generateRoles,
  THEME_DIRECTIONS,
  type ThemeMode,
  type ThemeSeeds,
  type UiRoles,
} from '@/components/ui/theme';
import { customFromSeeds, generateCustomRoles } from '@/components/ui/theme-custom';
import { hueName, hueThemeId, parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';
import { DEFAULT_APPEARANCE, DEFAULT_THEME_PRESET_ID, getThemePreset, presetRoles, themePresets } from '@/components/ui/theme-presets';

import { rolesFor } from './helpers/theme';
import themeRolesLight from './fixtures/theme-roles-light.json';

// The theme generator (`docs/specs/ui/design-language.md` §2, "Derivation"
// and "Presets"): every colour role is generated from four seeds and a
// direction, on a light or a dark ladder. These tests pin that the default seeds reproduce the picked
// palette, that the rules the palette is gated on hold in both modes for every
// shipped preset and for seeds no preset ships, and that each preset's `accent`
// and `record` — used as given in light mode — meet their own floors. Custom
// themes are not gated (`ui-theme-custom.test.ts`).

// The palette as picked on device, its grounds and hairlines on the ground
// ladder (L* 90 / 92 / 97 / 100), its `accent` and `record` darkened to L* 43
// so each clears 4.5:1 on that page, and its chart ramp on the background's
// hue. The generator is calibrated to it; a role drifting further than ΔE*ab 3
// from it is a visible change and needs its own design decision.
const PICKED_PALETTE: Omit<UiRoles, 'scrim' | OnColourRole | AliasRole> = {
  ink: '#1B1712',
  inkMuted: '#6B6358',
  inkFaint: '#8A8379',
  well: '#E6E2DD',
  paper: '#EBE8E3',
  surface: '#F8F6F3',
  raised: '#FFFFFF',
  selection: '#000000',
  rule: '#E0D9D0',
  ruleSoft: '#E6E0D8',
  accent: '#B83902',
  accentWash: '#FFECE5',
  record: '#845F0F',
  recordWash: '#FFEED7',
  recordRule: '#F3DCBE',
  danger: '#A4262C',
  regimeOlder: '#006C70',
  regimeNewer: '#7A286B',
  gain: '#15703F',
  loss: '#C01048',
  viz0: '#F0ECE7',
  viz1: '#E4D8C9',
  viz2: '#CEBFA9',
  viz3: '#B6A388',
  viz4: '#9D8869',
};

// Seeds no preset ships with, chosen to pull the generator away from the
// shipped ones: a teal, an indigo and a rose ground, with accents and records
// on other parts of the wheel, and a grey one. They prove the generator, not a
// theme.
const OTHER_SEEDS: Record<string, ThemeSeeds> = {
  harbour: { background: '#5A6666', text: '#5A6666', accent: '#0F766E', record: '#8A6516', direction: 'green-crimson' },
  indigo: { background: '#5F5F6E', text: '#5F5F6E', accent: '#4F46E5', record: '#8A6516', direction: 'green-crimson' },
  rose: { background: '#6A5F62', text: '#6A5F62', accent: '#B4235A', record: '#7A6A12', direction: 'green-crimson' },
  // Background and text apart: a cool page under a warm ink.
  split: { background: '#5B6470', text: '#6B5848', accent: '#C2410C', record: '#8A6516', direction: 'green-crimson' },
  // A near-grey page: its ramp still takes a hue, at the chroma floor.
  grey: { background: '#6B6B6C', text: '#6B6B6C', accent: '#C2410C', record: '#8A6516', direction: 'green-crimson' },
};

type OnColourRole = 'onAccent' | 'onSelection' | 'onDanger' | 'onInk';
// Text drawn straight on the page and the step below a card, inside it: the
// role each one is everywhere but on Ink + paper, whose page is dark.
type PageInkRole = 'pageInk' | 'pageInkMuted' | 'pageInkFaint';
type AliasRole = PageInkRole | 'inset';
const ALIASES: Record<AliasRole, 'ink' | 'inkMuted' | 'inkFaint' | 'paper'> = {
  pageInk: 'ink',
  pageInkMuted: 'inkMuted',
  pageInkFaint: 'inkFaint',
  inset: 'paper',
};
const ON_COLOUR_ROLES: readonly OnColourRole[] = ['onAccent', 'onSelection', 'onDanger', 'onInk'];
const MODES: readonly ThemeMode[] = ['light', 'dark'];
// The roles no seed moves that carry a meaning of their own.
const FIXED_HUES = ['danger', 'gain', 'loss', 'regimeOlder', 'regimeNewer'] as const;
// The fill each on-colour role is drawn on.
const FILL_OF: Record<OnColourRole, keyof UiRoles> = {
  onAccent: 'accent',
  onSelection: 'selection',
  onDanger: 'danger',
  onInk: 'ink',
};

// One value per role, except the on-colour roles: each is named by the fill it
// sits on, so it may share a value with another role (white, in light mode).
// A page ink that is its ink, or an inset that is the page, is that role under
// a second name.
function grounds(roles: UiRoles): string[] {
  return Object.entries(roles)
    .filter(([role]) => !ON_COLOUR_ROLES.includes(role as OnColourRole))
    .filter(([role, value]) => !(role in ALIASES) || value !== roles[ALIASES[role as AliasRole]])
    .map(([, value]) => value);
}

// The presets drawn on the light and dark ladders; Ink + paper has its own
// (`the Ink + paper preset`).
const LADDER_PRESETS = themePresets.filter((preset) => preset.ladder === undefined);
const PRESET_SEEDS: Record<string, ThemeSeeds> = Object.fromEntries(
  LADDER_PRESETS.map((preset) => [`${preset.id} preset`, preset.seeds]),
);

// A custom colour's seeds, around the wheel every 30° (every hue is checked
// against the floors in "custom hue themes").
const HUE_SEEDS: Record<string, ThemeSeeds> = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`hue ${index * 30}°`, seedsFromHue(index * 30)]),
);

describe('lch colour space', () => {
  it('converts known colours to CIE LCh', () => {
    expect(hexToLch('#FFFFFF')).toMatchObject({ lightness: expect.closeTo(100, 1), chroma: expect.closeTo(0, 1) });
    expect(hexToLch('#000000').lightness).toBeCloseTo(0, 1);
    const accent = hexToLch('#B83902');
    expect(accent.lightness).toBeCloseTo(43.0, 0);
    expect(accent.chroma).toBeCloseTo(73.3, 0);
    expect(accent.hue).toBeCloseTo(47, -1);
  });

  it('round-trips every in-gamut colour to the same hex', () => {
    for (const hex of [...Object.values(PICKED_PALETTE), '#000000', '#7F7F7F', '#1F6FB2', '#2F7D4F']) {
      expect(lchToHex(hexToLch(hex))).toBe(hex);
    }
  });

  it('keeps lightness and hue when a requested chroma is outside sRGB', () => {
    const requested = { lightness: 97, chroma: 80, hue: 47 };
    const fitted = hexToLch(lchToHex(requested));
    expect(fitted.lightness).toBeCloseTo(97, 0);
    expect(hueDistance(fitted.hue, 47)).toBeLessThanOrEqual(5);
    expect(fitted.chroma).toBeLessThan(80);
  });

  it('rejects anything but #RRGGBB', () => {
    expect(() => hexToLch('#FFF')).toThrow('expected #RRGGBB');
    expect(() => hexToLch('rgb(0, 0, 0)')).toThrow('expected #RRGGBB');
  });

  it('writes an opacity as React Native rgba()', () => {
    expect(withAlpha('#1B1712', 0.42)).toBe('rgba(27, 23, 18, 0.42)');
  });
});

describe('theme generator', () => {
  it('is made of four seeds and a direction', () => {
    expect(Object.keys(defaultThemeSeeds).sort()).toEqual(['accent', 'background', 'direction', 'record', 'text']);
    for (const preset of themePresets) expect(Object.keys(preset.seeds).sort()).toEqual(Object.keys(defaultThemeSeeds).sort());
    expect(Object.keys(seedsFromHue(200)).sort()).toEqual(Object.keys(defaultThemeSeeds).sort());
  });

  it('draws the chart ramp on the background’s hue, with a chroma floor for a near-grey page', () => {
    for (const seeds of [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS)]) {
      const roles = generateRoles(seeds);
      for (const role of ['viz1', 'viz2', 'viz3', 'viz4'] as const) {
        expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(seeds.background).hue)).toBeLessThanOrEqual(10);
      }
    }
    const grey = generateRoles(OTHER_SEEDS.grey);
    expect(hexToLch(OTHER_SEEDS.grey.background).chroma).toBeLessThan(1);
    expect(hexToLch(grey.viz4).chroma).toBeGreaterThanOrEqual(11);
    expect(hexToLch(grey.viz4).chroma).toBeGreaterThan(hexToLch(grey.viz0).chroma + 10);
  });

  it('is what the app ships: the default appearance draws the default seeds, generated', () => {
    expect(rolesFor(DEFAULT_APPEARANCE)).toEqual(generateRoles(defaultThemeSeeds));
  });

  it('reproduces the palette picked on device within ΔE*ab 3', () => {
    const generated = generateRoles(defaultThemeSeeds);
    const drift = Object.entries(PICKED_PALETTE)
      .map(([role, picked]) => ({ role, deltaE: deltaE(generated[role as keyof typeof PICKED_PALETTE], picked) }))
      .filter(({ deltaE: distance }) => distance > 3);
    expect(drift).toEqual([]);
  });

  it('in light mode, uses the accent and record seeds as given, and never themes danger, a field, filter selection or the on-colour roles', () => {
    for (const seeds of [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS)]) {
      const roles = generateRoles(seeds);
      expect(roles.accent).toBe(seeds.accent);
      expect(roles.record).toBe(seeds.record);
      expect(roles.danger).toBe('#A4262C');
      // A card is a ground of its own, no longer white; a field on it is.
      expect(roles.surface).not.toBe('#FFFFFF');
      expect(roles.raised).toBe('#FFFFFF');
      expect(roles.selection).toBe('#000000');
      expect(roles.scrim).toBe(withAlpha(roles.ink, 0.42));
      for (const role of ON_COLOUR_ROLES) expect(roles[role]).toBe('#FFFFFF');
    }
  });

  it('tints the ground family from `background` and the ink family from `text`', () => {
    const { split } = OTHER_SEEDS;
    const roles = generateRoles(split);
    for (const role of ['well', 'paper', 'rule', 'ruleSoft', 'viz0'] as const) {
      expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(split.background).hue)).toBeLessThanOrEqual(10);
    }
    for (const role of ['ink', 'inkMuted', 'inkFaint'] as const) {
      expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(split.text).hue)).toBeLessThanOrEqual(10);
    }
    expect(roles.scrim).toBe(withAlpha(roles.ink, 0.42));
    // Moving one seed leaves the other family where it was.
    const warm = generateRoles(defaultThemeSeeds);
    const coolPage = generateRoles({ ...defaultThemeSeeds, background: split.background });
    expect([coolPage.ink, coolPage.inkMuted, coolPage.inkFaint]).toEqual([warm.ink, warm.inkMuted, warm.inkFaint]);
    expect(coolPage.paper).not.toBe(warm.paper);
  });

  it('throws on a seed that is not #RRGGBB', () => {
    expect(() => generateRoles({ ...defaultThemeSeeds, accent: 'orange' })).toThrow('expected #RRGGBB');
  });

  describe.each(
    MODES.flatMap((mode) =>
      Object.entries({ ...PRESET_SEEDS, ...OTHER_SEEDS, ...HUE_SEEDS }).map(([name, seeds]) => [name, mode, seeds] as const),
    ),
  )('for the %s seeds in %s mode', (_name, mode, seeds) => {
    const roles = generateRoles(seeds, mode);

    it('gives no two roles the same value', () => {
      const values = grounds(roles);
      expect(new Set(values).size).toBe(values.length);
    });

    it('steps the neutrals in a fixed lightness order, each family on its own seed\'s hue', () => {
      expect(isAscending(neutralLadder(roles, mode))).toBe(true);
      // Hue is only meaningful where there is chroma to carry it.
      for (const neutral of [roles.inkMuted, roles.inkFaint]) {
        expect(hueDistance(hexToLch(neutral).hue, hexToLch(seeds.text).hue)).toBeLessThanOrEqual(10);
      }
      expect(hueDistance(hexToLch(roles.rule).hue, hexToLch(seeds.background).hue)).toBeLessThanOrEqual(10);
    });

    it('keeps text legible: `ink` and `ink-muted` on every ground, `ink` on every viz step', () => {
      // A segment's label sits in a well, typed text in a raised field.
      for (const background of [roles.well, roles.paper, roles.surface, roles.raised]) {
        expect(contrastRatio(roles.ink, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(roles.inkMuted, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(roles.ink, roles.viz4)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.ink, roles.viz1)).toBeGreaterThanOrEqual(3);
    });

    it('steps the viz ramp away from the page by at least 6 L* a step', () => {
      for (const stepSize of vizSteps(roles, mode)) expect(stepSize).toBeGreaterThanOrEqual(6);
    });

    it('tints each wash from its own role, close to the page', () => {
      expect(hueDistance(hexToLch(roles.accentWash).hue, hexToLch(roles.accent).hue)).toBeLessThanOrEqual(10);
      expect(hueDistance(hexToLch(roles.recordWash).hue, hexToLch(roles.record).hue)).toBeLessThanOrEqual(10);
      if (mode === 'light') expect(hexToLch(roles.accentWash).lightness).toBeGreaterThanOrEqual(94);
      else expect(Math.abs(hexToLch(roles.accentWash).lightness - hexToLch(roles.paper).lightness)).toBeLessThanOrEqual(10);
    });
  });
});

describe('the dark ladder', () => {
  const SEEDS = [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS), ...Object.values(HUE_SEEDS)];

  it('sinks a well to L* 7, lays the page at L* 10, lifts a card to L* 15 and a field on it to L* 21.5, and draws `ink` at L* 95', () => {
    for (const seeds of SEEDS) {
      const roles = generateRoles(seeds, 'dark');
      expect(hexToLch(roles.well).lightness).toBeCloseTo(7, 0);
      expect(hexToLch(roles.paper).lightness).toBeCloseTo(10, 0);
      expect(hexToLch(roles.surface).lightness).toBeCloseTo(15, 0);
      expect(hexToLch(roles.raised).lightness).toBeCloseTo(21.5, 0);
      expect(hexToLch(roles.ink).lightness).toBeCloseTo(95, 0);
    }
  });

  it('fixes danger, filter selection, the change directions, the regimes, the on-colour roles and the scrim', () => {
    for (const seeds of SEEDS) {
      const roles = generateRoles(seeds, 'dark');
      expect(roles).toMatchObject({
        selection: '#FFFFFF',
        danger: '#F7716B',
        ...DIRECTION_PAIRS[seeds.direction as 'green-crimson' | 'blue-orange'].dark,
        regimeOlder: '#54A8AC',
        regimeNewer: '#D57DC1',
        scrim: 'rgba(0, 0, 0, 0.6)',
      });
      for (const role of ON_COLOUR_ROLES) expect(roles[role]).toBe('#000000');
    }
  });

  it('keeps each fixed role on its light hue, and `gain` and `loss` at one L*', () => {
    const light = generateRoles(defaultThemeSeeds);
    const dark = generateRoles(defaultThemeSeeds, 'dark');
    for (const role of ['danger', 'gain', 'loss', 'regimeOlder', 'regimeNewer'] as const) {
      expect(hueDistance(hexToLch(dark[role]).hue, hexToLch(light[role]).hue)).toBeLessThanOrEqual(3);
    }
    expect(Math.abs(hexToLch(dark.gain).lightness - hexToLch(dark.loss).lightness)).toBeLessThanOrEqual(2);
  });

  it('steps `accent` and `record` from their seeds rather than using them as given', () => {
    for (const seeds of SEEDS) {
      const roles = generateRoles(seeds, 'dark');
      expect(hueDistance(hexToLch(roles.accent).hue, hexToLch(seeds.accent).hue)).toBeLessThanOrEqual(3);
      expect(hueDistance(hexToLch(roles.record).hue, hexToLch(seeds.record).hue)).toBeLessThanOrEqual(3);
      expect(hexToLch(roles.accent).lightness).toBeCloseTo(72, 0);
      expect(hexToLch(roles.record).lightness).toBeCloseTo(66, 0);
    }
  });

  it('lightens the viz ramp in even steps: "more" stays stronger', () => {
    for (const seeds of SEEDS) {
      const [, ...rampSteps] = vizSteps(generateRoles(seeds, 'dark'), 'dark');
      expect(Math.max(...rampSteps) - Math.min(...rampSteps)).toBeLessThanOrEqual(0.7);
    }
  });
});

// A change's direction (`design-language.md` §2): each pair, or `ink`, on every
// preset's and every hue theme's grounds, in both modes.
describe('the change directions', () => {
  const everyHue = Array.from({ length: 360 }, (_, hue) => seedsFromHue(hue));
  const allSeeds = [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS), ...everyHue];

  it.each(MODES.flatMap((mode) => THEME_DIRECTIONS.map((direction) => [direction, mode] as const)))(
    'draws %s legibly as text on `paper` and `surface` in %s mode, for every preset and hue',
    (direction, mode) => {
      const failures = allSeeds
        .map((seeds) => generateRoles({ ...seeds, direction }, mode))
        .filter((roles) => [roles.gain, roles.loss].some((colour) => [roles.paper, roles.surface].some((ground) => contrastRatio(colour, ground) < 4.5)));
      expect(failures).toEqual([]);
    },
  );

  it.each(MODES)('keeps each colour pair at one L*, two hues well apart, in %s mode', (mode) => {
    for (const pair of Object.values(DIRECTION_PAIRS)) {
      const [gain, loss] = [hexToLch(pair[mode].gain), hexToLch(pair[mode].loss)];
      expect(Math.abs(gain.lightness - loss.lightness)).toBeLessThanOrEqual(1);
      expect(hueDistance(gain.hue, loss.hue)).toBeGreaterThanOrEqual(90);
    }
  });

  it('draws green and crimson by default: every preset but Sage, and the values shipped before directions', () => {
    for (const [name, seeds] of Object.entries(PRESET_SEEDS)) {
      expect(seeds.direction).toBe(name === 'sage preset' ? 'blue-orange' : 'green-crimson');
    }
    expect(generateRoles(defaultThemeSeeds)).toMatchObject({ gain: '#15703F', loss: '#C01048' });
    expect(generateRoles(defaultThemeSeeds, 'dark')).toMatchObject({ gain: '#58AC76', loss: '#FF6881' });
  });

  it('draws blue and orange from the blue-orange direction', () => {
    const roles = generateRoles({ ...defaultThemeSeeds, direction: 'blue-orange' });
    expect(hueDistance(hexToLch(roles.gain).hue, 255)).toBeLessThanOrEqual(5);
    expect(hueDistance(hexToLch(roles.loss).hue, 55)).toBeLessThanOrEqual(5);
  });

  it.each(MODES)('keeps every pair a visible step from every preset’s accent and record in %s mode', (mode) => {
    // A custom theme starts from the preset in use, so its direction must not
    // land on that preset's accent or brass.
    for (const preset of themePresets) {
      const roles = presetRoles(preset, mode);
      for (const pair of Object.values(DIRECTION_PAIRS)) {
        for (const change of [pair[mode].gain, pair[mode].loss]) {
          expect(deltaE(change, roles.accent)).toBeGreaterThanOrEqual(5);
          expect(deltaE(change, roles.record)).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it.each(MODES)('draws both directions in `ink` under the ink direction, in %s mode, moving nothing else', (mode) => {
    for (const seeds of [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS)]) {
      const pair = generateRoles(seeds, mode);
      const ink = generateRoles({ ...seeds, direction: 'ink' }, mode);
      expect([ink.gain, ink.loss]).toEqual([ink.ink, ink.ink]);
      expect({ ...ink, gain: pair.gain, loss: pair.loss }).toEqual(pair);
    }
  });
});

// The ground ladder (`design-language.md` §2): a sunken well, the page, a
// card and a field on a card, in that order of lightness in both modes, for
// every preset and every one of the 360 hue themes.
describe('the ground ladder', () => {
  const everyHue = Array.from({ length: 360 }, (_, hue) => [`hue ${hue}°`, seedsFromHue(hue)] as const);
  const cases = MODES.flatMap((mode) =>
    [...Object.entries(PRESET_SEEDS), ...everyHue].map(([name, seeds]) => ({ name, mode, roles: generateRoles(seeds, mode) })),
  );

  it('runs well < paper < surface < raised, with a card at least 4 L* off the page', () => {
    const broken = cases
      .filter(({ roles }) => !isAscending([roles.well, roles.paper, roles.surface, roles.raised]) || lightnessOf(roles.surface) - lightnessOf(roles.paper) < 4)
      .map(({ name, mode }) => `${name} ${mode}`);
    expect(broken).toEqual([]);
  });

  it('sits within ±1 L* of 90 / 92 / 97 / 100 in light mode, every preset and hue', () => {
    const target = { well: 90, paper: 92, surface: 97, raised: 100 } as const;
    const off = cases
      .filter(({ mode }) => mode === 'light')
      .filter(({ roles }) => (Object.keys(target) as (keyof typeof target)[]).some((role) => Math.abs(lightnessOf(roles[role]) - target[role]) > 1))
      .map(({ name }) => name);
    expect(off).toEqual([]);
  });

  it('no longer draws a light card white', () => {
    expect(cases.filter(({ mode, roles }) => mode === 'light' && roles.surface === '#FFFFFF').map(({ name }) => name)).toEqual([]);
  });
});

// Ink + paper (`design-language.md` §2, "Presets"): a dark page under light
// cards, on a ladder of its own that is the same in both modes. Every well and
// field sits on a card, so its well is lighter than its page. Text on the page
// takes the page inks; everywhere else the page inks are the inks.
describe('the Ink + paper preset', () => {
  const preset = getThemePreset('ink-paper');
  const cardGrounds = (roles: UiRoles) => [roles.well, roles.inset, roles.surface, roles.raised];

  describe.each(MODES)('in %s mode', (mode) => {
    const roles = presetRoles(preset, mode);

    it('runs paper < well < surface < raised, a dark page under light cards at least 4 L* off it, the inset between well and card', () => {
      expect(isAscending([roles.paper, roles.well, roles.surface, roles.raised])).toBe(true);
      expect(isAscending([roles.well, roles.inset, roles.surface])).toBe(true);
      expect(lightnessOf(roles.paper)).toBeLessThan(20);
      expect(lightnessOf(roles.surface)).toBeGreaterThan(90);
      expect(lightnessOf(roles.surface) - lightnessOf(roles.paper)).toBeGreaterThanOrEqual(4);
    });

    it('keeps `ink` and `inkMuted` legible on every card ground, and `inkFaint` at 3:1 on the card', () => {
      for (const ground of cardGrounds(roles)) {
        expect(contrastRatio(roles.ink, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(roles.inkMuted, ground)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(roles.inkFaint, roles.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(roles.inkFaint, roles.inset)).toBeGreaterThanOrEqual(3);
    });

    it('draws text on the page in the page inks: `pageInk` and `pageInkMuted` at 4.5:1, `pageInkFaint` at 3:1', () => {
      expect(contrastRatio(roles.pageInk, roles.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.pageInkMuted, roles.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.pageInkFaint, roles.paper)).toBeGreaterThanOrEqual(3);
      expect(isAscending([roles.paper, roles.pageInkFaint, roles.pageInkMuted, roles.pageInk])).toBe(true);
    });

    it('passes the preset gates on its cards', () => {
      expect(brokenInkPaperFloors(roles)).toEqual([]);
    });
  });

  it('draws the same roles in light and dark mode', () => {
    expect(presetRoles(preset, 'dark')).toEqual(presetRoles(preset, 'light'));
  });

  it('takes the page from the ink family and the cards from the ground family', () => {
    const roles = presetRoles(preset, 'light');
    expect(hueDistance(hexToLch(roles.paper).hue, hexToLch(preset.seeds.text).hue)).toBeLessThanOrEqual(10);
    for (const role of ['well', 'surface', 'rule', 'ruleSoft'] as const) {
      expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(preset.seeds.background).hue)).toBeLessThanOrEqual(10);
    }
  });

  it('draws the page inks as the inks, and the inset as the page, in every other preset, all 360 hue themes and custom themes', () => {
    const everyHue = Array.from({ length: 360 }, (_, hue) => seedsFromHue(hue));
    const themes = MODES.flatMap((mode) => [
      ...LADDER_PRESETS.map((other) => presetRoles(other, mode)),
      ...everyHue.map((seeds) => generateRoles(seeds, mode)),
      ...[...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS), preset.seeds].map((seeds) => generateCustomRoles(customFromSeeds(seeds, mode))),
    ]);
    const apart = themes.filter((roles) =>
      (Object.keys(ALIASES) as AliasRole[]).some((role) => roles[role] !== roles[ALIASES[role]]));
    expect(apart).toEqual([]);
  });
});

describe('theme presets', () => {
  it('ship the default seeds as the default preset, listed first', () => {
    expect(themePresets[0].id).toBe(DEFAULT_THEME_PRESET_ID);
    expect(themePresets[0].seeds).toBe(defaultThemeSeeds);
  });

  it('are told apart by id, label and accent', () => {
    for (const key of ['id', 'label'] as const) {
      expect(new Set(themePresets.map((preset) => preset[key])).size).toBe(themePresets.length);
    }
    expect(new Set(themePresets.map((preset) => preset.seeds.accent)).size).toBe(themePresets.length);
  });

  it('lists Graphite, Sage and Ink + paper after the four it re-tunes', () => {
    expect(themePresets.map((preset) => preset.id)).toEqual(['warm', 'slate', 'forest', 'plum', 'graphite', 'sage', 'ink-paper']);
  });

  it('gives Graphite a ground with next to no chroma, and Sage a tinted one with its deepest step as the accent', () => {
    const graphite = getThemePreset('graphite').seeds;
    expect(hexToLch(graphite.background).chroma).toBeLessThan(1);
    const sage = getThemePreset('sage').seeds;
    expect(sage.direction).toBe('blue-orange');
    expect(hexToLch(sage.background).chroma).toBeGreaterThan(8);
    expect(hueDistance(hexToLch(sage.accent).hue, hexToLch(sage.background).hue)).toBeLessThanOrEqual(10);
    for (const other of themePresets.filter((preset) => preset.id !== 'sage')) {
      expect(hexToLch(sage.accent).lightness).toBeLessThan(hexToLch(other.seeds.accent).lightness);
    }
  });

  it('is the three inks: `inkGhost` is gone from every theme', () => {
    for (const mode of MODES) {
      for (const seeds of [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS)]) {
        expect(Object.keys(generateRoles(seeds, mode))).not.toContain('inkGhost');
        expect(Object.keys(generateRoles(seeds, mode)).filter((role) => role.startsWith('ink')).sort()).toEqual(['ink', 'inkFaint', 'inkMuted']);
      }
    }
  });

  it.each(MODES)('clears 3:1 for `inkFaint` on `surface` and `paper`, below `inkMuted`, in %s mode', (mode) => {
    const seeds = [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS), ...Object.values(HUE_SEEDS)];
    const failures = seeds
      .map((one) => generateRoles(one, mode))
      .filter((roles) =>
        [roles.surface, roles.paper].some((ground) => contrastRatio(roles.inkFaint, ground) < 3) ||
        contrastRatio(roles.inkFaint, roles.paper) >= contrastRatio(roles.inkMuted, roles.paper));
    expect(failures).toEqual([]);
  });

  it.each(MODES.flatMap((mode) => LADDER_PRESETS.map((preset) => [preset.id, mode] as const)))(
    'passes every preset gate: the %s preset in %s mode',
    (id, mode) => {
      expect(brokenFloors(presetRoles(getThemePreset(id), mode), mode)).toEqual([]);
    },
  );

  it('clears 4.5:1 for every preset’s light `accent` on the light `paper`', () => {
    const failing = LADDER_PRESETS.filter((preset) => {
      const roles = generateRoles(preset.seeds);
      return contrastRatio(roles.accent, roles.paper) < 4.5;
    });
    expect(failing.map((preset) => preset.id)).toEqual([]);
  });

  describe.each(themePresets.map((preset) => [preset.id, preset] as const))(
    'the %s preset',
    (_id, preset) => {
      const roles = presetRoles(preset, 'light');

      it('keeps `record` legible as text on the grounds it is drawn on and its own band', () => {
        // WCAG 2.1 normal text: `record` marks figures, and those figures sit
        // inside the `record-wash` band too. Ink + paper draws them on cards.
        for (const background of [...(preset.ladder === 'ink-paper' ? [] : [roles.paper]), roles.surface, roles.recordWash]) {
          expect(contrastRatio(roles.record, background)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('keeps `record` a different hue from `accent`', () => {
        // "Your best ever" and "the button that commits" must not read as the
        // same mark. The shipped default sits 33° apart.
        expect(hueDistance(hexToLch(roles.record).hue, hexToLch(roles.accent).hue)).toBeGreaterThanOrEqual(30);
      });

      it('keeps the primary action\'s `onAccent` label legible on `accent`', () => {
        // A filled primary draws its label and glyph in `onAccent` (white).
        expect(contrastRatio(roles.onAccent, roles.accent)).toBeGreaterThanOrEqual(4.5);
      });
    },
  );
});

// The hue seeds an older stored custom hue (`hue:<deg>`) named. A record that
// still holds one is converted to custom colours on read (`theme-record.ts`).
describe('hue seeds', () => {
  const everyHue = Array.from({ length: 360 }, (_, hue) => hue);

  it.each(MODES)('meet every floor at every hue in %s mode', (mode) => {
    // The floors a preset is gated on, by construction: the user picks the
    // hue, lightness and chroma are fixed.
    const failures = everyHue
      .map((hue) => ({ hue, broken: brokenFloors(generateRoles(seedsFromHue(hue), mode), mode) }))
      .filter(({ broken }) => broken.length > 0);
    expect(failures).toEqual([]);
  });

  it('put both neutrals, the accent and the ramp on the picked hue', () => {
    const seeds = seedsFromHue(200);
    expect(seeds.text).toBe(seeds.background);
    for (const colour of [seeds.background, seeds.accent, generateRoles(seeds).viz4]) {
      expect(hueDistance(hexToLch(colour).hue, 200)).toBeLessThanOrEqual(3);
    }
  });

  it('keep `record` the shipped brass unless the accent comes near it, then step it away', () => {
    const brass = hexToLch('#8A6516').hue;
    expect(hueDistance(hexToLch(seedsFromHue(240).record).hue, brass)).toBeLessThanOrEqual(2);
    // Just below and just above the brass: `record` moves to the far side.
    expect(hexToLch(seedsFromHue(70).record).hue).toBeGreaterThan(brass);
    expect(hexToLch(seedsFromHue(95).record).hue).toBeLessThan(brass);
  });

  it('wrap and round the hue', () => {
    expect(seedsFromHue(-10)).toEqual(seedsFromHue(350));
    expect(seedsFromHue(360.4)).toEqual(seedsFromHue(0));
  });

  it('are stored as `hue:<deg>` and read back; anything else is not a hue', () => {
    expect(hueThemeId(47.4)).toBe('hue:47');
    expect(parseHueThemeId('hue:47')).toBe(47);
    expect(parseHueThemeId('hue:0')).toBe(0);
    for (const id of ['hue:360', 'hue:-5', 'hue:4.5', 'hue:', 'warm', 'hue:1000']) {
      expect(parseHueThemeId(id)).toBeNull();
    }
  });

  it('have a plain name all the way round the wheel', () => {
    expect([0, 30, 47, 80, 100, 140, 190, 260, 300, 330, 355].map(hueName)).toEqual([
      'Pink',
      'Red',
      'Orange',
      'Amber',
      'Olive',
      'Green',
      'Teal',
      'Blue',
      'Indigo',
      'Purple',
      'Pink',
    ]);
  });
});

// Every role as each preset and custom hue drew it before background and
// text were separate seeds (`fixtures/theme-roles-light.json`, generated from
// the one-`ground` generator). An untouched choice must draw the same theme,
// but for the roles since re-stepped on purpose: the grounds and hairlines
// (the ground ladder), `inkFaint` (three inks), `accent`, `record` and the
// washes (darkened to clear 4.5:1 on the lower `paper`) and the ramp that now
// follows the background. The calibration above pins those instead; `digest`
// covers the other roles.
const RESTEPPED_ROLES: readonly string[] = [
  'inkFaint', 'paper', 'surface', 'rule', 'ruleSoft', 'accent', 'accentWash', 'record', 'recordWash', 'recordRule',
  'viz1', 'viz2', 'viz3', 'viz4',
];
const LEGACY_ROLES = (Object.keys(themeRolesLight.presets.warm) as (keyof UiRoles)[]).filter(
  (role) => !RESTEPPED_ROLES.includes(role),
);

function legacyRoles(roles: UiRoles): Record<string, string> {
  return Object.fromEntries(LEGACY_ROLES.map((role) => [role, roles[role]]));
}

function drift(roles: UiRoles, before: Record<string, string>): string[] {
  return LEGACY_ROLES.filter((role) => role !== 'scrim' && deltaE(roles[role], before[role]) > 1).map(
    (role) => `${role}: ${before[role]} → ${roles[role]}`,
  );
}

describe('the presets and hue seeds', () => {
  it.each(Object.keys(themeRolesLight.presets) as (keyof typeof themeRolesLight.presets)[])('draws the %s preset as before (ΔE*ab ≤ 1)', (id) => {
    const roles = generateRoles(getThemePreset(id).seeds);
    expect(drift(roles, themeRolesLight.presets[id])).toEqual([]);
    expect(roles.scrim).toBe(themeRolesLight.presets[id].scrim);
  });

  it.each(Object.keys(themeRolesLight.hues))('draws %s as before (ΔE*ab ≤ 1)', (id) => {
    const roles = generateRoles(seedsFromHue(parseHueThemeId(id)!));
    expect(drift(roles, themeRolesLight.hues[id as keyof typeof themeRolesLight.hues])).toEqual([]);
  });

  it('draws every one of the 360 custom hues exactly as before', () => {
    const hash = createHash('sha256');
    for (let hue = 0; hue < 360; hue += 1) {
      hash.update(JSON.stringify(legacyRoles(generateRoles(seedsFromHue(hue)))));
    }
    expect(hash.digest('hex')).toBe(themeRolesLight.digest);
  });
});

// The floors every theme is gated on, in either mode (`design-language.md`
// §2): text on both grounds and on the ramp, `record` on its grounds, every
// on-colour role on its fill, the roles drawn as text on both grounds, the
// neutral ladder's order, the ramp's steps, and one value per role.
function brokenFloors(roles: UiRoles, mode: ThemeMode): string[] {
  const legible = (foreground: string, backgrounds: string[]) =>
    backgrounds.every((ground) => contrastRatio(foreground, ground) >= 4.5);
  const textRoles = ['accent', 'danger', 'gain', 'loss', 'regimeOlder', 'regimeNewer'] as const;
  const floors: [string, boolean][] = [
    ['ink on every ground', legible(roles.ink, [roles.well, roles.paper, roles.surface, roles.raised])],
    ['inkMuted on every ground', legible(roles.inkMuted, [roles.well, roles.paper, roles.surface, roles.raised])],
    ['ground ladder well < paper < surface < raised', isAscending([roles.well, roles.paper, roles.surface, roles.raised])],
    ['a card 4 L* off the page', lightnessOf(roles.surface) - lightnessOf(roles.paper) >= 4],
    ['ink on viz4', contrastRatio(roles.ink, roles.viz4) >= 4.5],
    ['ink on viz1', contrastRatio(roles.ink, roles.viz1) >= 3],
    ['record on paper/surface/recordWash', legible(roles.record, [roles.paper, roles.surface, roles.recordWash])],
    ['record hue away from accent', hueDistance(hexToLch(roles.record).hue, hexToLch(roles.accent).hue) >= 30],
    // Two roles that cannot be told apart are one role: the seeded marks stay
    // a visible step (ΔE*ab 5, about twice a just-noticeable difference) from
    // every fixed one, so a commit never looks like a delete or a change.
    ...(['accent', 'record'] as const).flatMap((seeded) =>
      FIXED_HUES.map((fixed): [string, boolean] => [`${seeded} apart from ${fixed}`, deltaE(roles[seeded], roles[fixed]) >= 5]),
    ),
    ...ON_COLOUR_ROLES.map((role): [string, boolean] => [
      `${role} on ${FILL_OF[role]}`,
      contrastRatio(roles[role], roles[FILL_OF[role]]) >= 4.5,
    ]),
    ...textRoles.map((role): [string, boolean] => [`${role} on paper/surface`, legible(roles[role], [roles.paper, roles.surface])]),
    ['neutral ladder order', isAscending(neutralLadder(roles, mode))],
    // A band and a row divider stay a visible step from the page and a card.
    ...(['accentWash', 'recordWash', 'ruleSoft'] as const).flatMap((role) =>
      (['paper', 'surface'] as const).map((ground): [string, boolean] => [
        `${role} ΔE*ab ≥ 2.5 from ${ground}`,
        deltaE(roles[role], roles[ground]) >= 2.5,
      ]),
    ),
    ['viz steps of 6 L*', vizSteps(roles, mode).every((stepSize) => stepSize >= 6)],
    ['one value per role', new Set(grounds(roles)).size === grounds(roles).length],
  ];
  return floors.filter(([, holds]) => !holds).map(([name]) => name);
}

// Ink + paper's floors (`brokenFloors`, for a ladder whose page is dark under
// light cards): text on the cards it is drawn on, every on-colour role on its
// fill, the bands and dividers apart from a card, the ramp's steps, and one
// value per role.
function brokenInkPaperFloors(roles: UiRoles): string[] {
  const legible = (foreground: string, backgrounds: string[]) =>
    backgrounds.every((ground) => contrastRatio(foreground, ground) >= 4.5);
  const textRoles = ['accent', 'record', 'danger', 'gain', 'loss', 'regimeOlder', 'regimeNewer'] as const;
  const floors: [string, boolean][] = [
    ['ink on viz4', contrastRatio(roles.ink, roles.viz4) >= 4.5],
    ['ink on viz1', contrastRatio(roles.ink, roles.viz1) >= 3],
    ['record on recordWash', legible(roles.record, [roles.recordWash])],
    ['record hue away from accent', hueDistance(hexToLch(roles.record).hue, hexToLch(roles.accent).hue) >= 30],
    ...(['accent', 'record'] as const).flatMap((seeded) =>
      FIXED_HUES.map((fixed): [string, boolean] => [`${seeded} apart from ${fixed}`, deltaE(roles[seeded], roles[fixed]) >= 5]),
    ),
    ...ON_COLOUR_ROLES.map((role): [string, boolean] => [`${role} on ${FILL_OF[role]}`, contrastRatio(roles[role], roles[FILL_OF[role]]) >= 4.5]),
    ...textRoles.map((role): [string, boolean] => [`${role} on surface and inset`, legible(roles[role], [roles.surface, roles.inset])]),
    ['card neutral ladder order', isAscending([roles.ink, roles.inkMuted, roles.inkFaint, roles.rule, roles.ruleSoft, roles.well, roles.inset, roles.viz0, roles.surface, roles.raised])],
    ...(['accentWash', 'recordWash', 'ruleSoft'] as const).map((role): [string, boolean] => [
      `${role} ΔE*ab ≥ 2.5 from surface`,
      deltaE(roles[role], roles.surface) >= 2.5,
    ]),
    ['viz steps of 6 L*', vizSteps(roles, 'light').every((stepSize) => stepSize >= 6)],
    ['one value per role', new Set(grounds(roles)).size === grounds(roles).length],
  ];
  return floors.filter(([, holds]) => !holds).map(([name]) => name);
}

// The neutrals from darkest to lightest. Light mode runs from `ink` up through
// the hairlines and the grounds to the white field (`ruleSoft` below the well,
// so a divider on the page still shows; the empty cell between the page and a
// card); dark mode from the
// sunken well up the grounds, then the empty cell, the hairlines and the inks
// to `ink`.
function neutralLadder(roles: UiRoles, mode: ThemeMode): string[] {
  if (mode === 'light') {
    return [roles.ink, roles.inkMuted, roles.inkFaint, roles.rule, roles.ruleSoft, roles.well, roles.paper, roles.viz0, roles.surface, roles.raised];
  }
  return [roles.well, roles.paper, roles.surface, roles.viz0, roles.raised, roles.ruleSoft, roles.rule, roles.inkFaint, roles.inkMuted, roles.ink];
}

const lightnessOf = (hex: string): number => hexToLch(hex).lightness;

// How far each step of the ramp moves away from the page in L*, `viz0` →
// `viz4`: darker on the light page, lighter on the dark one.
function vizSteps(roles: UiRoles, mode: ThemeMode): number[] {
  const ramp = [roles.viz0, roles.viz1, roles.viz2, roles.viz3, roles.viz4].map((hex) => hexToLch(hex).lightness);
  return ramp.slice(1).map((lightness, index) => (mode === 'light' ? ramp[index] - lightness : lightness - ramp[index]));
}

function isAscending(colours: string[]): boolean {
  const ladder = colours.map((hex) => hexToLch(hex).lightness);
  return ladder.every((lightness, index) => index === 0 || lightness > ladder[index - 1]);
}

// CIE76 ΔE*ab: Euclidean distance in L*a*b*. ~2.3 is a just-noticeable
// difference side by side.
function deltaE(first: string, second: string): number {
  const toLab = (hex: string) => {
    const { lightness, chroma, hue } = hexToLch(hex);
    const radians = (hue * Math.PI) / 180;
    return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  };
  const [a, b] = [toLab(first), toLab(second)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return distance > 180 ? 360 - distance : distance;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

it('keeps temporal regime identities distinct and readable across presets', () => {
  const roles = generateRoles(defaultThemeSeeds);
  expect(roles.regimeOlder).not.toBe(roles.regimeNewer);
  for (const colour of [roles.regimeOlder, roles.regimeNewer]) {
    expect(contrastRatio(colour, roles.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colour, roles.paper)).toBeGreaterThanOrEqual(4.5);
  }
});
