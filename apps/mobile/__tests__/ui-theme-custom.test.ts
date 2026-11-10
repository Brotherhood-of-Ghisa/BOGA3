import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { defaultThemeSeeds, generateRoles, inkStep, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import {
  customFromSeeds,
  customInk,
  customMode,
  customSeed,
  customSeeds,
  gamutColour,
  generateCustomRoles,
  parseCustomColours,
  type CustomColours,
} from '@/components/ui/theme-custom';
import { themePresets } from '@/components/ui/theme-presets';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): a hue and
// strength per seed, the page's mode, lightness and depth, the borders and
// the texts' contrast. These tests pin that a preset converted to custom
// colours keeps its look, that a theme saved before a field existed draws
// exactly as it did, that the mode is the page's own, that depth, the
// borders' and the secondary text's contrast each move only their roles, and
// what a stored value must hold. No readability floor is gated: custom
// colours are the user's.

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

const withBackground = (colours: CustomColours, background: Partial<CustomColours['background']>): CustomColours => ({
  ...colours,
  background: { ...colours.background, ...background },
});

describe('a preset converted to custom colours', () => {
  it.each(themePresets.flatMap((preset) => (['light', 'dark'] as ThemeMode[]).map((mode) => [preset.id, mode, preset.seeds] as const)))(
    'keeps %s in %s within ΔE*ab 3 of every role',
    (_id, mode, seeds) => {
      const preset = generateRoles(seeds, mode);
      const custom = generateCustomRoles(customFromSeeds(seeds, mode));
      // A light preset's accent is its seed as given; a custom accent is drawn
      // at the custom L* 46, which a darker preset accent (Plum's) is 7 from.
      const limit = (role: keyof UiRoles) => (mode === 'light' && role === 'accent' ? 7 : 3);
      const drift = ROLE_COLOURS(preset)
        .map(([role, hex]) => ({ role, delta: deltaE(hex, custom[role]) }))
        .filter(({ role, delta }) => delta > limit(role));
      expect(drift).toEqual([]);
    },
  );

  it('starts on the ladder’s page at the shipped depth', () => {
    expect(WARM_LIGHT.background).toMatchObject({ lightness: 96, depth: 100 });
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
    const lightness = (['paper', 'inkGhost', 'inkFaint', 'inkMuted', 'ink'] as const).map((role) => hexToLch(roles[role]).lightness);
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
  });
});

describe('depth', () => {
  const gap = (colours: CustomColours, role: keyof UiRoles) => {
    const roles = generateCustomRoles(colours);
    return Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);
  };
  const atDepth = (depth: number) => withBackground(WARM_LIGHT, { lightness: 70, depth });

  it('flattens the cards and empty cells onto the page at 0', () => {
    const roles = generateCustomRoles(atDepth(0));
    expect([roles.surface, roles.viz0].map((hex) => hexToLch(hex).lightness)).toEqual(
      Array(2).fill(expect.closeTo(hexToLch(roles.paper).lightness, 0)),
    );
  });

  it.each(['surface', 'viz0'] as const)('spreads %s further from the page as it grows', (role) => {
    expect(gap(atDepth(200), role)).toBeGreaterThan(gap(atDepth(100), role));
    expect(gap(atDepth(100), role)).toBeGreaterThan(gap(atDepth(50), role));
  });

  it('leaves the borders, inks, accent and ramp where they are', () => {
    const flat = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 0 }));
    const deep = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 300 }));
    (['rule', 'ruleSoft', 'ink', 'inkMuted', 'inkFaint', 'inkGhost', 'accent', 'record', 'viz1', 'viz4', 'danger'] as const).forEach((role) =>
      expect(deep[role]).toBe(flat[role]),
    );
  });
});

describe('borders', () => {
  const withBorders = (borders: Partial<CustomColours['borders']>): CustomColours => ({
    ...withBackground(WARM_LIGHT, { lightness: 70 }),
    borders: { ...WARM_LIGHT.borders, ...borders },
  });
  const gap = (colours: CustomColours, role: 'rule' | 'ruleSoft') => {
    const roles = generateCustomRoles(colours);
    return Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);
  };

  it('flattens onto the page at a contrast of 0, and steps further as it grows', () => {
    (['rule', 'ruleSoft'] as const).forEach((role) => {
      expect(gap(withBorders({ contrast: 0 }), role)).toBeLessThan(0.5);
      expect(gap(withBorders({ contrast: 200 }), role)).toBeGreaterThan(gap(withBorders({ contrast: 100 }), role));
    });
  });

  it('moves only the borders with their contrast', () => {
    const soft = generateCustomRoles(withBorders({ contrast: 30 }));
    const hard = generateCustomRoles(withBorders({ contrast: 250 }));
    const moved = (Object.keys(soft) as (keyof UiRoles)[]).filter((role) => soft[role] !== hard[role]);
    expect(moved.sort()).toEqual(['rule', 'ruleSoft']);
  });

  it('take the page’s colour while they match it, whatever their own', () => {
    const matched = generateCustomRoles(withBorders({ match: true, hue: 300, strength: 100 }));
    expect(matched.rule).toBe(generateCustomRoles(withBorders({ match: true })).rule);
  });

  it('take their own hue and strength when they do not match, and leave every other role alone', () => {
    const base = generateCustomRoles(withBorders({ match: true }));
    const own = generateCustomRoles(withBorders({ match: false, hue: 150, strength: 100 }));
    expect(hexToLch(own.rule).hue).toBeCloseTo(150, -1);
    expect(hexToLch(own.rule).chroma).toBeGreaterThan(20);
    expect(hexToLch(own.rule).lightness).toBeCloseTo(hexToLch(base.rule).lightness, 0);
    const moved = (Object.keys(base) as (keyof UiRoles)[]).filter((role) => base[role] !== own[role]);
    expect(moved.sort()).toEqual(['rule', 'ruleSoft']);
  });

  it('change nothing when unmatched at the page’s own hue and strength', () => {
    const { hue, strength } = WARM_LIGHT.background;
    expect(generateCustomRoles(withBorders({ match: false, hue, strength }))).toEqual(generateCustomRoles(withBorders({ match: true })));
  });
});

describe('hue and strength', () => {
  it('takes each part’s hue', () => {
    const roles = generateCustomRoles({ ...WARM_LIGHT, accent: { hue: 250, strength: 80 }, viz: { hue: 150, strength: 80, gamut: false } });
    expect(hexToLch(roles.accent).hue).toBeCloseTo(250, -1);
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
    (['inkMuted', 'inkFaint', 'inkGhost', 'paper', 'accent'] as const).forEach((role) => expect(navy[role]).toBe(base[role]));
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
    // The light backdrop is `ink` at 42%.
    expect(moved.sort()).toEqual(['ink', 'scrim']);
  });

  it('keeps its hue and strength as a share of what its L* holds', () => {
    const roles = generateCustomRoles({ ...WARM_LIGHT, ink: { hue: 280, strength: 100, lightness: 30 } });
    expect(roles.ink).toBe(gamutColour(30, { hue: 280, strength: 100 }));
  });
});

describe('secondary text’s contrast', () => {
  const atContrast = (contrast: number) => generateCustomRoles({ ...WARM_LIGHT, text: { ...WARM_LIGHT.text, contrast } });
  const gap = (roles: UiRoles, role: keyof UiRoles) => Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);

  it.each(['inkMuted', 'inkFaint', 'inkGhost'] as const)('moves %s toward the page below 100 and away above', (role) => {
    expect(gap(atContrast(50), role)).toBeLessThan(gap(atContrast(100), role));
    expect(gap(atContrast(150), role)).toBeGreaterThan(gap(atContrast(100), role));
    expect(gap(atContrast(0), role)).toBeLessThan(0.5);
  });

  it('moves the secondary inks alone', () => {
    const [low, high] = [atContrast(40), atContrast(140)];
    const moved = (Object.keys(low) as (keyof UiRoles)[]).filter((role) => low[role] !== high[role]);
    expect(moved.sort()).toEqual(['inkFaint', 'inkGhost', 'inkMuted']);
  });

  it('never takes them past the primary text', () => {
    const colours = { ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 40 }, text: { ...WARM_LIGHT.text, contrast: 150 } };
    const roles = generateCustomRoles(colours);
    expect(hexToLch(roles.inkMuted).lightness).toBeGreaterThanOrEqual(hexToLch(roles.ink).lightness - 0.5);
  });
});

describe('charts on the gamut', () => {
  const ramp = ['viz1', 'viz2', 'viz3', 'viz4'] as const;
  const gamutViz = (mode: ThemeMode, strength: number, hue = 150): CustomColours => {
    const colours = customFromSeeds(defaultThemeSeeds, mode);
    return { ...colours, viz: { hue, strength, gamut: true } };
  };

  it.each(['light', 'dark'] as const)('at a strength of 100 holds more chroma at every step than the shipped ramp, in %s', (mode) => {
    const shipped = generateCustomRoles({ ...gamutViz(mode, 100), viz: { hue: 150, strength: 100, gamut: false } });
    const full = generateCustomRoles(gamutViz(mode, 100));
    ramp.forEach((role) => expect(hexToLch(full[role]).chroma).toBeGreaterThan(hexToLch(shipped[role]).chroma));
  });

  it.each(['light', 'dark'] as const)('keeps “more” stronger: each step further from the page, in %s', (mode) => {
    const roles = generateCustomRoles(gamutViz(mode, 100));
    const gaps = ramp.map((role) => Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness));
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
  });

  it('lifts the dark ramp’s strongest step past the shipped cap, to the light ramp’s L*', () => {
    const roles = generateCustomRoles(withBackground(gamutViz('dark', 100), { lightness: 10 }));
    expect(hexToLch(roles.viz4).lightness).toBeCloseTo(58, 0);
  });

  it('is a grey at a strength of 0, and moves only the ramp', () => {
    const grey = generateCustomRoles(gamutViz('light', 0));
    ramp.forEach((role) => expect(hexToLch(grey[role]).chroma).toBeLessThan(1));
    const shipped = generateCustomRoles({ ...gamutViz('light', 40), viz: { hue: 150, strength: 40, gamut: false } });
    const own = generateCustomRoles(gamutViz('light', 40));
    const moved = (Object.keys(own) as (keyof UiRoles)[]).filter((role) => own[role] !== shipped[role]);
    expect(moved.sort()).toEqual([...ramp]);
  });
});

// Every role as a custom theme drew it before the mode, borders, text
// lightness and contrast, and the gamut ramp were chosen: the page's mode from
// its lightness, depth scaling the cards, borders and empty cells, `ink` at
// its ladder's L*. A frozen copy, so a theme saved then is proved to draw the
// same now.
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
    viz: customSeed('viz', saved.viz),
  };
  const reference = { ...generateRoles(seeds, mode), ink: customInk(mode, ink) };
  const paperRef = hexToLch(reference.paper).lightness;
  const end = hexToLch(reference.ink).lightness;
  const { lightness: page, depth } = saved.background;
  const paper = hexToLch(reference.paper);
  const ground = new Set(['surface', 'rule', 'ruleSoft', 'viz0']);
  const kept = new Set(['selection', 'onAccent', 'onSelection', 'onDanger', 'onInk']);
  const moved = Object.fromEntries(
    Object.entries(reference).map(([role, value]) => {
      if (kept.has(role) || role === 'scrim') return [role, value];
      const lch = role === 'surface' ? { ...hexToLch(value), chroma: paper.chroma, hue: paper.hue } : hexToLch(value);
      const share = ((lch.lightness - paperRef) / (end - paperRef)) * (ground.has(role) ? depth / 100 : 1);
      return [role, lchToHex({ ...lch, lightness: Math.min(100, Math.max(0, page + share * (end - page))) })];
    }),
  ) as UiRoles;
  return mode === 'light' ? { ...moved, scrim: withAlpha(moved.ink, 0.42) } : moved;
}

describe('a theme saved before its mode, borders, contrasts and gamut ramp', () => {
  const savedFrom = ({ background, ink, text, accent, record, viz }: CustomColours): SavedBefore => ({
    background: { hue: background.hue, strength: background.strength, lightness: background.lightness, depth: background.depth },
    ink: { hue: ink.hue, strength: ink.strength },
    text: { hue: text.hue, strength: text.strength },
    accent,
    record,
    viz: { hue: viz.hue, strength: viz.strength },
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
    expect(read.borders).toEqual({ hue: cases[0].background.hue, strength: cases[0].background.strength, match: true, contrast: 40 });
    expect(read.ink.lightness).toBe(inkStep('dark').lightness);
    expect(read.text.contrast).toBe(100);
    expect(read.viz.gamut).toBe(false);
  });
});

describe('parseCustomColours', () => {
  it('reads back what it was given', () => {
    expect(parseCustomColours(JSON.parse(JSON.stringify(WARM_LIGHT)))).toEqual(WARM_LIGHT);
    const chosen: CustomColours = {
      ...WARM_LIGHT,
      background: { ...WARM_LIGHT.background, mode: 'dark', lightness: 2.25 },
      borders: { hue: 150, strength: 60, match: false, contrast: 220 },
      ink: { ...WARM_LIGHT.ink, lightness: 88.75 },
      text: { ...WARM_LIGHT.text, contrast: 130 },
      viz: { ...WARM_LIGHT.viz, gamut: true },
    };
    expect(parseCustomColours(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
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
    ['a missing part', { ...WARM_LIGHT, viz: undefined }],
    ['a hue of 360', { ...WARM_LIGHT, text: { hue: 360, strength: 10 } }],
    ['a strength over 100', { ...WARM_LIGHT, accent: { hue: 10, strength: 101 } }],
    ['a fractional strength', { ...WARM_LIGHT, accent: { hue: 10, strength: 5.5 } }],
    ['a page lightness over 100', withBackground(WARM_LIGHT, { lightness: 101 })],
    ['a depth over 300', withBackground(WARM_LIGHT, { depth: 301 })],
    ['no depth', { ...WARM_LIGHT, background: { hue: 80, strength: 10, lightness: 50 } }],
    ['a page lightness off the quarter steps', withBackground(WARM_LIGHT, { lightness: 50.1 })],
    ['an unknown mode', withBackground(WARM_LIGHT, { mode: 'sepia' as never })],
    ['borders without a match', { ...WARM_LIGHT, borders: { hue: 10, strength: 10, contrast: 100 } }],
    ['a border contrast over 300', { ...WARM_LIGHT, borders: { ...WARM_LIGHT.borders, contrast: 301 } }],
    ['a primary text lightness over 100', { ...WARM_LIGHT, ink: { ...WARM_LIGHT.ink, lightness: 100.25 } }],
    ['a text contrast over 150', { ...WARM_LIGHT, text: { ...WARM_LIGHT.text, contrast: 151 } }],
    ['a gamut that is not a boolean', { ...WARM_LIGHT, viz: { ...WARM_LIGHT.viz, gamut: 1 } }],
  ])('rejects %s', (_name, value) => {
    expect(parseCustomColours(value)).toBeNull();
  });
});
