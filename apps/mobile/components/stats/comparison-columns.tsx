import { Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { changeToneColour, FigureText, uiBorder, uiGeometry, uiIconSize, uiSpace, uiText } from '@/components/ui';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';
import { formatOneRepMax } from '@/src/exercise-calculations/format';
import type { ProgressExerciseMetric } from '@/src/preferences/model';

import {
  formatCountDelta, formatOneRepMaxDelta, formatVolumeDelta, type DeltaDisplay,
} from './comparison-format';
import {
  StatsTableFigures, StatsTableHeader, StatsTableHeaderLabel,
  statsTableColumnWidth, statsTableStyles,
} from './stats-table';

// The three columns both Progress breakdowns are drawn with — the period in
// force, the one before it ([[comparison.window]]), and the change between
// them ([[comparison.change-display]]) — and the layout that decides whether
// they still fit beside the row's name. Both tables put spoken header
// labels or shared sort controls over them; neither owns the
// columns, and a figure means the same thing in both.

/** The figure the columns show. 1RM is a metric only an exercise has. */
export type ComparisonMetric = ProgressExerciseMetric;

/** One period's figures, as many of them as the row's subject has. */
export type ComparisonPeriodFigures = {
  workingSetCount: number;
  totalVolume: number | null;
  volumeSetCount?: number;
  /** A muscle has none: the Muscle table never offers the 1RM metric. */
  estimatedOneRepMax?: number | null;
};

export type ComparisonRow = {
  current: ComparisonPeriodFigures;
  previous: ComparisonPeriodFigures;
};

// The columns, drawn and spoken. `Prev` is abbreviated so three figure columns
// and the name fit one line on a small phone; the unit belongs to the spoken
// label, never the header.
export const COLUMN_LABELS = ['Now', 'Prev', 'Change'] as const;
export const COLUMN_NAMES = ['Now', 'Previous', 'Change'] as const;
export const COLUMN_KEYS = ['now', 'previous', 'change'] as const;

export type ComparisonColumnKey = (typeof COLUMN_KEYS)[number];

export const metricUnit = (metric: ComparisonMetric): string =>
  metric === 'totalVolume' ? 'volume' : metric === 'estimatedOneRepMax' ? '1RM' : 'working sets';

const metricValue = (period: ComparisonPeriodFigures, metric: ComparisonMetric): number | null =>
  metric === 'workingSetCount' ? period.workingSetCount
    : metric === 'totalVolume' ? period.totalVolume
      : period.estimatedOneRepMax ?? null;

const metricFigure = (period: ComparisonPeriodFigures, metric: ComparisonMetric): string => {
  if (metric === 'workingSetCount') return Number.isFinite(period.workingSetCount) ? String(period.workingSetCount) : '—';
  if (metric === 'totalVolume') return formatVolumeFigure(period.totalVolume);
  const estimate = period.estimatedOneRepMax ?? null;
  return estimate !== null && Number.isFinite(estimate) ? formatOneRepMax(estimate) : '—';
};

const metricChange = (row: ComparisonRow, metric: ComparisonMetric): DeltaDisplay => {
  if (metric === 'workingSetCount') return formatCountDelta(row.current.workingSetCount, row.previous.workingSetCount);
  if (metric === 'totalVolume') return formatVolumeDelta(row.current.totalVolume, row.previous.totalVolume);
  return formatOneRepMaxDelta(row.current.estimatedOneRepMax ?? null, row.previous.estimatedOneRepMax ?? null);
};

/** The row's three figures: the two periods, then their change with its direction. */
export const comparisonFigures = (row: ComparisonRow, metric: ComparisonMetric): {
  now: string; previous: string; change: DeltaDisplay;
} => ({
  now: metricFigure(row.current, metric),
  previous: metricFigure(row.previous, metric),
  change: metricChange(row, metric),
});

/** The same three figures as text, in column order — what a column reserves room for. */
export const comparisonColumnTexts = (row: ComparisonRow, metric: ComparisonMetric): string[] => {
  const figures = comparisonFigures(row, metric);
  return [figures.now, figures.previous, figures.change.text];
};

/** True when either period has something to show for the metric. */
export const hasComparisonMetric = (row: ComparisonRow, metric: ComparisonMetric): boolean => {
  if (metric === 'workingSetCount') return row.current.workingSetCount > 0 || row.previous.workingSetCount > 0;
  if (metric === 'totalVolume') return (row.current.volumeSetCount ?? 0) > 0 || (row.previous.volumeSetCount ?? 0) > 0;
  return (row.current.estimatedOneRepMax ?? null) !== null || (row.previous.estimatedOneRepMax ?? null) !== null;
};

// Volume's change sorts by the percentage it shows, 1RM's by the kg it shows.
const changeSortValue = (row: ComparisonRow, metric: ComparisonMetric): number | null => {
  if (metric === 'workingSetCount') return row.current.workingSetCount - row.previous.workingSetCount;
  const current = metricValue(row.current, metric);
  const previous = metricValue(row.previous, metric);
  if (current === null || previous === null) return null;
  if (metric === 'estimatedOneRepMax') return current - previous;
  return previous === 0 ? null : ((current - previous) / previous) * 100;
};

/**
 * What a column sorts by. A column with no number in it — an absent figure, or
 * a change that is `new` or unavailable — is `null` here and sorts last in
 * both directions, so no ordering leads with blanks.
 */
export const comparisonSortValues = (
  row: ComparisonRow, metric: ComparisonMetric,
): Record<ComparisonColumnKey, number | null> => ({
  now: metricValue(row.current, metric),
  previous: metricValue(row.previous, metric),
  change: changeSortValue(row, metric),
});

export const compareOptionalNumbers = (
  left: number | null,
  right: number | null,
  descending: boolean
): number => {
  const validLeft = left !== null && Number.isFinite(left) ? left : null;
  const validRight = right !== null && Number.isFinite(right) ? right : null;
  if (validLeft === null && validRight === null) return 0;
  if (validLeft === null) return 1;
  if (validRight === null) return -1;
  if (validLeft === validRight) return 0;
  if (descending) return validLeft > validRight ? -1 : 1;
  return validLeft < validRight ? -1 : 1;
};

export type ComparisonLayout = { columns: number[]; stacked: boolean };

/**
 * The figure columns, and whether they still fit beside the name. A column is
 * as wide as its widest full figure, capped so three of them plus any trailing
 * control's axis never outgrow the row; the name keeps a tap target and a step
 * of its own, or the figures take their own line under it. `axis` is the
 * column a row reserves for its control (the Muscle table's disclosure) — a
 * table whose rows carry none passes `false`. `sortable` adds the room a
 * sort indicator takes beside each header label (the Exercise table's), so an
 * active column's arrow never crowds the next column.
 */
export const resolveComparisonLayout = (
  width: number, rows: ComparisonRow[], metric: ComparisonMetric, axis = true, sortable = false,
): ComparisonLayout => {
  const rowContent = width - uiSpace.lg * 2 - uiBorder.width * 2 - uiSpace.md * 2;
  const gaps = uiSpace.sm * (COLUMN_LABELS.length - 1);
  const axisWidth = axis ? uiGeometry.tapTarget : 0;
  const indicator = sortable ? uiIconSize.xs + uiSpace.xs : 0;
  const cap = (rowContent - axisWidth - uiSpace.md - gaps) / COLUMN_LABELS.length;
  const columns = COLUMN_LABELS.map((label, index) => Math.min(cap,
    statsTableColumnWidth(label, rows.map(row => comparisonColumnTexts(row, metric)[index]), indicator)));
  const nameRoom = rowContent - axisWidth - uiSpace.md * 2
    - columns.reduce((sum, value) => sum + value, 0) - gaps;
  return { columns, stacked: nameRoom < uiGeometry.tapTarget + uiSpace.xl };
};

export type ComparisonColumnPosition = {
  key: ComparisonColumnKey; label: string; name: string; index: number;
};

/**
 * The header row, which mirrors a data row: the name cell, the figure columns,
 * and any trailing control's empty axis, stacking with the rows so a label
 * stays over its column. `column` draws one figure column's header — the plain
 * spoken micro-label by default, a sort control where the table has one.
 */
export function ComparisonHeaders({ name, layout, metric, axis = true, testID, column }: {
  name: ReactNode; layout: ComparisonLayout; metric: ComparisonMetric; axis?: boolean; testID: string;
  column?: (position: ComparisonColumnPosition, width: number) => ReactNode;
}) {
  const columns = <StatsTableFigures style={layout.stacked && styles.stackedFigures}>
    {COLUMN_LABELS.map((label, index) => {
      const width = layout.columns[index];
      const header = column
        ? column({ key: COLUMN_KEYS[index], label, name: COLUMN_NAMES[index], index }, width)
        : <View accessible accessibilityRole="header"
          accessibilityLabel={`${COLUMN_NAMES[index]}, ${metricUnit(metric)}`}
          style={[statsTableStyles.headerCell, statsTableStyles.headerCellNumeric, { width }]}>
          <StatsTableHeaderLabel label={label} />
        </View>;
      return <Fragment key={label}>{header}</Fragment>;
    })}
  </StatsTableFigures>;
  return <StatsTableHeader testID={testID}>
    <View style={[statsTableStyles.headerCell, statsTableStyles.nameCell, layout.stacked && styles.stackedName]}>
      {name}
      {layout.stacked ? columns : null}
    </View>
    {layout.stacked ? null : columns}
    {axis ? <View style={styles.axis} /> : null}
  </StatsTableHeader>;
}

/**
 * One row's figures, spoken as one phrase and drawn in the columns. The change
 * carries its direction's colour (`change-tone.ts`); the periods stay ink.
 * `speak` is false where the whole row is one target and says the figures
 * itself (the Exercise table): a reader never reaches an element inside a
 * pressable row, so offering one there would only lose the phrase.
 */
export function ComparisonValues({ row, metric, layout, prefix, speak = true }: {
  row: ComparisonRow; metric: ComparisonMetric; layout: ComparisonLayout; prefix: string; speak?: boolean;
}) {
  const figures = comparisonFigures(row, metric);
  const texts = [figures.now, figures.previous, figures.change.text];
  const changeColour = { color: changeToneColour(figures.change.tone) };
  return <View accessible={speak || undefined}
    accessibilityLabel={speak ? `Now ${figures.now}, previous ${figures.previous}, change ${figures.change.text}. ${metricUnit(metric)}.` : undefined}
    style={layout.stacked && styles.stackedFigures} testID={`${prefix}-figures`}>
    <StatsTableFigures style={layout.stacked && styles.stackedValues} testID={`${prefix}-values`}>
      {texts.map((value, index) => <ComparisonCell key={COLUMN_KEYS[index]} text={value} width={layout.columns[index]}
        colour={COLUMN_KEYS[index] === 'change' ? changeColour : undefined} testID={`${prefix}-${COLUMN_KEYS[index]}`} />)}
    </StatsTableFigures>
  </View>;
}

// One figure column's cell. A change that reads as a word (`new`, `Increased`)
// is a word, so it leaves the figure face (`design-language.md` §3).
function ComparisonCell({ text, width, colour, testID }: {
  text: string; width: number; colour?: { color: string }; testID: string;
}) {
  const word = /[A-Za-z]/.test(text);
  return <Text allowFontScaling={false} style={[word ? uiText.body : uiText.figure, statsTableStyles.figure, { width }, colour]}
    testID={testID}>{word ? <FigureText>{text}</FigureText> : text}</Text>;
}

const styles = StyleSheet.create({
  axis: { width: uiGeometry.tapTarget },
  stackedName: { flexDirection: 'column', alignItems: 'stretch' },
  stackedValues: { justifyContent: 'flex-end' },
  stackedFigures: { alignSelf: 'stretch', width: '100%', justifyContent: 'flex-end', paddingBottom: uiSpace.xs },
});
