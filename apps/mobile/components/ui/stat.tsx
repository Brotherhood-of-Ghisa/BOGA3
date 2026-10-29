import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

export type StatLayout = 'stacked' | 'inline';
export type StatRank = 'primary' | 'secondary';
export type StatState = 'realised' | 'planned';
export type StatEmphasis = 'none' | 'record';
export type StatKind = 'figure' | 'text' | 'heading';
export type StatGround = 'plain' | 'viz';

export type StatProps = {
  // The legend, as written (`1RM`, `Vol`); rendered uppercase.
  label: string;
  // The legend as read aloud, when `label` is abbreviated (`Ex` → `Exercises`).
  spokenLabel?: string;
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
  // `ink-faint`, the legend in `inkGhost`.
  state?: StatState;
  // `record`: bold `record`, an all-time best — the one superlative. Ignored
  // for planned values, which cannot be one (`design-language.md` §5).
  emphasis?: StatEmphasis;
  // `text` sets the value in the body face (a profile's email), not the figure
  // face; `heading` in the card-title face, on a headline figure's line so it
  // shares that figure's baseline beside it (the session's gym).
  kind?: StatKind;
  // Stacked only: `end` right-aligns label and value (a trailing column).
  align?: 'start' | 'end';
  // `viz`: the stat sits on a data-viz ground (`viz1`–`viz4`), where
  // `ink-faint` is illegible, so the legend is `ink` (`design-language.md` §2).
  ground?: StatGround;
  // Inline only: `fixed` sets the value in `metricValueWidth`, so legends
  // align down a list; `hug` keeps the legend a fixed gap from its value, for
  // a caller that sets the column's width itself (the set summary row).
  valueWidth?: 'fixed' | 'hug';
  testID?: string;
};

// A labelled metric in the design language. Figures are monospaced so they
// align down a column; the legend is an Archivo micro-label.
export function Stat({
  label,
  spokenLabel = label,
  value,
  layout = 'stacked',
  rank = 'primary',
  state = 'realised',
  emphasis = 'none',
  kind = 'figure',
  align = 'start',
  ground = 'plain',
  valueWidth = 'fixed',
  testID,
}: StatProps) {
  const planned = state === 'planned';
  const legendStyle = [
    uiText.label,
    uiTextTone.faint,
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
      <View accessibilityLabel={`${spokenLabel} ${value}`} accessible style={styles.inline} testID={testID}>
        <Text allowFontScaling={false} style={legendStyle}>{label}</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[valueStyle, valueWidth === 'fixed' ? styles.inlineValue : null]}>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${spokenLabel} ${value}`}
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
  legendPlanned: {
    color: uiRoles.inkGhost,
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

// A headline figure; in a list row, the row's `figure`; a profile's text value,
// the name that heads a block; a heading beside headline figures.
const stackedValueStyles = {
  figure: uiText.figureStat,
  rowFigure: uiText.figure,
  text: uiText.bodyStrong,
  // `title`, on `figureStat`'s line height: iOS adds the extra leading above
  // the glyphs, so the word sits on the same bottom line as the figures.
  heading: [uiText.title, { lineHeight: uiText.figureStat.lineHeight }],
};

// The set row's 1RM line in ink, its quieter VOL line muted. Plex Mono 500 is
// its lightest embedded face, so a `record` (700) stands out from it.
const inlineValueStyles = {
  primary: [uiText.figureSmall, uiTextTone.ink],
  secondary: uiText.figureSmall,
};

const emphasisStyles: Record<StatEmphasis, TextStyle | null> = {
  none: null,
  record: uiTextTone.record,
};
