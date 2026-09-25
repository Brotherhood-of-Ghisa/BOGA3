import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type StatLayout = 'stacked' | 'inline';
export type StatRank = 'primary' | 'secondary';
export type StatState = 'realised' | 'planned';
export type StatEmphasis = 'none' | 'record';
export type StatKind = 'figure' | 'text';
export type StatGround = 'plain' | 'viz';

export type StatProps = {
  // The legend, as written (`1RM`, `Vol`); rendered uppercase.
  label: string;
  // Pre-formatted by the caller: no thousands separators, no unit suffix
  // (`design-language.md` §6).
  value: string;
  // `stacked`: label above value (summary card, records panel). `inline`: a
  // mini legend left of a fixed-width, right-aligned value (the set row).
  layout?: StatLayout;
  // Inline: `primary` is the 1RM line, `secondary` the quieter VOL line.
  // Stacked: `primary` is a headline figure (a summary card), `secondary` a
  // figure in a row of a list (a Progress muscle row).
  rank?: StatRank;
  // A planned value is not yet realised: it is shown, but faded — the value in
  // `ink-faint`, the legend in `planned`.
  state?: StatState;
  // `record`: bold `record`, an all-time best — the one superlative. Ignored
  // for planned values, which cannot be one (`design-language.md` §5).
  emphasis?: StatEmphasis;
  // `text` sets the value in the body face (a gym name), not the figure face.
  kind?: StatKind;
  // Stacked only: `end` right-aligns label and value (a trailing column).
  align?: 'start' | 'end';
  // `viz`: the stat sits on a data-viz ground (`viz1`–`viz4`), where
  // `ink-faint` is illegible, so the legend is `ink` (`design-language.md` §2).
  ground?: StatGround;
  testID?: string;
};

// A labelled metric in the design language. Figures are monospaced so they
// align down a column; the legend is an Archivo micro-label.
export function Stat({
  label,
  value,
  layout = 'stacked',
  rank = 'primary',
  state = 'realised',
  emphasis = 'none',
  kind = 'figure',
  align = 'start',
  ground = 'plain',
  testID,
}: StatProps) {
  const planned = state === 'planned';
  const legendStyle = [
    styles.legend,
    planned ? styles.legendPlanned : null,
    ground === 'viz' ? styles.legendOnViz : null,
  ];
  const valueStyle = [
    layout === 'inline'
      ? inlineValueStyles[rank]
      : kind === 'figure' && rank === 'secondary'
        ? stackedValueStyles.rowFigure
        : stackedValueStyles[kind],
    planned ? styles.valuePlanned : emphasisStyles[emphasis],
  ];

  if (layout === 'inline') {
    return (
      <View accessibilityLabel={`${label} ${value}`} accessible style={styles.inline} testID={testID}>
        <Text allowFontScaling={false} style={legendStyle}>{label}</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[valueStyle, styles.inlineValue]}>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${label} ${value}`}
      accessible
      style={align === 'end' ? styles.stackedEnd : null}
      testID={testID}>
      <Text allowFontScaling={false} style={legendStyle}>{label}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={valueStyle}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  legendPlanned: {
    color: uiRoles.planned,
  },
  legendOnViz: {
    color: uiRoles.ink,
  },
  valuePlanned: {
    color: uiRoles.inkFaint,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: uiSpace.xs,
  },
  inlineValue: {
    width: uiGeometry.metricValueWidth,
    textAlign: 'right',
  },
  stackedEnd: {
    alignItems: 'flex-end',
  },
});

const figure = uiFonts.figure.family;

const stackedValueStyles = StyleSheet.create({
  figure: {
    fontFamily: figure,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  // A figure in a list row: one rung above body, lighter than a headline.
  rowFigure: {
    fontFamily: figure,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  text: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    // The figure's line-height, so a text value sits level with the figures
    // beside it in a summary row.
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});

// Plex Mono ships 500/600/700 only; 500 is its lightest embedded face, and
// the realised default so that a `record` (700) stands out from it.
const inlineValueStyles = StyleSheet.create({
  primary: {
    fontFamily: figure,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  secondary: {
    fontFamily: figure,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
});

const emphasisStyles: Record<StatEmphasis, TextStyle | null> = {
  none: null,
  record: { fontWeight: '700', color: uiRoles.record },
};
