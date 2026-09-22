import {
  uiBorder,
  uiColors,
  uiElevation,
  uiFonts,
  uiGeometry,
  uiRadius,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';

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

  it('keeps the shipped font weights at their shipped values', () => {
    // The embedded typefaces bring weights the scale lacks (Archivo 800). They
    // belong to `uiFonts`, not here: adding or repointing a key in this object
    // changes what shipped screens resolve to.
    expect(uiTypography.weight).toEqual({
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    });
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

  // The whole-object assertions below are the real guard. Spot-checking a few
  // keys would leave `uiSpace`, `uiRadius`, `uiBorder` and `uiElevation`
  // uncovered, and repointing `uiSpace.lg` restyles every shipped screen just
  // as surely as repointing a colour does.
  it('leaves the legacy colour palette untouched — roles are a separate vocabulary', () => {
    expect(uiColors).toEqual({
      actionPrimary: '#0f5cc0',
      actionPrimaryDisabled: '#96afcf',
      actionPrimarySubtleBg: '#eaf2ff',
      actionPrimarySubtleBorder: '#cfe1ff',
      actionDanger: '#b3261e',
      actionDangerText: '#8a2323',
      actionDangerSubtleBg: '#fff0f0',
      actionDangerSubtleBorder: '#f3c5c5',
      actionNeutralSubtleBg: '#eef2f9',
      actionNeutralSubtleBorder: '#c7d3e8',
      actionNeutralSubtleText: '#20324f',
      borderDefault: '#d0d0d0',
      borderStrong: '#6f6f6f',
      borderInputStrong: '#b7c6dd',
      borderSuccess: '#b9dfc3',
      borderWarning: '#f0c9a5',
      borderMuted: '#dbe3ef',
      overlayScrim: 'rgba(0, 0, 0, 0.35)',
      overlayScrimSoft: 'rgba(0, 0, 0, 0.28)',
      surfaceDisabled: '#f4f6fa',
      surfaceDefault: '#ffffff',
      surfaceInfo: '#f5f9ff',
      surfaceMuted: '#fafafa',
      surfacePage: '#f4f7fb',
      surfaceReadOnly: '#f4f4f4',
      surfaceSuccess: '#effcf3',
      surfaceWarning: '#fff7ee',
      textPrimary: '#122033',
      textSuccess: '#125d2f',
      textSecondary: '#56667f',
      textDisabled: '#8190a8',
      textMuted: '#555555',
      textWarning: '#7f4214',
      textAccentStrong: '#0f2a46',
      textAccentMuted: '#37516f',
      actionSuccess: '#1f8740',
      heatmapNeutralBg: '#edf2f6',
      heatmapNeutralBorder: '#cfdae5',
      heatmapBucket1: '#dff4e5',
      heatmapBucket2: '#aee4bd',
      heatmapBucket3: '#68c57f',
      heatmapBucket4: '#218f46',
      failureBackgroundFamily1: '#f1faf3',
      failureBackgroundFamily2: '#e2f5e7',
      failureBackgroundFamily3: '#ccebd5',
      failureBackgroundFamily4: '#b5e1c1',
      failureBackgroundMuscle1: '#fffaf0',
      failureBackgroundMuscle2: '#fff3d6',
      failureBackgroundMuscle3: '#ffe7ad',
      failureBackgroundMuscle4: '#ffd784',
      heatmapTodayBg: '#e8f4ff',
      heatmapTodayBorder: '#7bbcf4',
      heatmapTodayMarker: '#2f8ed8',
      heatmapSelectedBorder: '#0f5cc0',
      rowActiveBackground: '#eef5ff',
      rowActiveBorder: '#a9c7f5',
      rowPlannedBackground: '#e8eef7',
      rowPlannedBorder: '#b8c7da',
      rowSwipeDeleteBackground: '#fff0f0',
      rowSwipeIcon: '#20324f',
      rowSwipeText: '#20324f',
    });
  });

  it('leaves the spacing, radius, border and elevation scales untouched', () => {
    expect(uiSpace).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
    expect(uiRadius).toEqual({ sm: 8, md: 12, full: 999 });
    expect(uiBorder).toEqual({ width: 1 });
    expect(uiElevation).toEqual({
      // `flat` must stay an empty object: it adds no style keys, so the default
      // render tree is identical to before elevation existed.
      flat: {},
      raised: {
        shadowColor: '#122033',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
      overlay: {
        shadowColor: '#122033',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
      },
    });
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
        'scrim',
        'surface',
        'surfaceSubtle',
      ].sort(),
    );
  });

  it('carries the design-language geometry of §4 as its own vocabulary', () => {
    // Added 2026-09-22 (step 3) beside `uiRadius` / `uiSpace` rather than into
    // them, so the legacy scales above stay byte-identical and can be retired
    // wholesale at switch-over.
    expect(uiGeometry).toEqual({
      radius: { card: 6, sheet: 16 },
      tapTarget: 44,
      metricValueWidth: 38,
      sheetHandle: { width: 38, height: 4 },
      microLabelTracking: 0.1,
    });
  });

  it('dims a sheet backdrop with ink, not a neutral black', () => {
    expect(uiRoles.scrim).toBe('rgba(21, 24, 29, 0.42)');
    // `ink` (#15181D) is rgb(21, 24, 29).
    expect(uiRoles.ink).toBe('#15181D');
  });

  it('carries exactly the typefaces and weights named in design-language.md §3', () => {
    expect(uiFonts).toEqual({
      display: { family: 'Archivo', weights: ['600', '700', '800'] },
      body: { family: 'Source Sans 3', weights: ['400', '600'] },
      figure: { family: 'IBM Plex Mono', weights: ['500', '600', '700'] },
    });
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
    // `record` figures sit inside the `record-wash` band, so that pairing is a
    // real reading surface too — and the wash is the value most likely to be
    // "warmed up" later.
    expect(contrastRatio(uiRoles.record, uiRoles.recordWash)).toBeGreaterThanOrEqual(4.5);
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
