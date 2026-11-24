import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import {
  defaultThemeSeeds,
  DIRECTION_PAIRS,
  generateRoles,
  inkStep,
  paperLightness,
  rampLightness,
  THEME_DIRECTIONS,
  type ThemeDirection,
  type ThemeMode,
  type UiRoles,
} from '@/components/ui/theme';
import {
  chartInMode,
  chartOf,
  chartRamp,
  customFromSeeds,
  customInk,
  customMode,
  customSeed,
  customSeeds,
  drawnEnds,
  fillDefault,
  fillsInMode,
  gamutColour,
  GAMUT_SCALE,
  gamutPart,
  generateCustomRoles,
  highlightFromAccent,
  hueTurn,
  inksInMode,
  onGamutScale,
  ownInks,
  parseCustomColours,
  solidBars,
  untinted,
  type CustomChart,
  type CustomColours,
  type OwnInk,
} from '@/components/ui/theme-custom';
import { themePresets } from '@/components/ui/theme-presets';
import BEFORE_CHART_ROLES from './fixtures/custom-before-chart-roles.json';
import BEFORE_GAMUT_ROLES from './fixtures/custom-before-gamut-scale-roles.json';
import TEXT_CONTRAST_ROLES from './fixtures/custom-text-contrast-roles.json';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): a hue and
// strength per colour seed, the page's mode, lightness and depth, the texts'
// contrast and the direction. These tests pin that a preset converted to custom
// colours keeps its look, that a theme saved before a field existed draws as
// it did (but for the parts since removed), that the mode is the page's own,
// that depth and the secondary text's contrast each move only their roles,
// that the hairlines and the chart ramp follow the page, and what a stored
// value must hold. The highlight follows the accent unless it is given its
// own, and its contrast moves only its band. The secondary and the muted text
// step from the text seed until they are stored at their own L*, which then
// moves each alone. No readability floor is gated: custom colours are the
// user's.

const ROLE_COLOURS = (roles: UiRoles) =>
  Object.entries(roles).filter(([role]) => role !== 'scrim') as [keyof UiRoles, string][];

// CIE76 ΔE*ab between two hex colours.
function deltaE(a: string, b: string): number {
  const [x, y] = [hexToLch(a), hexToLch(b)];
  const lab = ({ lightness, chroma, hue }: typeof x) => [
    lightness,
    chroma * Math.cos((hue * Math.PI) / 180),
    chroma * Math.sin((hue * Math.PI) / 180),
  ];
  const [p, q] = [lab(x), lab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const WARM_LIGHT = customFromSeeds(defaultThemeSeeds, 'light');

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return distance > 180 ? 360 - distance : distance;
}

const withBackground = (colours: CustomColours, background: Partial<CustomColours['background']>): CustomColours => ({
  ...colours,
  background: { ...colours.background, ...background },
});

describe('a preset converted to custom colours', () => {
  it.each(themePresets.flatMap((preset) => (['light', 'dark'] as ThemeMode[]).map((mode) => [preset.id, mode, preset.seeds] as const)))(
    'keeps %s in %s within ΔE*ab 3 of every role',
    (id, mode, seeds) => {
      const preset = generateRoles(seeds, mode);
      const custom = generateCustomRoles(customFromSeeds(seeds, mode));
      // A light preset's accent is its seed as given; a custom accent is drawn
      // at the custom L* 43, which a darker preset accent (Plum's L* 39, Sage's
      // deepest step at 33, 14 from it) is further.
      const limit = (role: keyof UiRoles) => (mode === 'light' && role === 'accent' ? (id === 'sage' ? 14 : 7) : 3);
      const drift = ROLE_COLOURS(preset)
        .map(([role, hex]) => ({ role, delta: deltaE(hex, custom[role]) }))
        .filter(({ role, delta }) => delta > limit(role));
      expect(drift).toEqual([]);
    },
  );

  it('starts on the ladder’s page at the shipped depth', () => {
    expect(WARM_LIGHT.background).toMatchObject({ lightness: 92, depth: 100 });
    expect(customFromSeeds(defaultThemeSeeds, 'dark').background).toMatchObject({ lightness: 10, depth: 100 });
  });
});

describe('the page’s lightness', () => {
  it('runs from black to white', () => {
    expect(generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 0 })).paper).toBe('#000000');
    expect(generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 100, strength: 0 })).paper).toBe('#FFFFFF');
  });

  it('draws the ladder of its chosen mode, whatever its lightness', () => {
    expect(customMode(withBackground(WARM_LIGHT, { mode: 'dark', lightness: 80 }))).toBe('dark');
    const light = generateCustomRoles(withBackground(WARM_LIGHT, { mode: 'light', lightness: 30 }));
    const dark = generateCustomRoles({ ...withBackground(WARM_LIGHT, { mode: 'dark', lightness: 70 }), ink: { ...WARM_LIGHT.ink, lightness: 95 } });
    expect(hexToLch(light.ink).lightness).toBeLessThan(20);
    expect(hexToLch(dark.ink).lightness).toBeGreaterThan(80);
    expect(light.onAccent).toBe('#FFFFFF');
    expect(dark.onAccent).toBe('#000000');
  });

  it('keeps every ink between the page and the ink, in order', () => {
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 70 }));
    const lightness = (['paper', 'inkFaint', 'inkMuted', 'ink'] as const).map((role) => hexToLch(roles[role]).lightness);
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
  });
});

describe('depth', () => {
  const gap = (colours: CustomColours, role: keyof UiRoles) => {
    const roles = generateCustomRoles(colours);
    return Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);
  };
  const atDepth = (depth: number) => withBackground(WARM_LIGHT, { lightness: 70, depth });

  const spread = ['well', 'surface', 'raised', 'viz0'] as const;

  it('flattens the grounds and empty cells onto the page at 0', () => {
    const roles = generateCustomRoles(atDepth(0));
    expect(spread.map((role) => hexToLch(roles[role]).lightness)).toEqual(
      Array(spread.length).fill(expect.closeTo(hexToLch(roles.paper).lightness, 0)),
    );
  });

  it.each(spread)('spreads %s further from the page as it grows', (role) => {
    expect(gap(atDepth(200), role)).toBeGreaterThan(gap(atDepth(100), role));
    expect(gap(atDepth(100), role)).toBeGreaterThan(gap(atDepth(50), role));
  });

  it('leaves the inks, accent and ramp where they are', () => {
    const flat = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 0 }));
    const deep = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 300 }));
    (['ink', 'inkMuted', 'inkFaint', 'accent', 'record', 'viz1', 'viz4', 'danger', 'gain'] as const).forEach((role) =>
      expect(deep[role]).toBe(flat[role]),
    );
  });
});

describe('borders', () => {
  const HAIRLINES = ['rule', 'ruleSoft'] as const;
  const GROUNDS = ['well', 'surface', 'raised', 'viz0'] as const;
  const page = (borders: number | undefined, depth = 100) => withBackground(WARM_LIGHT, { lightness: 70, depth, borders });
  const gap = (colours: CustomColours, role: keyof UiRoles) => {
    const roles = generateCustomRoles(colours);
    return Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);
  };

  it('draws a theme without borders as it drew it, whatever its depth, even with the legacy top-level key', () => {
    [0, 40, 100, 300].forEach((depth) => {
      const stored = JSON.parse(JSON.stringify(page(undefined, depth)));
      const legacy = { ...stored, borders: { hue: 10, strength: 50 } };
      expect(parseCustomColours(stored)!.background.borders).toBeUndefined();
      expect(generateCustomRoles(parseCustomColours(legacy)!)).toEqual(generateCustomRoles(page(depth, depth)));
      expect(generateCustomRoles(parseCustomColours(stored)!)).toEqual(generateCustomRoles(page(depth, depth)));
    });
  });

  it('flattens the hairlines onto the page at 0 and spreads them as it grows', () => {
    HAIRLINES.forEach((role) => {
      expect(gap(page(0), role)).toBeCloseTo(0, 0);
      expect(gap(page(300), role)).toBeGreaterThan(gap(page(100), role));
      expect(gap(page(100), role)).toBeGreaterThan(gap(page(50), role));
    });
  });

  it('moves the hairlines only', () => {
    const [flat, shipped, wide] = [0, 100, 300].map((borders) => generateCustomRoles(page(borders)));
    const changed = (a: UiRoles, b: UiRoles) => (Object.keys(a) as (keyof UiRoles)[]).filter((role) => a[role] !== b[role]);
    expect(changed(flat, shipped).sort()).toEqual([...HAIRLINES].sort());
    expect(changed(shipped, wide).sort()).toEqual([...HAIRLINES].sort());
  });

  it('leaves the hairlines where they are when depth moves, and moves the grounds and `viz0`', () => {
    const [flat, deep] = [0, 300].map((depth) => generateCustomRoles(page(100, depth)));
    HAIRLINES.forEach((role) => expect(deep[role]).toBe(flat[role]));
    GROUNDS.forEach((role) => expect(deep[role]).not.toBe(flat[role]));
  });

  it('reads a stored value, and rejects one out of range or not whole', () => {
    expect(parseCustomColours(JSON.parse(JSON.stringify(page(250))))!.background.borders).toBe(250);
    expect(parseCustomColours(JSON.parse(JSON.stringify(page(0))))!.background.borders).toBe(0);
    [301, -1, 12.5, '100', null].forEach((borders) =>
      expect(parseCustomColours(withBackground(WARM_LIGHT, { borders: borders as never }))).toBeNull(),
    );
  });
});

describe('the ground ladder on a custom page', () => {
  it.each(['light', 'dark'] as ThemeMode[])('keeps well < paper < surface < raised in %s, each tinted by the page', (mode) => {
    const colours = withBackground(customFromSeeds(defaultThemeSeeds, mode), { hue: 200, strength: 60 });
    const roles = generateCustomRoles(colours);
    const ladder = [roles.well, roles.paper, roles.surface, roles.raised].map((hex) => hexToLch(hex));
    ladder.slice(1).forEach((ground, index) => expect(ground.lightness).toBeGreaterThan(ladder[index].lightness));
    // A tinted page has tinted cards and fields, and a tinted well under it,
    // where the ground's L* holds enough chroma to carry a hue.
    const tinted = ladder.filter(({ chroma }) => chroma >= 2);
    expect(tinted.length).toBeGreaterThanOrEqual(mode === 'dark' ? 4 : 2);
    for (const ground of tinted) expect(Math.abs(ground.hue - hexToLch(roles.paper).hue)).toBeLessThanOrEqual(10);
  });
});

describe('the hairlines and the chart ramp', () => {
  it.each(['light', 'dark'] as ThemeMode[])('take the page’s hue in %s, and are no part of their own', (mode) => {
    const colours = withBackground(customFromSeeds(defaultThemeSeeds, mode), { hue: 200, strength: 60 });
    const roles = generateCustomRoles(colours);
    const offHue = (['rule', 'ruleSoft', 'viz1', 'viz2', 'viz3', 'viz4'] as const).filter((role) => hueDistance(hexToLch(roles[role]).hue, 200) > 10);
    expect(offHue).toEqual([]);
    expect(Object.keys(colours)).not.toContain('borders');
    expect(Object.keys(colours)).not.toContain('viz');
  });

  it.each(['light', 'dark'] as ThemeMode[])('keep “more” stronger on a custom page in %s: each step further from the page', (mode) => {
    const roles = generateCustomRoles(customFromSeeds(defaultThemeSeeds, mode));
    const gaps = (['viz0', 'viz1', 'viz2', 'viz3', 'viz4'] as const).map((role) => Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness));
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
  });

  it('keep the ramp on the picked hue at a low strength, where the page’s hex holds none', () => {
    for (const hue of [30, 80, 200, 330]) {
      const offHue = [0, 1, 2, 3, 5].filter((strength) => {
        const roles = generateCustomRoles(withBackground(WARM_LIGHT, { hue, strength }));
        return hueDistance(hexToLch(roles.viz4).hue, hue) > 10;
      });
      expect({ hue, offHue }).toEqual({ hue, offHue: [] });
    }
  });

  it('keep a tinted ramp on a grey page', () => {
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { strength: 0 }));
    expect(hexToLch(roles.paper).chroma).toBeLessThan(1);
    expect(hexToLch(roles.viz4).chroma).toBeGreaterThanOrEqual(10);
  });
});

describe('highlight', () => {
  const withHighlight = (highlight: Partial<CustomColours['highlight']>, base = WARM_LIGHT): CustomColours => ({
    ...base,
    highlight: { ...base.highlight, ...highlight },
  });
  const gap = (colours: CustomColours) => {
    const roles = generateCustomRoles(colours);
    return Math.abs(hexToLch(roles.accentWash).lightness - hexToLch(roles.paper).lightness);
  };

  it('starts matching the accent when a preset is converted', () => {
    expect(WARM_LIGHT.highlight).toMatchObject({ match: true, contrast: 100 });
  });

  it('takes the accent’s band while it matches, whatever its own hue and strength', () => {
    const matched = generateCustomRoles(withHighlight({ hue: 150, strength: 100 }));
    expect(matched.accentWash).toBe(generateCustomRoles(WARM_LIGHT).accentWash);
  });

  it.each(['light', 'dark'] as const)('takes its own hue and strength when it does not match, and moves only the band, in %s', (mode) => {
    const base = customFromSeeds(defaultThemeSeeds, mode);
    const before = generateCustomRoles(base);
    const own = generateCustomRoles(withHighlight({ match: false, hue: 150, strength: 100 }, base));
    expect(hexToLch(own.accentWash).hue).toBeCloseTo(150, -1);
    expect(hexToLch(own.accentWash).chroma).toBeGreaterThan(hexToLch(before.accentWash).chroma);
    expect(hexToLch(own.accentWash).lightness).toBeCloseTo(hexToLch(before.accentWash).lightness, 0);
    const moved = (Object.keys(before) as (keyof UiRoles)[]).filter((role) => before[role] !== own[role]);
    expect(moved).toEqual(['accentWash']);
  });

  it.each(['light', 'dark'] as const)('changes nearly nothing when unmatched at the hue and strength it starts from, in %s', (mode) => {
    const base = customFromSeeds(defaultThemeSeeds, mode);
    const { hue, strength } = highlightFromAccent(customSeed('accent', base.accent), mode);
    const own = generateCustomRoles(withHighlight({ match: false, hue, strength }, base)).accentWash;
    expect(deltaE(own, generateCustomRoles(base).accentWash)).toBeLessThan(1.5);
  });

  it('flattens onto the page at a contrast of 0, steps further as it grows, and moves only the band', () => {
    expect(gap(withHighlight({ contrast: 0 }))).toBeLessThan(0.5);
    expect(gap(withHighlight({ contrast: 250 }))).toBeGreaterThan(gap(withHighlight({ contrast: 100 })));
    const [soft, hard] = [generateCustomRoles(withHighlight({ contrast: 30 })), generateCustomRoles(withHighlight({ contrast: 250 }))];
    expect((Object.keys(soft) as (keyof UiRoles)[]).filter((role) => soft[role] !== hard[role])).toEqual(['accentWash']);
  });

  it('is a grey at a strength of 0', () => {
    expect(hexToLch(generateCustomRoles(withHighlight({ match: false, strength: 0 })).accentWash).chroma).toBeLessThan(1);
  });
});

describe('hue and strength', () => {
  it('takes each part’s hue', () => {
    const roles = generateCustomRoles({ ...withBackground(WARM_LIGHT, { hue: 150, strength: 30 }), accent: { hue: 250, strength: 80 } });
    expect(hexToLch(roles.accent).hue).toBeCloseTo(250, -1);
    expect(hexToLch(roles.paper).hue).toBeCloseTo(150, -1);
    expect(hexToLch(roles.viz4).hue).toBeCloseTo(150, -1);
  });

  it('draws a strength of 0 as a grey', () => {
    expect(hexToLch(customSeed('accent', { hue: 30, strength: 0 })).chroma).toBeLessThan(1);
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { strength: 0 }));
    expect(hexToLch(roles.paper).chroma).toBeLessThan(1);
  });

  it('tints the cards with the page', () => {
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 80, hue: 200, strength: 100 }));
    expect(hexToLch(roles.surface).chroma).toBeGreaterThan(5);
    expect(hexToLch(roles.surface).hue).toBeCloseTo(hexToLch(roles.paper).hue, -1);
  });
});

describe('primary text', () => {
  it('tints `ink` alone, at its own hue, and leaves the secondary inks to the text', () => {
    const base = generateCustomRoles(WARM_LIGHT);
    const navy = generateCustomRoles({ ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, hue: 280, strength: 100 } });
    expect(hexToLch(navy.ink).hue).toBeCloseTo(280, -1);
    expect(hexToLch(navy.ink).chroma).toBeGreaterThan(hexToLch(base.ink).chroma + 10);
    expect(hexToLch(navy.ink).lightness).toBeCloseTo(hexToLch(base.ink).lightness, 0);
    (['inkMuted', 'inkFaint', 'paper', 'accent'] as const).forEach((role) => expect(navy[role]).toBe(base[role]));
  });

  it.each([30, 140, 200, 280])('strengthens hue %i over the whole slider, to the most its L* holds', (hue) => {
    const at = (strength: number) => hexToLch(generateCustomRoles({ ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, hue, strength } }).ink).chroma;
    expect(at(50)).toBeGreaterThan(at(25));
    expect(at(100)).toBeGreaterThan(at(75));
  });

  it('is a grey at a strength of 0, on a light or a dark page', () => {
    for (const mode of ['light', 'dark'] as const) {
      const colours = customFromSeeds(defaultThemeSeeds, mode);
      const roles = generateCustomRoles({ ...colours, ink: { ...colours.ink, hue: 280, strength: 0 } });
      expect(hexToLch(roles.ink).chroma).toBeLessThan(1);
    }
  });

  it('starts from the text’s hue when a preset is converted', () => {
    expect(WARM_LIGHT.ink.hue).toBe(WARM_LIGHT.text.hue);
  });
});

describe('primary text’s lightness', () => {
  it('draws `ink` at the chosen L*, and leaves every other role where the ladder’s `ink` put it', () => {
    const base = generateCustomRoles(WARM_LIGHT);
    const paler = generateCustomRoles({ ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 30.25 } });
    expect(hexToLch(paler.ink).lightness).toBeCloseTo(30.25, 0);
    const moved = (Object.keys(base) as (keyof UiRoles)[]).filter((role) => base[role] !== paler[role]);
    // The light backdrop is `ink` at 42%; text on the page is the inks.
    expect(moved.sort()).toEqual(['ink', 'pageInk', 'scrim']);
  });

  it('keeps its hue and strength as a share of what its L* holds', () => {
    const roles = generateCustomRoles({ ...WARM_LIGHT, ink: { hue: 280, strength: 100, lightness: 30 } });
    expect(roles.ink).toBe(gamutColour(30, { hue: 280, strength: 100 }));
  });
});

describe('secondary text’s contrast', () => {
  const atContrast = (contrast: number) => generateCustomRoles({ ...WARM_LIGHT, text: { ...WARM_LIGHT.text, contrast } });
  const gap = (roles: UiRoles, role: keyof UiRoles) => Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);

  it.each(['inkMuted', 'inkFaint'] as const)('moves %s toward the page below 100 and away above', (role) => {
    expect(gap(atContrast(50), role)).toBeLessThan(gap(atContrast(100), role));
    expect(gap(atContrast(150), role)).toBeGreaterThan(gap(atContrast(100), role));
    expect(gap(atContrast(0), role)).toBeLessThan(0.5);
  });

  it('moves the secondary inks alone', () => {
    const [low, high] = [atContrast(40), atContrast(140)];
    const moved = (Object.keys(low) as (keyof UiRoles)[]).filter((role) => low[role] !== high[role]);
    expect(moved.sort()).toEqual(['inkFaint', 'inkMuted', 'pageInkFaint', 'pageInkMuted']);
  });

  it('never takes them past the primary text', () => {
    const colours = { ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 40 }, text: { ...WARM_LIGHT.text, contrast: 150 } };
    const roles = generateCustomRoles(colours);
    expect(hexToLch(roles.inkMuted).lightness).toBeGreaterThanOrEqual(hexToLch(roles.ink).lightness - 0.5);
  });
});

describe('secondary and muted text', () => {
  // Every role but the scrim (`ROLE_COLOURS`) that differs between two themes.
  const changed = (before: CustomColours, after: CustomColours) => {
    const [a, b] = [generateCustomRoles(before), generateCustomRoles(after)];
    return (Object.keys(a) as (keyof UiRoles)[]).filter((role) => a[role] !== b[role]).sort();
  };
  // Stored at their own L*, as the editor's first move stores them.
  const owned = (colours: CustomColours): CustomColours => ({ ...colours, ...ownInks(colours) });
  const DARK = customFromSeeds(themePresets[1].seeds, 'dark');

  it('draws a theme stored with only the text contrast byte for byte as the build before them', () => {
    const drift = TEXT_CONTRAST_ROLES.cases.filter(({ stored, roles }) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(stored)))!;
      return JSON.stringify(generateCustomRoles(read)) !== JSON.stringify(roles);
    });
    expect(TEXT_CONTRAST_ROLES.cases.length).toBeGreaterThanOrEqual(48);
    expect(new Set(TEXT_CONTRAST_ROLES.cases.map(({ stored }) => stored.background.mode))).toEqual(new Set(['light', 'dark']));
    expect(new Set(TEXT_CONTRAST_ROLES.cases.map(({ stored }) => stored.text.contrast))).toEqual(new Set([0, 40, 100, 150]));
    expect(drift).toEqual([]);
  });

  it('stores the inks as drawn: the conversion repaints nothing, on any preset, mode, page or contrast', () => {
    const drift = TEXT_CONTRAST_ROLES.cases.filter(({ stored }) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(stored)))!;
      const converted = parseCustomColours(JSON.parse(JSON.stringify(owned(read))))!;
      return JSON.stringify(generateCustomRoles(converted)) !== JSON.stringify(generateCustomRoles(read));
    });
    expect(drift).toEqual([]);
  });

  it('keeps what is already stored when converting', () => {
    const secondary: OwnInk = { hue: 12.5, strength: 33.3, lightness: 61 };
    expect(ownInks({ ...WARM_LIGHT, secondary })).toEqual({ secondary, muted: ownInks(WARM_LIGHT).muted });
  });

  it.each([
    ['light', WARM_LIGHT],
    ['dark', DARK],
  ] as const)('on a %s page, moves each control of each only its own role and its page ink', (_mode, base) => {
    const start = owned(base);
    const edits: [keyof OwnInk, number][] = [
      ['hue', (start.secondary!.hue + 120) % 360],
      ['strength', 100],
      ['lightness', 50],
    ];
    edits.forEach(([field, value]) => {
      expect(changed(start, { ...start, secondary: { ...start.secondary!, [field]: value } })).toEqual(['inkMuted', 'pageInkMuted']);
      expect(changed(start, { ...start, muted: { ...start.muted!, [field]: value } })).toEqual(['inkFaint', 'pageInkFaint']);
    });
  });

  it('draws each at its own hue and strength, a share of the most chroma its L* holds', () => {
    const roles = generateCustomRoles({ ...WARM_LIGHT, secondary: { hue: 140, strength: 100, lightness: 55 }, muted: { hue: 20, strength: 50, lightness: 70 } });
    expect(roles.inkMuted).toBe(gamutColour(55, { hue: 140, strength: 100 }));
    expect(roles.inkFaint).toBe(gamutColour(70, { hue: 20, strength: 50 }));
    expect([roles.pageInkMuted, roles.pageInkFaint]).toEqual([roles.inkMuted, roles.inkFaint]);
  });

  it.each(['light', 'dark'] as const)('accepts a lightness of 0 and 100 on a %s page, with no limit against `ink` or each other', (mode) => {
    const base = customFromSeeds(defaultThemeSeeds, mode);
    [0, 100].forEach((lightness) => {
      const colours = { ...base, secondary: { hue: 50, strength: 40, lightness }, muted: { hue: 50, strength: 40, lightness: 100 - lightness } };
      const read = parseCustomColours(JSON.parse(JSON.stringify(colours)))!;
      expect(read).toEqual(colours);
      const roles = generateCustomRoles(read);
      expect(hexToLch(roles.inkMuted).lightness).toBeCloseTo(lightness, 0);
      expect(hexToLch(roles.inkFaint).lightness).toBeCloseTo(100 - lightness, 0);
    });
  });

  it('ignores the text contrast once both are stored', () => {
    const start = owned(WARM_LIGHT);
    expect(changed(start, { ...start, text: { ...start.text, contrast: 150 } })).toEqual([]);
  });

  it('puts the stored ones at the new ladder’s L* when the mode is switched, and leaves the rest absent', () => {
    const start = owned(WARM_LIGHT);
    expect(inksInMode(start, 'dark')).toEqual({
      secondary: { ...start.secondary, lightness: inkStep('dark', 'inkMuted').lightness },
      muted: { ...start.muted, lightness: inkStep('dark', 'inkFaint').lightness },
    });
    expect(inksInMode(WARM_LIGHT, 'dark')).toEqual({});
  });

  it('starts absent when a preset is converted', () => {
    expect(WARM_LIGHT.secondary).toBeUndefined();
    expect(WARM_LIGHT.muted).toBeUndefined();
  });
});

describe('the chart', () => {
  const RAMP = ['viz1', 'viz2', 'viz3', 'viz4'] as const;
  const changed = (before: CustomColours, after: CustomColours) => {
    const [a, b] = [generateCustomRoles(before), generateCustomRoles(after)];
    return (Object.keys(a) as (keyof UiRoles)[]).filter((role) => a[role] !== b[role]).sort();
  };
  const chosen = (start: OwnInk, end: OwnInk, base = WARM_LIGHT): CustomColours => ({ ...base, chart: { follow: false, solid: false, start, end } });
  // Where a ramp step should sit: a share of the way from start to end in LCh.
  const between = (start: OwnInk, end: OwnInk, share: number) => {
    const lch = (end: OwnInk) => ({ ...end, chroma: hexToLch(gamutColour(end.lightness, end)).chroma });
    const [a, b] = [lch(start), lch(end)];
    // A grey end shows no hue: the steps take the other end's.
    const [from, to] = [a.chroma < 0.5 ? b.hue : a.hue, b.chroma < 0.5 ? a.hue : b.hue];
    return {
      lightness: a.lightness + share * (b.lightness - a.lightness),
      chroma: a.chroma + share * (b.chroma - a.chroma),
      hue: (((from + share * hueTurn(from, to)) % 360) + 360) % 360,
    };
  };

  it('draws a theme stored without it byte for byte as the build before it, the legacy `viz` key ignored', () => {
    const drift = BEFORE_CHART_ROLES.cases.filter(({ stored, roles }) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(stored)))!;
      return read.chart !== undefined || JSON.stringify(generateCustomRoles(read)) !== JSON.stringify(roles);
    });
    expect(BEFORE_CHART_ROLES.cases.length).toBeGreaterThanOrEqual(56);
    expect(BEFORE_CHART_ROLES.cases.filter(({ stored }) => 'viz' in stored).length).toBeGreaterThan(0);
    expect(new Set(BEFORE_CHART_ROLES.cases.map(({ stored }) => stored.background.mode))).toEqual(new Set(['light', 'dark']));
    expect(drift).toEqual([]);
  });

  it('draws the page’s ramp while it follows the background, with Solid bars on or off', () => {
    BEFORE_CHART_ROLES.cases.forEach(({ stored, roles }) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(stored)))!;
      [false, true].forEach((solid) => {
        const followed = { ...read, chart: { ...chartOf(read), solid, start: { hue: 10, strength: 90, lightness: 30 } } };
        expect(JSON.stringify(generateCustomRoles(followed))).toBe(JSON.stringify(roles));
      });
    });
  });

  it('starts following the background with steps on the bars, its ends as drawn', () => {
    const chart = chartOf(WARM_LIGHT);
    expect(chart).toMatchObject({ follow: true, solid: false });
    expect(chart).toEqual({ follow: true, solid: false, ...drawnEnds(WARM_LIGHT) });
    expect(solidBars(WARM_LIGHT)).toBe(false);
    expect(solidBars({ chart: { ...chart, solid: true } })).toBe(true);
    const stored: CustomChart = { follow: false, solid: true, start: { hue: 1, strength: 2, lightness: 3 }, end: { hue: 4, strength: 5, lightness: 6 } };
    expect(chartOf({ ...WARM_LIGHT, chart: stored })).toBe(stored);
  });

  it.each(themePresets.flatMap((preset) => (['light', 'dark'] as ThemeMode[]).map((mode) => [preset.id, mode, preset.seeds] as const)))(
    'repaints neither end when %s in %s leaves the page’s ramp at its ends as drawn',
    (_id, mode, seeds) => {
      const base = customFromSeeds(seeds, mode);
      const before = generateCustomRoles(base);
      const after = generateCustomRoles({ ...base, chart: { follow: false, solid: false, ...drawnEnds(base) } });
      expect([after.viz1, after.viz4]).toEqual([before.viz1, before.viz4]);
      expect(changed(base, { ...base, chart: { follow: false, solid: false, ...drawnEnds(base) } }).every((role) => role === 'viz2' || role === 'viz3')).toBe(true);
    },
  );

  it('draws the chosen start and end exactly, and nothing else but the steps between', () => {
    const start = { hue: 200, strength: 40, lightness: 88 };
    const end = { hue: 280, strength: 70, lightness: 45 };
    const roles = generateCustomRoles(chosen(start, end));
    expect(roles.viz1).toBe(gamutColour(88, start));
    expect(roles.viz4).toBe(gamutColour(45, end));
    expect(changed(WARM_LIGHT, chosen(start, end))).toEqual([...RAMP]);
    expect(roles.viz0).toBe(generateCustomRoles(WARM_LIGHT).viz0);
  });

  it.each([
    ['a light', { hue: 200, strength: 40, lightness: 88 }, { hue: 280, strength: 70, lightness: 45 }],
    ['a dark', { hue: 60, strength: 30, lightness: 26 }, { hue: 20, strength: 60, lightness: 50 }],
    ['a grey-to-colour', { hue: 90, strength: 0, lightness: 90 }, { hue: 150, strength: 50, lightness: 55 }],
  ])('puts `viz2` and `viz3` a third and two thirds of the way in LCh, on %s ramp', (_name, start, end) => {
    const roles = chartRamp({ start, end });
    ([['viz2', 1 / 3], ['viz3', 2 / 3]] as const).forEach(([role, share]) => {
      const drawn = hexToLch(roles[role]);
      const expected = between(start, end, share);
      expect(Math.abs(drawn.lightness - expected.lightness)).toBeLessThan(0.5);
      expect(Math.abs(drawn.chroma - expected.chroma)).toBeLessThan(0.8);
      if (expected.chroma > 5) expect(hueDistance(drawn.hue, expected.hue)).toBeLessThan(1.5);
    });
  });

  it.each([
    ['start', { hue: 270, strength: 0, lightness: 90 }, { hue: 40, strength: 80, lightness: 50 }],
    ['end', { hue: 40, strength: 80, lightness: 85 }, { hue: 270, strength: 0, lightness: 30 }],
  ])('keeps the steps on the coloured end’s hue when the %s is a grey, whatever its hue slider says', (_grey, start, end) => {
    const roles = chartRamp({ start, end });
    (['viz2', 'viz3'] as const).forEach((role) => {
      const drawn = hexToLch(roles[role]);
      expect(drawn.chroma).toBeGreaterThan(5);
      expect(hueDistance(drawn.hue, 40)).toBeLessThan(3);
    });
  });

  it('takes the hue the short way round, across 0/360 either way', () => {
    const at = (hue: number) => ({ hue, strength: 60, lightness: 60 });
    const up = chartRamp({ start: at(340), end: at(20) });
    expect(hueDistance(hexToLch(up.viz2).hue, 353.33)).toBeLessThan(1.5);
    expect(hueDistance(hexToLch(up.viz3).hue, 6.67)).toBeLessThan(1.5);
    const down = chartRamp({ start: at(20), end: at(340) });
    expect(hueDistance(hexToLch(down.viz2).hue, 6.67)).toBeLessThan(1.5);
    expect(hueDistance(hexToLch(down.viz3).hue, 353.33)).toBeLessThan(1.5);
  });

  it('turns the short way, and up through rising hue when the ends are opposite', () => {
    expect(hueTurn(340, 20)).toBe(40);
    expect(hueTurn(20, 340)).toBe(-40);
    expect(hueTurn(10, 190)).toBe(180);
    expect(hueTurn(190, 10)).toBe(180);
    expect(hueTurn(0, 180)).toBe(180);
    expect(hueTurn(30, 30)).toBe(0);
    const opposite = chartRamp({ start: { hue: 0, strength: 50, lightness: 60 }, end: { hue: 180, strength: 50, lightness: 60 } });
    expect(hueDistance(hexToLch(opposite.viz2).hue, 60)).toBeLessThan(2);
  });

  it('moves each control of each end only the ramp', () => {
    const start = chosen({ hue: 200, strength: 40, lightness: 88 }, { hue: 280, strength: 70, lightness: 45 });
    (['start', 'end'] as const).forEach((which) => {
      ([['hue', 30], ['strength', 90], ['lightness', 60]] as const).forEach(([field, value]) => {
        const moved = { ...start, chart: { ...start.chart!, [which]: { ...start.chart![which], [field]: value } } };
        const roles = changed(start, moved);
        expect(roles.length).toBeGreaterThan(0);
        expect(roles.every((role) => (RAMP as readonly string[]).includes(role))).toBe(true);
      });
    });
  });

  it('puts the ends at the new ladder’s `viz1` and `viz4` L* when the mode is switched, and stores none it had not', () => {
    const start = chosen({ hue: 200, strength: 40, lightness: 88 }, { hue: 280, strength: 70, lightness: 45 });
    expect(chartInMode(start, 'dark')).toEqual({
      chart: { ...start.chart, start: { ...start.chart!.start, lightness: rampLightness('dark', 'viz1') }, end: { ...start.chart!.end, lightness: rampLightness('dark', 'viz4') } },
    });
    expect(rampLightness('light', 'viz1')).toBe(87);
    expect(chartInMode(WARM_LIGHT, 'dark')).toEqual({});
  });

  it('round-trips through the store, unrounded', () => {
    const chart: CustomChart = { follow: false, solid: true, start: { hue: 359.5, strength: 12.345, lightness: 0 }, end: { hue: 0, strength: 100, lightness: 100 } };
    expect(parseCustomColours(JSON.parse(JSON.stringify({ ...WARM_LIGHT, chart })))).toEqual({ ...WARM_LIGHT, chart });
  });

  const END = { hue: 10, strength: 10, lightness: 50 };
  const CHART = { follow: true, solid: false, start: END, end: END };
  it.each([
    ['null', null],
    ['not an object', true],
    ['no follow', { solid: false, start: END, end: END }],
    ['a follow that is not a boolean', { ...CHART, follow: 'yes' }],
    ['no solid', { follow: true, start: END, end: END }],
    ['a solid that is not a boolean', { ...CHART, solid: 1 }],
    ['no start', { follow: false, solid: false, end: END }],
    ['no end', { follow: true, solid: false, start: END }],
    ['an end hue of 360', { ...CHART, end: { ...END, hue: 360 } }],
    ['a negative start hue', { ...CHART, start: { ...END, hue: -1 } }],
    ['a start strength over 100', { ...CHART, start: { ...END, strength: 100.5 } }],
    ['an end lightness over 100', { ...CHART, end: { ...END, lightness: 101 } }],
    ['an end without a lightness', { ...CHART, end: { hue: 10, strength: 10 } }],
  ])('rejects a chart with %s', (_name, chart) => {
    expect(parseCustomColours({ ...WARM_LIGHT, chart })).toBeNull();
  });
});

describe('direction', () => {
  const directed = (direction: ThemeDirection, base = WARM_LIGHT): CustomColours => ({ ...base, direction });

  it('starts as the preset’s own direction', () => {
    for (const preset of themePresets) expect(customFromSeeds(preset.seeds, 'light').direction).toBe(preset.seeds.direction);
  });

  it.each(['light', 'dark'] as ThemeMode[])('moves only `gain` and `loss`, onto their hues, in %s', (mode) => {
    const base = customFromSeeds(defaultThemeSeeds, mode);
    const before = generateCustomRoles(base);
    const after = generateCustomRoles(directed('blue-orange', base));
    const moved = (Object.keys(before) as (keyof UiRoles)[]).filter((role) => before[role] !== after[role]);
    expect(moved.sort()).toEqual(['gain', 'loss']);
    expect(hueDistance(hexToLch(after.gain).hue, hexToLch(DIRECTION_PAIRS['blue-orange'][mode].gain).hue)).toBeLessThanOrEqual(5);
    expect(hueDistance(hexToLch(after.loss).hue, hexToLch(DIRECTION_PAIRS['blue-orange'][mode].loss).hue)).toBeLessThanOrEqual(5);
  });

  it('draws both changes in the drawn `ink` under `ink`, wherever its lightness is', () => {
    for (const colours of [directed('ink'), directed('ink', { ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 30 } })]) {
      const roles = generateCustomRoles(colours);
      expect([roles.gain, roles.loss]).toEqual([roles.ink, roles.ink]);
    }
  });
});

// Every role as a custom theme drew it before the mode, text lightness and
// contrast and the direction were chosen: the page's mode from its lightness,
// depth scaling the cards, hairlines and empty cells, `ink` at its ladder's
// L*. A frozen copy, so a theme saved then is proved to draw the same now —
// but for the chart ramp, which its stored `viz` no longer sets: the ladder
// draws it from the page.
type SavedBefore = {
  background: { hue: number; strength: number; lightness: number; depth: number };
  ink?: { hue: number; strength: number };
  text: { hue: number; strength: number };
  accent: { hue: number; strength: number };
  record: { hue: number; strength: number };
  viz: { hue: number; strength: number };
};

function rolesBefore(saved: SavedBefore, ink: { hue: number; strength: number }): UiRoles {
  const mode: ThemeMode = saved.background.lightness >= 50 ? 'light' : 'dark';
  const seeds = {
    background: customSeed('background', saved.background),
    text: customSeed('text', saved.text),
    accent: customSeed('accent', saved.accent),
    record: customSeed('record', saved.record),
    direction: 'green-crimson' as const,
  };
  const reference = { ...generateRoles(seeds, mode, { rampHue: saved.background.hue }), ink: customInk(mode, ink) };
  const paperRef = hexToLch(reference.paper).lightness;
  const end = hexToLch(reference.ink).lightness;
  const { lightness: page, depth } = saved.background;
  const paper = hexToLch(reference.paper);
  // The grounds added since (`well`, `raised`) step by depth like `surface`.
  const ground = new Set(['well', 'surface', 'raised', 'rule', 'ruleSoft', 'viz0']);
  const pageTinted = new Set(['surface', 'raised']);
  const kept = new Set(['selection', 'onAccent', 'onSelection', 'onDanger', 'onInk']);
  const moved = Object.fromEntries(
    Object.entries(reference).map(([role, value]) => {
      if (kept.has(role) || role === 'scrim') return [role, value];
      const lch = pageTinted.has(role) ? { ...hexToLch(value), chroma: paper.chroma, hue: paper.hue } : hexToLch(value);
      const share = ((lch.lightness - paperRef) / (end - paperRef)) * (ground.has(role) ? depth / 100 : 1);
      return [role, lchToHex({ ...lch, lightness: Math.min(100, Math.max(0, page + share * (end - page))) })];
    }),
  ) as UiRoles;
  // The page inks and the inset came later, as the inks and the page under a
  // second name.
  const paged = { ...moved, pageInk: moved.ink, pageInkMuted: moved.inkMuted, pageInkFaint: moved.inkFaint, inset: moved.paper };
  return mode === 'light' ? { ...paged, scrim: withAlpha(paged.ink, 0.42) } : paged;
}

describe('a theme saved before its mode, contrasts and direction', () => {
  // The ramp such a theme stored, which nothing reads any more.
  const viz = { hue: 70, strength: 34 };
  const savedFrom = ({ background, ink, text, accent, record }: CustomColours): SavedBefore => ({
    background: { hue: background.hue, strength: background.strength, lightness: background.lightness, depth: background.depth },
    ink: { hue: ink.hue, strength: ink.strength },
    text: { hue: text.hue, strength: text.strength },
    accent,
    record,
    viz,
  });
  const cases: SavedBefore[] = themePresets.flatMap((preset) =>
    (['light', 'dark'] as ThemeMode[]).flatMap((mode) => {
      const saved = savedFrom(customFromSeeds(preset.seeds, mode));
      return [0, 2, 20, 49, 50, 70, 96, 100].flatMap((lightness) =>
        [0, 40, 100, 300].map((depth) => ({ ...saved, background: { ...saved.background, lightness, depth } })),
      );
    }),
  );

  it('draws every role exactly as it did, for every preset, page and depth', () => {
    const drift = cases.filter((saved) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(saved)))!;
      return JSON.stringify(generateCustomRoles(read)) !== JSON.stringify(rolesBefore(saved, saved.ink!));
    });
    expect(drift).toEqual([]);
  });

  it('draws as it did when saved before primary text was a part, too', () => {
    const drift = cases.filter(({ ink: _ink, ...saved }) => {
      const read = parseCustomColours(JSON.parse(JSON.stringify(saved)))!;
      return JSON.stringify(generateCustomRoles(read)) !== JSON.stringify(rolesBefore(saved, read.ink));
    });
    expect(drift).toEqual([]);
  });

  it('reads the defaults that draw it so', () => {
    const read = parseCustomColours({ ...cases[0], background: { ...cases[0].background, lightness: 20, depth: 40 } })!;
    expect(read.background.mode).toBe('dark');
    expect(read.ink.lightness).toBe(inkStep('dark').lightness);
    expect(read.text.contrast).toBe(100);
    expect(read.highlight).toMatchObject({ match: true, contrast: 100 });
    expect(read.direction).toBe('green-crimson');
  });
});

describe('parseCustomColours', () => {
  it('reads back what it was given', () => {
    expect(parseCustomColours(JSON.parse(JSON.stringify(WARM_LIGHT)))).toEqual(WARM_LIGHT);
    const chosen: CustomColours = {
      ...WARM_LIGHT,
      background: { ...WARM_LIGHT.background, mode: 'dark', lightness: 2.25 },
      ink: { ...WARM_LIGHT.ink, lightness: 88.75 },
      text: { ...WARM_LIGHT.text, contrast: 130 },
      highlight: { hue: 120, strength: 55, match: false, contrast: 260 },
      secondary: { hue: 359.75, strength: 0, lightness: 0 },
      muted: { hue: 0, strength: 87.123456789, lightness: 63.0000001 },
      direction: 'blue-orange',
    };
    expect(parseCustomColours(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
  });

  it.each(THEME_DIRECTIONS)('round-trips the %s direction, and reads none as green and crimson', (direction) => {
    expect(parseCustomColours(JSON.parse(JSON.stringify({ ...WARM_LIGHT, direction })))?.direction).toBe(direction);
    const { direction: _direction, ...saved } = WARM_LIGHT;
    expect(parseCustomColours(JSON.parse(JSON.stringify(saved)))?.direction).toBe('green-crimson');
  });

  it('ignores the borders and charts parts older builds wrote, valid or not', () => {
    const older = {
      ...WARM_LIGHT,
      borders: { hue: 150, strength: 60, match: false, contrast: 999 },
      viz: { hue: 400, strength: 80, gamut: 'yes' },
    };
    expect(parseCustomColours(JSON.parse(JSON.stringify(older)))).toEqual(WARM_LIGHT);
  });

  it('takes the primary text from the text for a value saved before it was a part, drawing the same `ink`', () => {
    const { ink: _ink, ...saved } = WARM_LIGHT;
    const read = parseCustomColours(JSON.parse(JSON.stringify(saved)))!;
    expect(read.ink.hue).toBe(WARM_LIGHT.text.hue);
    const before = generateRoles(customSeeds(read), 'light').ink;
    expect(deltaE(generateCustomRoles(read).ink, before)).toBeLessThan(1);
  });

  it.each([
    ['nothing', null],
    ['a primary text strength over 100', { ...WARM_LIGHT, ink: { hue: 10, strength: 101 } }],
    ['a missing part', { ...WARM_LIGHT, record: undefined }],
    ['a hue of 360', { ...WARM_LIGHT, text: { hue: 360, strength: 10 } }],
    ['a strength over 100', { ...WARM_LIGHT, accent: { hue: 10, strength: 101 } }],
    ['a fractional strength', { ...WARM_LIGHT, accent: { hue: 10, strength: 5.5 } }],
    ['a page lightness over 100', withBackground(WARM_LIGHT, { lightness: 101 })],
    ['a depth over 300', withBackground(WARM_LIGHT, { depth: 301 })],
    ['no depth', { ...WARM_LIGHT, background: { hue: 80, strength: 10, lightness: 50 } }],
    ['a page lightness off the quarter steps', withBackground(WARM_LIGHT, { lightness: 50.1 })],
    ['an unknown mode', withBackground(WARM_LIGHT, { mode: 'sepia' as never })],
    ['a primary text lightness over 100', { ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 100.25 } }],
    ['a text contrast over 150', { ...WARM_LIGHT, text: { ...WARM_LIGHT.text, contrast: 151 } }],
    ['a highlight without a match', { ...WARM_LIGHT, highlight: { hue: 10, strength: 10, contrast: 100 } }],
    ['a highlight contrast over 300', { ...WARM_LIGHT, highlight: { ...WARM_LIGHT.highlight, contrast: 301 } }],
    ['an unknown direction', { ...WARM_LIGHT, direction: 'red-green' }],
    ['a secondary text hue of 360', { ...WARM_LIGHT, secondary: { hue: 360, strength: 10, lightness: 50 } }],
    ['a negative muted text hue', { ...WARM_LIGHT, muted: { hue: -0.5, strength: 10, lightness: 50 } }],
    ['a secondary text strength over 100', { ...WARM_LIGHT, secondary: { hue: 10, strength: 100.5, lightness: 50 } }],
    ['a muted text lightness over 100', { ...WARM_LIGHT, muted: { hue: 10, strength: 10, lightness: 100.01 } }],
    ['a negative secondary text lightness', { ...WARM_LIGHT, secondary: { hue: 10, strength: 10, lightness: -1 } }],
    ['a muted text without a lightness', { ...WARM_LIGHT, muted: { hue: 10, strength: 10 } }],
    ['a secondary text lightness that is not a number', { ...WARM_LIGHT, secondary: { hue: 10, strength: 10, lightness: '50' } }],
    ['a muted text that is not an object', { ...WARM_LIGHT, muted: 50 }],
    ['a secondary text of null', { ...WARM_LIGHT, secondary: null }],
    ['a direction that is not a string', { ...WARM_LIGHT, direction: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(parseCustomColours(value)).toBeNull();
  });
});

// Strengths as shares of each L*'s sRGB maximum (`GAMUT_SCALE`): a theme
// saved before the marker draws byte-identical roles, converting it repaints
// nothing (well under the 1 ΔE, CIE76, the operator accepts at that moment),
// a tinted part draws from its old strength until its own strength or
// lightness moves, and every part's strength 100 reaches the most chroma its
// L* and hue hold.
describe('the gamut scale', () => {
  const stored = (value: unknown): CustomColours => parseCustomColours(JSON.parse(JSON.stringify(value)))!;
  // The most chroma sRGB holds at an L* and hue.
  const most = (lightness: number, hue: number) => hexToLch(lchToHex({ lightness, chroma: 150, hue })).chroma;
  const SCALED: CustomColours = { ...WARM_LIGHT, scale: GAMUT_SCALE };

  it('draws every theme saved before the marker as the build before it did, in both modes, with every field since added', () => {
    const drift = BEFORE_GAMUT_ROLES.cases.filter(({ stored: saved, roles }) => JSON.stringify(generateCustomRoles(stored(saved))) !== JSON.stringify(roles));
    expect(BEFORE_GAMUT_ROLES.cases.length).toBeGreaterThanOrEqual(54);
    expect(new Set(BEFORE_GAMUT_ROLES.cases.map(({ stored: saved }) => saved.background.mode))).toEqual(new Set(['light', 'dark']));
    (['borders', 'secondary', 'muted', 'chart'] as const).forEach((field) =>
      expect({ field, cases: BEFORE_GAMUT_ROLES.cases.some(({ stored: saved }) => field in saved || field in saved.background) }).toEqual({ field, cases: true }),
    );
    expect(drift).toEqual([]);
  });

  it('draws every preset as the build before it did', () => {
    const drift = BEFORE_GAMUT_ROLES.presets.filter(({ id, mode, roles }) => {
      const preset = themePresets.find((candidate) => candidate.id === id)!;
      return JSON.stringify(generateRoles(preset.seeds, mode as ThemeMode, { ladder: preset.ladder })) !== JSON.stringify(roles);
    });
    expect(BEFORE_GAMUT_ROLES.presets).toHaveLength(themePresets.length * 2);
    expect(drift).toEqual([]);
  });

  it('converts a theme saved before to the gamut scale, writing the marker and repainting no role', () => {
    BEFORE_GAMUT_ROLES.cases.forEach(({ stored: saved }) => {
      const read = stored(saved);
      const converted = stored(onGamutScale(read));
      expect(converted.scale).toBe(GAMUT_SCALE);
      const [before, after] = [generateCustomRoles(read), generateCustomRoles(converted)];
      ROLE_COLOURS(before).forEach(([role, colour]) => expect({ role, shift: deltaE(colour, after[role]) }).toEqual({ role, shift: 0 }));
      expect(after.scrim).toBe(before.scrim);
    });
  });

  it('converts each part to the nearest values: tinted by its old strength, at the strength and L* it draws', () => {
    const read = customFromSeeds(defaultThemeSeeds, 'dark');
    const converted = onGamutScale(read);
    const roles = generateCustomRoles(read);
    expect(converted).toMatchObject({ background: { tint: read.background.strength }, accent: { tint: read.accent.strength }, record: { tint: read.record.strength } });
    // Primary text, the highlight and the inks were already on it.
    expect([converted.ink, converted.highlight, converted.text]).toEqual([read.ink, read.highlight, read.text]);
    const { accent } = converted;
    expect(accent.lightness).toBeCloseTo(hexToLch(roles.accent).lightness, 6);
    expect(deltaE(gamutColour(accent.lightness!, accent), roles.accent)).toBeLessThan(1);
    expect(deltaE(gamutColour(converted.background.lightness, converted.background), roles.paper)).toBeLessThan(1);
    expect(onGamutScale(converted)).toBe(converted);
  });

  it('draws a tinted part from its old strength through a hue move, and on the gamut scale once untinted', () => {
    const converted = onGamutScale(WARM_LIGHT);
    const hued = { ...converted, accent: { ...converted.accent, hue: 200 } };
    expect(generateCustomRoles(hued)).toEqual(generateCustomRoles({ ...WARM_LIGHT, accent: { ...WARM_LIGHT.accent, hue: 200 } }));
    const own = { ...converted, accent: untinted(converted.accent) };
    expect(own.accent).not.toHaveProperty('tint');
    expect(generateCustomRoles(own).accent).toBe(gamutColour(own.accent.lightness!, own.accent));
    expect(untinted(WARM_LIGHT.accent)).toBe(WARM_LIGHT.accent);
  });

  // A converted part's first strength or lightness move drops its tint: the
  // jump is that part's own, measured on every stored case and bounded here.
  const OWN_ROLES = { accent: ['accent', 'accentWash'], record: ['record', 'recordRule', 'recordWash'] } as const;
  const FIXED_HUES = ['danger', 'regimeNewer', 'regimeOlder'] as const;
  it.each([
    ['accent', 9],
    ['record', 10],
    ['background', 56],
  ] as const)('confines the first move of a converted %s to its own roles, within %s ΔE', (part, bound) => {
    const jumps = BEFORE_GAMUT_ROLES.cases.map(({ stored: saved }) => {
      const converted = onGamutScale(stored(saved));
      const [before, after] = [generateCustomRoles(converted), generateCustomRoles({ ...converted, [part]: untinted(converted[part]) })];
      const shift = (role: keyof UiRoles) => deltaE(before[role], after[role]);
      const own: readonly (keyof UiRoles)[] = part === 'background' ? ROLE_COLOURS(before).map(([role]) => role) : OWN_ROLES[part];
      const others = part === 'background' ? [...OWN_ROLES.accent, ...OWN_ROLES.record, ...FIXED_HUES] : ROLE_COLOURS(before).map(([role]) => role).filter((role) => !own.includes(role));
      return { own: Math.max(...own.map(shift)), others: Math.max(...others.map(shift)), exact: part !== 'background' && others.every((role) => before[role] === after[role]) };
    });
    expect(Math.max(...jumps.map(({ own }) => own))).toBeLessThanOrEqual(bound);
    // Another part's roles stay put; under a page move they shift only by rounding.
    expect(Math.max(...jumps.map(({ others }) => others))).toBeLessThan(1);
    if (part !== 'background') expect(jumps.every(({ exact }) => exact)).toBe(true);
  });

  it('reads a tinted part at the strength and L* it draws now', () => {
    const converted = onGamutScale(withBackground(WARM_LIGHT, { lightness: 80 }));
    const roles = generateCustomRoles(converted);
    const record = gamutPart(converted, 'record');
    expect(record.tint).toBe(WARM_LIGHT.record.strength);
    expect(record.lightness).toBeCloseTo(hexToLch(roles.record).lightness, 6);
    expect(gamutPart(converted, 'background').strength).toBeCloseTo((hexToLch(roles.paper).chroma / most(80, converted.background.hue)) * 100, 6);
    expect(gamutPart(SCALED, 'accent')).toBe(SCALED.accent);
  });

  describe.each(['light', 'dark'] as ThemeMode[])('at strength 100 on a %s page', (mode) => {
    // At the ladder's `paper`, so the highlight's band sits at its ladder's L*.
    const page = paperLightness(mode);
    const full = (hue: number) => ({ hue, strength: 100 });
    const theme: CustomColours = {
      ...customFromSeeds(defaultThemeSeeds, mode),
      scale: GAMUT_SCALE,
      background: { ...full(250), mode, lightness: page, depth: 100 },
      ink: { ...full(20), lightness: mode === 'light' ? 20 : 85 },
      secondary: { ...full(140), lightness: 50 },
      muted: { ...full(300), lightness: 60 },
      accent: { ...full(35), lightness: 55 },
      highlight: { ...full(180), match: false, contrast: 100 },
      record: { ...full(90), lightness: 80 },
      chart: { follow: false, solid: false, start: { ...full(10), lightness: 30 }, end: { ...full(200), lightness: 70 } },
    };
    const roles = generateCustomRoles(theme);
    it.each([
      ['background', 'paper', 250],
      ['ink', 'ink', 20],
      ['secondary', 'inkMuted', 140],
      ['muted', 'inkFaint', 300],
      ['accent', 'accent', 35],
      ['highlight', 'accentWash', 180],
      ['record', 'record', 90],
      ['chart start', 'viz1', 10],
      ['chart end', 'viz4', 200],
    ] as const)('reaches the most chroma the %s’s L* and hue hold', (_part, role, hue) => {
      const drawn = hexToLch(roles[role]);
      expect(drawn.chroma).toBeGreaterThan(most(drawn.lightness, hue) - 1.5);
      expect(hueDistance(drawn.hue, hue)).toBeLessThan(2);
    });
  });

  it('draws a bright red accent: hue 35, strength 100 at L* 55', () => {
    const red = generateCustomRoles({ ...SCALED, accent: { hue: 35, strength: 100, lightness: 55 } }).accent;
    const { lightness, chroma, hue } = hexToLch(red);
    expect(lightness).toBeCloseTo(55, 0);
    expect(hueDistance(hue, 35)).toBeLessThan(2);
    // Brighter and stronger than any strength the fixed scale's L* 43 reached.
    expect(chroma).toBeGreaterThan(hexToLch(generateCustomRoles({ ...WARM_LIGHT, accent: { hue: 35, strength: 100 } }).accent).chroma + 5);
    expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(0xe0);
  });

  it.each([
    ['accent', 0, '#000000'],
    ['accent', 100, '#FFFFFF'],
    ['record', 0, '#000000'],
    ['record', 100, '#FFFFFF'],
  ] as const)('accepts a %s lightness of %d, drawn %s', (part, lightness, colour) => {
    const read = stored({ ...SCALED, [part]: { hue: 35, strength: 80, lightness } });
    expect(read[part].lightness).toBe(lightness);
    expect(deltaE(generateCustomRoles(read)[part], colour)).toBeLessThan(0.5);
  });

  it.each([
    ['light', 'accent', 43],
    ['light', 'record', 43],
    ['dark', 'accent', 72],
    ['dark', 'record', 66],
  ] as const)('draws a %s %s without a lightness at the mode’s, %d', (mode, part, lightness) => {
    const theme = { ...customFromSeeds(defaultThemeSeeds, mode), scale: GAMUT_SCALE } as CustomColours;
    expect(fillDefault(mode, part)).toBe(lightness);
    expect(hexToLch(generateCustomRoles(theme)[part]).lightness).toBeCloseTo(lightness, 0);
  });

  it('puts the fills not tinted at the new mode’s L*, and leaves a tinted one and a theme saved before', () => {
    const converted = onGamutScale(WARM_LIGHT);
    const own = { ...converted, accent: untinted(converted.accent) };
    expect(fillsInMode(own, 'dark')).toEqual({ accent: { ...own.accent, lightness: 72 } });
    expect(fillsInMode(WARM_LIGHT, 'dark')).toEqual({});
  });

  it('matches the highlight to the accent as drawn on the gamut scale', () => {
    const accent = { hue: 35, strength: 100, lightness: 55 };
    const { highlight: _highlight, ...saved } = { ...SCALED, accent };
    expect(stored(saved).highlight).toEqual({ ...highlightFromAccent(gamutColour(55, accent), 'light'), match: true, contrast: 100 });
  });

  it('keeps unrounded strengths, a tint and a fill’s L* on the gamut scale, and ignores the last two before it', () => {
    const value = {
      ...SCALED,
      background: { ...SCALED.background, strength: 12.5, tint: 19 },
      accent: { hue: 30, strength: 40.25, lightness: 61.5, tint: 70 },
      record: { hue: 80, strength: 99.9 },
    };
    expect(stored(value)).toEqual(value);
    const before = stored({ ...WARM_LIGHT, accent: { ...WARM_LIGHT.accent, lightness: 61.5, tint: 70 } });
    expect(before.accent).toEqual(WARM_LIGHT.accent);
  });

  it.each([
    ['an unknown scale', { ...SCALED, scale: 3 }],
    ['a scale that is not a number', { ...SCALED, scale: '2' }],
    ['a fractional strength before the scale', { ...WARM_LIGHT, background: { ...WARM_LIGHT.background, strength: 12.5 } }],
    ['an accent lightness over 100', { ...SCALED, accent: { hue: 30, strength: 40, lightness: 100.5 } }],
    ['a negative best ever lightness', { ...SCALED, record: { hue: 30, strength: 40, lightness: -1 } }],
    ['a fractional tint', { ...SCALED, accent: { hue: 30, strength: 40, tint: 10.5 } }],
    ['a page tint over 100', { ...SCALED, background: { ...SCALED.background, tint: 101 } }],
    ['a strength over 100 on the scale', { ...SCALED, record: { hue: 30, strength: 100.5 } }],
    ['a fractional hue on the scale', { ...SCALED, accent: { hue: 30.5, strength: 40 } }],
  ])('rejects %s', (_name, value) => {
    expect(parseCustomColours(value)).toBeNull();
  });
});
