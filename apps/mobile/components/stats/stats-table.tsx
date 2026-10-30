import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card, Icon, uiBorder, uiGeometry, uiRoles, uiSpace, uiText, uiTextTone, uiTypography } from '@/components/ui';

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
// measured on the simulator, so each label keeps its full width.
const MICRO_LABEL_ADVANCE = 0.95;

/**
 * The width a figure column reserves: the widest full figure it must hold, and
 * never less than its own header label, so neither one wraps while the other
 * has room. `labelExtra` is anything the header draws beside that label — a
 * sort indicator — which would otherwise push the label out of its column.
 */
export const statsTableColumnWidth = (
  headerLabel: string, figures: string[], labelExtra = 0,
): number => Math.max(
  headerLabel.length * uiTypography.size.xxs * MICRO_LABEL_ADVANCE + labelExtra,
  ...figures.map(figure => figure.length * uiTypography.size.base * FIGURE_ADVANCE + uiSpace.xs),
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
    style={[uiText.label, active && uiTextTone.ink]}>{label}</Text>;
}

/** Shared sortable header; the caller names its ordering and next action. */
export function StatsTableSortHeader({ label, active, descending, description, currentSort, nextSort, onPress,
  testID, style, numeric = false, recent = false }: {
  label: string; active: boolean; descending: boolean; description: string; currentSort: string; nextSort: string;
  onPress: () => void; testID: string; style?: StyleProp<ViewStyle>; numeric?: boolean; recent?: boolean;
}) {
  const direction = active && !descending ? 'up' : 'down';
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
    accessibilityLabel={`${description}.${active ? ` Current sort: ${currentSort}.` : ''} Activate to sort ${nextSort}.`}
    onPress={onPress} testID={testID}
    style={({ pressed }) => [statsTableStyles.headerCell, style,
      numeric && styles.numericSortHeader, pressed && styles.pressed]}>
    <StatsTableHeaderLabel active={active} label={label} />
    <View accessible={false} testID={`${testID}-indicator`}
      style={[styles.indicator, recent && styles.recency, !active && styles.hidden]}>
      {recent ? <StatsTableHeaderLabel label="Recent" /> : null}
      <Icon color={uiRoles.ink} name={direction === 'up' ? 'arrow-up' : 'arrow-down'} size="xs"
        testID={`${testID}-indicator-${direction}`} />
    </View>
  </Pressable>;
}

export function StatsTableFamily({ name, testID }: { name: string; testID?: string }) {
  return <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, styles.family]} testID={testID}>{name}</Text>;
}

export const statsTableStyles = StyleSheet.create({
  // The name takes whatever the figure columns leave, and wraps.
  nameCell: { flex: 1, minWidth: 0 },
  headerCell: { minHeight: uiGeometry.tapTarget, flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  headerCellNumeric: { justifyContent: 'flex-end' },
  // A row's name and a figure cell: layout only, after `uiText.bodyStrong` and
  // `uiText.figure`.
  name: { paddingVertical: uiSpace.xs },
  figure: { textAlign: 'right' },
});

const styles = StyleSheet.create({
  numericSortHeader: { flexDirection: 'row-reverse', justifyContent: 'flex-start' },
  family: { paddingTop: uiSpace.md, paddingBottom: uiSpace.sm,
    paddingHorizontal: uiSpace.md, borderTopWidth: uiBorder.width, borderColor: uiRoles.rule },
  pressed: { backgroundColor: uiRoles.paper },
  indicator: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  recency: { width: 64 },
  hidden: { opacity: 0 },
  header: { flexDirection: 'row', alignItems: 'stretch', gap: uiSpace.md, paddingHorizontal: uiSpace.md },
  figures: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
});
