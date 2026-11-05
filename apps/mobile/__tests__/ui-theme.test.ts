import { createHash } from 'crypto';

import { uiRoles } from '@/components/ui';
import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { defaultThemeSeeds, generateRoles, type ThemeMode, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { hueName, hueThemeId, parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';
import { DEFAULT_THEME_PRESET_ID, getThemePreset, themePresets } from '@/components/ui/theme-presets';

import themeRolesLight from './fixtures/theme-roles-light.json';

// The theme generator (`docs/specs/ui/design-language.md` §2, "Derivation"
// and "Presets"): every colour role is generated from five seeds, on a light
// or a dark ladder. These tests pin that the default seeds reproduce the picked
// palette, that the rules the palette is gated on hold in both modes for every
// shipped preset and for seeds no preset ships, and that each preset's `accent`
// and `record` — used as given in light mode — meet their own floors. Custom
// themes are not gated (`ui-theme-custom.test.ts`).

// The palette as rationalised and picked on device, 2026-09-27. The generator
// was calibrated to it; a role drifting further than ΔE*ab 3 from it is a
// visible change and needs its own design decision.
const PICKED_PALETTE: Omit<UiRoles, 'scrim' | OnColourRole> = {
  ink: '#1B1712',
  inkMuted: '#6B6358',
  inkFaint: '#9B948A',
  inkGhost: '#BAB2A7',
  paper: '#F6F4EF',
  surface: '#FFFFFF',
  selection: '#000000',
  rule: '#E2DCD0',
  ruleSoft: '#EFEAE0',
  accent: '#C2410C',
  accentWash: '#FFF4EF',
  record: '#8A6516',
  recordWash: '#FBF3E2',
  recordRule: '#EEDFBE',
  danger: '#A4262C',
  regimeOlder: '#006C70',
  regimeNewer: '#7A286B',
  gain: '#15703F',
  loss: '#C01048',
  viz0: '#F0ECE7',
  viz1: '#E7D7CA',
  viz2: '#D3BDAB',
  viz3: '#BCA18A',
  viz4: '#A4866B',
};

// Seeds no preset ships with, chosen to pull the generator away from the
// shipped ones: a teal, an indigo and a rose ground, with accents, records and
// ramps on other parts of the wheel. They prove the generator, not a theme.
const OTHER_SEEDS: Record<string, ThemeSeeds> = {
  harbour: { background: '#5A6666', text: '#5A6666', accent: '#0F766E', record: '#8A6516', viz: '#5E8A88' },
  indigo: { background: '#5F5F6E', text: '#5F5F6E', accent: '#4F46E5', record: '#8A6516', viz: '#7472A0' },
  rose: { background: '#6A5F62', text: '#6A5F62', accent: '#B4235A', record: '#7A6A12', viz: '#9A7480' },
  // Background and text apart: a cool page under a warm ink.
  split: { background: '#5B6470', text: '#6B5848', accent: '#C2410C', record: '#8A6516', viz: '#A4866B' },
};

type OnColourRole = 'onAccent' | 'onSelection' | 'onDanger' | 'onInk';
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
function grounds(roles: UiRoles): string[] {
  return Object.entries(roles)
    .filter(([role]) => !ON_COLOUR_ROLES.includes(role as OnColourRole))
    .map(([, value]) => value);
}

const PRESET_SEEDS: Record<string, ThemeSeeds> = Object.fromEntries(
  themePresets.map((preset) => [`${preset.id} preset`, preset.seeds]),
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
    const accent = hexToLch('#C2410C');
    expect(accent.lightness).toBeCloseTo(46.0, 0);
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
  it('is what the app ships: `uiRoles` is the default seeds, generated', () => {
    expect(uiRoles).toEqual(generateRoles(defaultThemeSeeds));
  });

  it('reproduces the palette picked on device within ΔE*ab 3', () => {
    const generated = generateRoles(defaultThemeSeeds);
    const drift = Object.entries(PICKED_PALETTE)
      .map(([role, picked]) => ({ role, deltaE: deltaE(generated[role as keyof typeof PICKED_PALETTE], picked) }))
      .filter(({ deltaE: distance }) => distance > 3);
    expect(drift).toEqual([]);
  });

  it('in light mode, uses the accent and record seeds as given, and never themes danger, surface, filter selection or the on-colour roles', () => {
    for (const seeds of [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS)]) {
      const roles = generateRoles(seeds);
      expect(roles.accent).toBe(seeds.accent);
      expect(roles.record).toBe(seeds.record);
      expect(roles.danger).toBe('#A4262C');
      expect(roles.surface).toBe('#FFFFFF');
      expect(roles.selection).toBe('#000000');
      expect(roles.scrim).toBe(withAlpha(roles.ink, 0.42));
      for (const role of ON_COLOUR_ROLES) expect(roles[role]).toBe('#FFFFFF');
    }
  });

  it('tints the ground family from `background` and the ink family from `text`', () => {
    const { split } = OTHER_SEEDS;
    const roles = generateRoles(split);
    for (const role of ['paper', 'rule', 'ruleSoft', 'viz0'] as const) {
      expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(split.background).hue)).toBeLessThanOrEqual(10);
    }
    for (const role of ['ink', 'inkMuted', 'inkFaint', 'inkGhost'] as const) {
      expect(hueDistance(hexToLch(roles[role]).hue, hexToLch(split.text).hue)).toBeLessThanOrEqual(10);
    }
    expect(roles.scrim).toBe(withAlpha(roles.ink, 0.42));
    // Moving one seed leaves the other family where it was.
    const warm = generateRoles(defaultThemeSeeds);
    const coolPage = generateRoles({ ...defaultThemeSeeds, background: split.background });
    expect([coolPage.ink, coolPage.inkMuted, coolPage.inkFaint, coolPage.inkGhost]).toEqual([
      warm.ink,
      warm.inkMuted,
      warm.inkFaint,
      warm.inkGhost,
    ]);
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
      for (const neutral of [roles.inkMuted, roles.inkFaint, roles.inkGhost]) {
        expect(hueDistance(hexToLch(neutral).hue, hexToLch(seeds.text).hue)).toBeLessThanOrEqual(10);
      }
      expect(hueDistance(hexToLch(roles.rule).hue, hexToLch(seeds.background).hue)).toBeLessThanOrEqual(10);
    });

    it('keeps text legible: `ink` and `ink-muted` on both grounds, `ink` on every viz step', () => {
      for (const background of [roles.paper, roles.surface]) {
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
      if (mode === 'light') expect(hexToLch(roles.accentWash).lightness).toBeGreaterThanOrEqual(95);
      else expect(Math.abs(hexToLch(roles.accentWash).lightness - hexToLch(roles.paper).lightness)).toBeLessThanOrEqual(10);
    });
  });
});

describe('the dark ladder', () => {
  const SEEDS = [...Object.values(PRESET_SEEDS), ...Object.values(OTHER_SEEDS), ...Object.values(HUE_SEEDS)];

  it('lays the page at L* 10, lifts a card to L* 15, and draws `ink` at L* 95', () => {
    for (const seeds of SEEDS) {
      const roles = generateRoles(seeds, 'dark');
      expect(hexToLch(roles.paper).lightness).toBeCloseTo(10, 0);
      expect(hexToLch(roles.surface).lightness).toBeCloseTo(15, 0);
      expect(hexToLch(roles.ink).lightness).toBeCloseTo(95, 0);
    }
  });

  it('fixes danger, filter selection, the change directions, the regimes, the on-colour roles and the scrim', () => {
    for (const seeds of SEEDS) {
      const roles = generateRoles(seeds, 'dark');
      expect(roles).toMatchObject({
        selection: '#FFFFFF',
        danger: '#F7716B',
        gain: '#58AC76',
        loss: '#FF6881',
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

  describe.each(themePresets.map((preset) => [preset.id, preset.seeds] as const))(
    'the %s preset',
    (_id, seeds) => {
      const roles = generateRoles(seeds);

      it('keeps `record` legible as text on `paper`, `surface` and its own band', () => {
        // WCAG 2.1 normal text: `record` marks figures, and those figures sit
        // inside the `record-wash` band too.
        for (const background of [roles.paper, roles.surface, roles.recordWash]) {
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
    for (const seed of [seeds.background, seeds.accent, seeds.viz]) {
      expect(hueDistance(hexToLch(seed).hue, 200)).toBeLessThanOrEqual(3);
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
// the one-`ground` generator). An untouched choice must draw the same theme.
const LEGACY_ROLES = Object.keys(themeRolesLight.presets.warm) as (keyof UiRoles)[];

function legacyRoles(roles: UiRoles): Record<string, string> {
  return Object.fromEntries(LEGACY_ROLES.map((role) => [role, roles[role]]));
}

function drift(roles: UiRoles, before: Record<string, string>): string[] {
  return LEGACY_ROLES.filter((role) => role !== 'scrim' && deltaE(roles[role], before[role]) > 1).map(
    (role) => `${role}: ${before[role]} → ${roles[role]}`,
  );
}

describe('the presets and hue seeds', () => {
  it.each(themePresets.map((preset) => [preset.id] as const))('draws the %s preset as before (ΔE*ab ≤ 1)', (id) => {
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
    ['ink on paper/surface', legible(roles.ink, [roles.paper, roles.surface])],
    ['inkMuted on paper/surface', legible(roles.inkMuted, [roles.paper, roles.surface])],
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
    ['viz steps of 6 L*', vizSteps(roles, mode).every((stepSize) => stepSize >= 6)],
    ['one value per role', new Set(grounds(roles)).size === grounds(roles).length],
  ];
  return floors.filter(([, holds]) => !holds).map(([name]) => name);
}

// The neutrals from darkest to lightest. Light mode runs from `ink` up to the
// white card; dark mode from the dark page up to `ink`, with a card lifted a
// step above the page.
function neutralLadder(roles: UiRoles, mode: ThemeMode): string[] {
  const inkToGround = [roles.ink, roles.inkMuted, roles.inkFaint, roles.inkGhost, roles.rule, roles.ruleSoft, roles.viz0];
  return mode === 'light' ? [...inkToGround, roles.paper, roles.surface] : [roles.paper, roles.surface, ...inkToGround.reverse()];
}

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
