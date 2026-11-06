import { hexToLch } from '@/components/ui/lch';
import { defaultThemeSeeds, generateRoles, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import {
  customFromSeeds,
  customMode,
  customSeed,
  customSeeds,
  generateCustomRoles,
  parseCustomColours,
  type CustomColours,
} from '@/components/ui/theme-custom';
import { themePresets } from '@/components/ui/theme-presets';

// A custom theme (`docs/specs/ui/design-language.md` §2, "Custom"): a hue and
// strength per seed, and the page's lightness and depth. These tests pin that
// a preset converted to custom colours keeps its look, that the page slider
// runs from black to white and flips the text at 50, that depth spreads or
// flattens only the ground roles, and what a stored value must hold. No
// readability floor is gated: custom colours are the user's.

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

  it('puts dark text on a page of 50 or above and light text below', () => {
    expect(customMode(withBackground(WARM_LIGHT, { lightness: 50 }))).toBe('light');
    expect(customMode(withBackground(WARM_LIGHT, { lightness: 49 }))).toBe('dark');
    const light = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 50 }));
    const dark = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 49 }));
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
  const groundGap = (depth: number, role: 'surface' | 'rule' | 'ruleSoft' | 'viz0') => {
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 60, depth }));
    return Math.abs(hexToLch(roles[role]).lightness - hexToLch(roles.paper).lightness);
  };

  it('flattens the cards, lines and empty cells onto the page at 0', () => {
    const roles = generateCustomRoles(withBackground(WARM_LIGHT, { lightness: 60, depth: 0 }));
    expect([roles.surface, roles.rule, roles.ruleSoft, roles.viz0].map((hex) => hexToLch(hex).lightness)).toEqual(
      Array(4).fill(expect.closeTo(hexToLch(roles.paper).lightness, 0)),
    );
  });

  it.each(['surface', 'rule', 'ruleSoft', 'viz0'] as const)('spreads %s further from the page as it grows', (role) => {
    expect(groundGap(200, role)).toBeGreaterThan(groundGap(100, role));
    expect(groundGap(100, role)).toBeGreaterThan(groundGap(50, role));
  });

  it('leaves the inks, accent and ramp where they are', () => {
    const flat = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 0 }));
    const deep = generateCustomRoles(withBackground(WARM_LIGHT, { depth: 300 }));
    (['ink', 'inkMuted', 'inkFaint', 'inkGhost', 'accent', 'record', 'viz1', 'viz4', 'danger'] as const).forEach((role) =>
      expect(deep[role]).toBe(flat[role]),
    );
  });
});

describe('hue and strength', () => {
  it('takes each part’s hue', () => {
    const roles = generateCustomRoles({ ...WARM_LIGHT, accent: { hue: 250, strength: 80 }, viz: { hue: 150, strength: 80 } });
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
    const navy = generateCustomRoles({ ...WARM_LIGHT, ink: { hue: 280, strength: 100 } });
    expect(hexToLch(navy.ink).hue).toBeCloseTo(280, -1);
    expect(hexToLch(navy.ink).chroma).toBeGreaterThan(hexToLch(base.ink).chroma + 10);
    expect(hexToLch(navy.ink).lightness).toBeCloseTo(hexToLch(base.ink).lightness, 0);
    (['inkMuted', 'inkFaint', 'inkGhost', 'paper', 'accent'] as const).forEach((role) => expect(navy[role]).toBe(base[role]));
  });

  it('is a grey at a strength of 0, on a light or a dark page', () => {
    for (const lightness of [96, 10]) {
      const roles = generateCustomRoles({ ...withBackground(WARM_LIGHT, { lightness }), ink: { hue: 280, strength: 0 } });
      expect(hexToLch(roles.ink).chroma).toBeLessThan(1);
    }
  });

  it('starts from the text’s hue when a preset is converted', () => {
    expect(WARM_LIGHT.ink.hue).toBe(WARM_LIGHT.text.hue);
  });
});

describe('parseCustomColours', () => {
  it('reads back what it was given', () => {
    expect(parseCustomColours(JSON.parse(JSON.stringify(WARM_LIGHT)))).toEqual(WARM_LIGHT);
  });

  it('takes the primary text from the text for a value saved before it was a part, drawing the same `ink`', () => {
    const { ink: _ink, ...saved } = WARM_LIGHT;
    const read = parseCustomColours(JSON.parse(JSON.stringify(saved)))!;
    expect(read.ink).toEqual({ hue: WARM_LIGHT.text.hue, strength: Math.round(WARM_LIGHT.text.strength / 2) });
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
  ])('rejects %s', (_name, value) => {
    expect(parseCustomColours(value)).toBeNull();
  });
});
