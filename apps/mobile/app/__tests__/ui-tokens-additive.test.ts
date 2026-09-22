import { uiColors, uiRoles, uiTypography } from '@/components/ui';

// `docs/plans/exercise-session-redesign.md` rule 1: while the new screens are
// built beside the existing recorder, the token layer is the one layer that
// cannot be built in parallel — repointing an existing value restyles every
// shipped screen and breaks its Maestro lane. So new roles and rungs are added
// and nothing existing moves. These assertions are what makes that a gate
// rather than a promise; they are meant to be deleted by the switch-over step
// that retires `uiColors`.

describe('design tokens stay additive during the exercise/session rebuild', () => {
  it('keeps the seven shipped type rungs at their shipped values', () => {
    expect(uiTypography.size.xs).toBe(11);
    expect(uiTypography.size.sm).toBe(12);
    expect(uiTypography.size.md).toBe(13);
    expect(uiTypography.size.base).toBe(14);
    expect(uiTypography.size.lg).toBe(16);
    expect(uiTypography.size.xl).toBe(18);
    expect(uiTypography.size.xxl).toBe(24);

    expect(uiTypography.lineHeight.xs).toBe(15);
    expect(uiTypography.lineHeight.sm).toBe(16);
    expect(uiTypography.lineHeight.md).toBe(18);
    expect(uiTypography.lineHeight.base).toBe(20);
    expect(uiTypography.lineHeight.lg).toBe(22);
    expect(uiTypography.lineHeight.xl).toBe(24);
    expect(uiTypography.lineHeight.xxl).toBe(30);
  });

  it('adds exactly one rung, for micro-labels, below the shipped floor', () => {
    expect(uiTypography.size.xxs).toBe(10);
    expect(uiTypography.lineHeight.xxs).toBe(14);

    const sizes = Object.values(uiTypography.size);
    expect(sizes).toHaveLength(8);
    expect(Math.min(...sizes)).toBe(uiTypography.size.xxs);
    // Every size has a line-height, keyed by the same name (ux-rules §9a.2).
    expect(Object.keys(uiTypography.lineHeight).sort()).toEqual(
      Object.keys(uiTypography.size).sort(),
    );
  });

  it('leaves the legacy palette untouched — roles are a separate vocabulary', () => {
    expect(uiColors).not.toHaveProperty('ink');
    expect(uiColors).not.toHaveProperty('paper');
    expect(uiColors).not.toHaveProperty('record');
    // Spot-check the values the shipped screens actually depend on.
    expect(uiColors.actionPrimary).toBe('#0f5cc0');
    expect(uiColors.surfacePage).toBe('#f4f7fb');
    expect(uiColors.textPrimary).toBe('#122033');
  });

  it('carries every colour role named in design-language.md §2', () => {
    expect(Object.keys(uiRoles).sort()).toEqual(
      [
        'accent',
        'accentWash',
        'danger',
        'disabled',
        'ink',
        'inkFaint',
        'inkMuted',
        'paper',
        'planned',
        'record',
        'recordRule',
        'recordWash',
        'rule',
        'ruleFaint',
        'ruleSoft',
        'ruleStrong',
        'surface',
        'surfaceSubtle',
      ].sort(),
    );
  });

  it('keeps `record` a different colour from `accent`', () => {
    // The collision resolved 2026-09-22: "your best ever" and "the button that
    // commits" must not read as the same mark. Regressing this is silent — both
    // roles keep working, they just stop meaning different things.
    expect(uiRoles.record).not.toBe(uiRoles.accent);
    expect(uiRoles.recordWash).not.toBe(uiRoles.accentWash);
  });

  it('keeps `record` legible as text on both grounds', () => {
    // WCAG 2.1 normal-text minimum; `record` is applied to figures, not just
    // to a band. Guards against a later "warm it up a bit" losing the floor.
    expect(contrastRatio(uiRoles.record, uiRoles.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiRoles.record, uiRoles.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
