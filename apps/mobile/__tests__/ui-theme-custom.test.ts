import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import {
  defaultThemeSeeds,
  DIRECTION_PAIRS,
  generateRoles,
  inkStep,
  THEME_DIRECTIONS,
  type ThemeDirection,
  type ThemeMode,
  type UiRoles,
} from '@/components/ui/theme';
import {
  customFromSeeds,
  customInk,
  customMode,
  customSeed,
  customSeeds,
  gamutColour,
  generateCustomRoles,
  highlightFromAccent,
  parseCustomColours,
  type CustomColours,
} from '@/components/ui/theme-custom';
import { themePresets } from '@/components/ui/theme-presets';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): a hue and
// strength per colour seed, the page's mode, lightness and depth, the texts'
// contrast and the direction. These tests pin that a preset converted to custom
// colours keeps its look, that a theme saved before a field existed draws as
// it did (but for the parts since removed), that the mode is the page's own,
// that depth and the secondary text's contrast each move only their roles,
// that the hairlines and the chart ramp follow the page, and what a stored
// value must hold. The highlight follows the accent unless it is given its
// own, and its contrast moves only its band. No readability floor is gated:
// custom colours are the user's.

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
    expect(WARM_LIGHT.background).toMatchObject({ lightness: 95.5, depth: 100 });
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

  const spread = ['well', 'surface', 'raised', 'rule', 'ruleSoft', 'viz0'] as const;

  it('flattens the grounds, hairlines and empty cells onto the page at 0', () => {
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
    (['ink', 'inkMuted', 'inkFaint', 'inkGhost', 'accent', 'record', 'viz1', 'viz4', 'danger', 'gain'] as const).forEach((role) =>
      expect(deep[role]).toBe(flat[role]),
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

describe('direction', () => {
  const directed = (direction: ThemeDirection, base = WARM_LIGHT): CustomColours => ({ ...base, direction });

  it('starts as the preset’s, green and crimson', () => {
    for (const preset of themePresets) expect(customFromSeeds(preset.seeds, 'light').direction).toBe('green-crimson');
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
  const reference = { ...generateRoles(seeds, mode), ink: customInk(mode, ink) };
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
  return mode === 'light' ? { ...moved, scrim: withAlpha(moved.ink, 0.42) } : moved;
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
    ['a direction that is not a string', { ...WARM_LIGHT, direction: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(parseCustomColours(value)).toBeNull();
  });
});
