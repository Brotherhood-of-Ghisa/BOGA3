import { createHash } from 'crypto';

import { uiRoles } from '@/components/ui';
import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { defaultThemeSeeds, generateRoles, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { hueName, hueThemeId, parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';
import {
  BACKGROUND_CHROMA_CAP,
  BACKGROUND_TINTS,
  backgroundSwatches,
  TEXT_CHROMA_CAP,
  textInks,
  withNeutrals,
  type BackgroundChoice,
  type TextChoice,
} from '@/components/ui/theme-neutrals';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_PRESET_ID,
  resolveAppearance,
  themePresets,
} from '@/components/ui/theme-presets';

import themeRolesLight from './fixtures/theme-roles-light.json';

// The theme generator (`docs/specs/ui/design-language.md` §2, "Derivation"
// and "Presets"): every colour role is generated from five seeds. These tests
// pin that the default seeds reproduce the picked palette, that the rules the
// palette is gated on hold for every shipped preset and for seeds no preset
// ships, and that each preset's `accent` and `record` — used as given — meet
// their own floors.

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

  it('uses the accent and record seeds as given, and never themes danger, surface, filter selection or the on-colour roles', () => {
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

  describe.each(Object.entries({ ...PRESET_SEEDS, ...OTHER_SEEDS, ...HUE_SEEDS }))('for the %s seeds', (_name, seeds) => {
    const roles = generateRoles(seeds);

    it('gives no two roles the same value', () => {
      const values = grounds(roles);
      expect(new Set(values).size).toBe(values.length);
    });

    it('steps the neutrals in a fixed lightness order, each family on its own seed\'s hue', () => {
      const ladder = [
        roles.ink,
        roles.inkMuted,
        roles.inkFaint,
        roles.inkGhost,
        roles.rule,
        roles.ruleSoft,
        roles.viz0,
        roles.paper,
        roles.surface,
      ].map((hex) => hexToLch(hex).lightness);
      for (let index = 1; index < ladder.length; index += 1) {
        expect(ladder[index]).toBeGreaterThan(ladder[index - 1]);
      }
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

    it('darkens the viz ramp in even steps of at least 6 L*', () => {
      const ramp = [roles.viz0, roles.viz1, roles.viz2, roles.viz3, roles.viz4].map(
        (hex) => hexToLch(hex).lightness,
      );
      for (let index = 1; index < ramp.length; index += 1) {
        expect(ramp[index - 1] - ramp[index]).toBeGreaterThanOrEqual(6);
      }
    });

    it('tints each wash from its own role', () => {
      expect(hueDistance(hexToLch(roles.accentWash).hue, hexToLch(roles.accent).hue)).toBeLessThanOrEqual(10);
      expect(hueDistance(hexToLch(roles.recordWash).hue, hexToLch(roles.record).hue)).toBeLessThanOrEqual(10);
      expect(hexToLch(roles.accentWash).lightness).toBeGreaterThanOrEqual(95);
    });
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

describe('custom hue themes', () => {
  const everyHue = Array.from({ length: 360 }, (_, hue) => hue);

  it('meet every preset floor at every hue', () => {
    // The floors a preset is gated on, by construction: the user picks the
    // hue, lightness and chroma are fixed.
    const failures = everyHue.filter((hue) => {
      const roles = generateRoles(seedsFromHue(hue));
      return !(
        contrastRatio(roles.onAccent, roles.accent) >= 4.5 &&
        [roles.paper, roles.surface, roles.recordWash].every((ground) => contrastRatio(roles.record, ground) >= 4.5) &&
        hueDistance(hexToLch(roles.record).hue, hexToLch(roles.accent).hue) >= 30 &&
        new Set(grounds(roles)).size === grounds(roles).length
      );
    });
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

describe('an appearance with background and text left to match', () => {
  it.each(themePresets.map((preset) => [preset.id] as const))('draws the %s preset as before (ΔE*ab ≤ 1)', (id) => {
    const roles = generateRoles(resolveAppearance({ ...DEFAULT_APPEARANCE, accent: id }).seeds);
    expect(drift(roles, themeRolesLight.presets[id])).toEqual([]);
    expect(roles.scrim).toBe(themeRolesLight.presets[id].scrim);
  });

  it.each(Object.keys(themeRolesLight.hues))('draws %s as before (ΔE*ab ≤ 1)', (id) => {
    const roles = generateRoles(resolveAppearance({ ...DEFAULT_APPEARANCE, accent: id as `hue:${number}` }).seeds);
    expect(drift(roles, themeRolesLight.hues[id as keyof typeof themeRolesLight.hues])).toEqual([]);
  });

  it('draws every one of the 360 custom hues exactly as before', () => {
    const hash = createHash('sha256');
    for (let hue = 0; hue < 360; hue += 1) {
      const { seeds } = resolveAppearance({ ...DEFAULT_APPEARANCE, accent: hueThemeId(hue) });
      hash.update(JSON.stringify(legacyRoles(generateRoles(seeds))));
    }
    expect(hash.digest('hex')).toBe(themeRolesLight.digest);
  });
});

describe('background and text choices', () => {
  const customBackgrounds: BackgroundChoice[] = Array.from({ length: 12 }, (_, index) =>
    BACKGROUND_TINTS.map((tint) => ({ hue: index * 30 + 15, tint })),
  ).flat();
  const backgrounds: BackgroundChoice[] = ['match', ...backgroundSwatches.map((swatch) => swatch.id), ...customBackgrounds];
  const texts: TextChoice[] = ['match', ...textInks.map((ink) => ink.id)];
  // Every preset, and a custom accent every 15°.
  const accents = [
    ...themePresets.map((preset) => preset.seeds),
    ...Array.from({ length: 24 }, (_, index) => seedsFromHue(index * 15)),
  ];

  it('stay neutrals: chroma within the caps', () => {
    for (const swatch of backgroundSwatches) expect(swatch.chroma).toBeLessThanOrEqual(BACKGROUND_CHROMA_CAP);
    for (const ink of textInks) expect(ink.chroma).toBeLessThanOrEqual(TEXT_CHROMA_CAP);
    for (const background of backgrounds) {
      const { background: seed } = withNeutrals(defaultThemeSeeds, background, 'match');
      expect(hexToLch(seed).chroma).toBeLessThanOrEqual(BACKGROUND_CHROMA_CAP + 0.5);
    }
    for (const text of texts) {
      expect(hexToLch(withNeutrals(defaultThemeSeeds, 'match', text).text).chroma).toBeLessThanOrEqual(TEXT_CHROMA_CAP + 0.5);
    }
  });

  it('are told apart by id, label and colour', () => {
    for (const choices of [backgroundSwatches, textInks]) {
      for (const key of ['id', 'label'] as const) {
        expect(new Set(choices.map((choice) => choice[key])).size).toBe(choices.length);
      }
      const seeds = choices.map((choice) => lchToHex({ lightness: 42.4, chroma: choice.chroma, hue: choice.hue }));
      expect(new Set(seeds).size).toBe(choices.length);
    }
  });

  it('match: text takes the background, and the background the accent theme\'s own neutral', () => {
    const slate = themePresets[1].seeds;
    expect(withNeutrals(slate, 'match', 'match')).toEqual(slate);
    const sage = withNeutrals(slate, 'sage', 'match');
    expect(sage.text).toBe(sage.background);
    expect(sage.background).not.toBe(slate.background);
    const navy = withNeutrals(slate, 'match', 'navy');
    expect(navy.background).toBe(slate.background);
    expect(hueDistance(hexToLch(navy.text).hue, 265)).toBeLessThanOrEqual(3);
    // Accent, record and ramp never follow the neutrals.
    expect({ ...sage, background: undefined, text: undefined }).toEqual({ ...slate, background: undefined, text: undefined });
  });

  it('keep every floor over the background × text × accent grid', () => {
    const failures: string[] = [];
    for (const accentSeeds of accents) {
      for (const background of backgrounds) {
        for (const text of texts) {
          const roles = generateRoles(withNeutrals(accentSeeds, background, text));
          const broken = brokenFloors(roles);
          if (broken.length > 0) {
            failures.push(`${accentSeeds.accent} / ${JSON.stringify(background)} / ${text}: ${broken.join(', ')}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// The floors every theme is gated on (`design-language.md` §2): text on both
// grounds and on the ramp, `record` on its grounds, every on-colour role on
// its fill, the neutral ladder's order, and one value per role.
function brokenFloors(roles: UiRoles): string[] {
  const floors: [string, boolean][] = [
    ['ink on paper/surface', [roles.paper, roles.surface].every((ground) => contrastRatio(roles.ink, ground) >= 4.5)],
    ['inkMuted on paper/surface', [roles.paper, roles.surface].every((ground) => contrastRatio(roles.inkMuted, ground) >= 4.5)],
    ['ink on viz4', contrastRatio(roles.ink, roles.viz4) >= 4.5],
    ['ink on viz1', contrastRatio(roles.ink, roles.viz1) >= 3],
    [
      'record on paper/surface/recordWash',
      [roles.paper, roles.surface, roles.recordWash].every((ground) => contrastRatio(roles.record, ground) >= 4.5),
    ],
    ...ON_COLOUR_ROLES.map((role): [string, boolean] => [
      `${role} on ${FILL_OF[role]}`,
      contrastRatio(roles[role], roles[FILL_OF[role]]) >= 4.5,
    ]),
    ['neutral ladder order', isAscending([roles.ink, roles.inkMuted, roles.inkFaint, roles.inkGhost, roles.rule, roles.ruleSoft, roles.viz0, roles.paper, roles.surface])],
    ['one value per role', new Set(grounds(roles)).size === grounds(roles).length],
  ];
  return floors.filter(([, holds]) => !holds).map(([name]) => name);
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
