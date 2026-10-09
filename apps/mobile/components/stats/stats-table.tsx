import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

// Progress's one table style, which both breakdowns are drawn with: a `Card`
// holding a micro-label header row over right-aligned figure columns, and
// `ListRow` data rows under it. A figure column has a fixed width so digits
// align down the list and the name takes the rest; a figure that outgrows its
// column wraps rather than shrinking (`design-language.md` §6). The table
// carries no title: the breakdown control above it says which one this is.

// Plex Mono and Archivo both have a fixed-enough advance at these sizes to
// reserve a column without measuring on device: the fraction of the font size
// one character takes, plus the cell's own breathing room.
const FIGURE_ADVANCE = 0.61;
// Archivo 700 is proportional, so this is a safe upper bound for an uppercase
// micro-label with its 0.1em tracking (`W` is the widest glyph at 1.0em),
// measured on the simulator: a header label is never truncated or wrapped.
const MICRO_LABEL_ADVANCE = 0.95;

/**
 * The width a figure column reserves: the widest full figure it must hold, and
 * never less than its own header label, so neither one wraps while the other
 * has room.
 */
export const statsTableColumnWidth = (headerLabel: string, figures: string[]): number => Math.max(
  headerLabel.length * uiTypography.size.xxs * MICRO_LABEL_ADVANCE,
  ...figures.map(figure => figure.length * uiTypography.size.md * FIGURE_ADVANCE + uiSpace.xs),
);

export function StatsTable({ children, testID }: { children: ReactNode; testID?: string }) {
  return <Card testID={testID}>{children}</Card>;
}

/** The header row: a name cell, then the figure columns in a `StatsTableFigures`. */
export function StatsTableHeader({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View style={styles.header} testID={testID}>{children}</View>;
}

/** The right-aligned figure columns of a header row or a data row. */
export function StatsTableFigures({ children, style, testID }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  return <View style={[styles.figures, style]} testID={testID}>{children}</View>;
}

/** One header column: the micro-label, plus any sort indicator as children. */
export function StatsTableHeaderLabel({ label, active = false }: { label: string; active?: boolean }) {
  return <Text allowFontScaling={false} numberOfLines={1}
    style={[styles.headerLabel, active && styles.headerLabelActive]}>{label}</Text>;
}

export const statsTableStyles = StyleSheet.create({
  // The name takes whatever the figure columns leave, and wraps.
  nameCell: { flex: 1, minWidth: 0 },
  headerCell: { minHeight: uiGeometry.tapTarget, flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  headerCellNumeric: { justifyContent: 'flex-end' },
  name: { fontFamily: uiFonts.display.family, fontWeight: '600', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink, paddingVertical: uiSpace.xs },
  figure: { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md, color: uiRoles.ink, textAlign: 'right' },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'stretch', gap: uiSpace.md, paddingHorizontal: uiSpace.md },
  figures: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  headerLabel: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase', color: uiRoles.inkMuted },
  headerLabelActive: { color: uiRoles.ink },
});
