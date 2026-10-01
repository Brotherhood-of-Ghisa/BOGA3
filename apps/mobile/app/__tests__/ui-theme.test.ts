import { uiRoles } from '@/components/ui';
import { hexToLch, lchToHex, withAlpha } from '@/components/ui/lch';
import { defaultThemeSeeds, generateRoles, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';

// The theme generator (`docs/specs/ui/design-language.md` §2, "Derivation"):
// every colour role is generated from four seeds. These tests pin that the
// shipped seeds reproduce the shipped palette, and that the rules the palette
// is gated on hold for seeds other than the shipped ones.

// The palette as rationalised and picked on device, 2026-09-27. The generator
// was calibrated to it; a role drifting further than ΔE*ab 3 from it is a
// visible change and needs its own design decision.
const PICKED_PALETTE: Omit<UiRoles, 'scrim'> = {
  ink: '#1B1712',
  inkMuted: '#6B6358',
  inkFaint: '#9B948A',
  inkGhost: '#BAB2A7',
  paper: '#F6F4EF',
  surface: '#FFFFFF',
  rule: '#E2DCD0',
  ruleSoft: '#EFEAE0',
  accent: '#C2410C',
  accentWash: '#FFF4EF',
  record: '#8A6516',
  recordWash: '#FBF3E2',
  recordRule: '#EEDFBE',
  danger: '#A4262C',
  viz0: '#F0ECE7',
  viz1: '#E7D7CA',
  viz2: '#D3BDAB',
  viz3: '#BCA18A',
  viz4: '#A4866B',
};

// Seeds no theme ships with, chosen to pull the generator away from the warm
// default: a cool slate ground, a green ground, and hues on the far side of
// the wheel for the accent, record and ramp.
const OTHER_SEEDS: Record<string, ThemeSeeds> = {
  slate: { ground: '#5B6470', accent: '#1F6FB2', record: '#8A6516', viz: '#5F7F96' },
  forest: { ground: '#5E6659', accent: '#2F7D4F', record: '#8C5A12', viz: '#6E8A62' },
  plum: { ground: '#665D66', accent: '#8E3B8A', record: '#7A6A12', viz: '#8A6F8A' },
};

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

  it('uses the accent and record seeds as given, and never themes `danger` or `surface`', () => {
    for (const seeds of [defaultThemeSeeds, ...Object.values(OTHER_SEEDS)]) {
      const roles = generateRoles(seeds);
      expect(roles.accent).toBe(seeds.accent);
      expect(roles.record).toBe(seeds.record);
      expect(roles.danger).toBe('#A4262C');
      expect(roles.surface).toBe('#FFFFFF');
      expect(roles.scrim).toBe(withAlpha(roles.ink, 0.42));
    }
  });

  it('throws on a seed that is not #RRGGBB', () => {
    expect(() => generateRoles({ ...defaultThemeSeeds, accent: 'orange' })).toThrow('expected #RRGGBB');
  });

  describe.each(Object.entries({ default: defaultThemeSeeds, ...OTHER_SEEDS }))('for the %s seeds', (_name, seeds) => {
    const roles = generateRoles(seeds);
    const ground = hexToLch(seeds.ground);

    it('gives no two roles the same value', () => {
      const values = Object.values(roles);
      expect(new Set(values).size).toBe(values.length);
    });

    it('steps the neutrals in a fixed lightness order on the ground hue', () => {
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
      for (const neutral of [roles.inkMuted, roles.inkFaint, roles.inkGhost, roles.rule]) {
        expect(hueDistance(hexToLch(neutral).hue, ground.hue)).toBeLessThanOrEqual(10);
      }
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
