/**
 * Progress's heatmaps and RM curve on the shared text roles
 * (`design-language.md` §3, "Text roles"): legends, axes and ticks are the
 * faint micro-label, figures take a figure role, and a line of words keeps a
 * word role with only its digits in Plex Mono (`FigureText`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';
import { Text as SvgText } from 'react-native-svg';

import { DailyHeatmap, TimelineHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { HeatmapLegend } from '@/components/heatmaps/HeatmapLegend';
import { periodColour } from '@/components/rm-curve/chart';
import { RmCurveContent } from '@/components/rm-curve/content';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { DailyEffortMetrics } from '@/src/data';
import { buildRmCurveModel } from '@/src/rm-curve/model';
import { waveGraph } from './helpers/rm-curve-history';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;
const hidden = (id: string) => screen.getByTestId(id, { includeHiddenElements: true });

const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const BODY_STRONG = { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const FAINT_LABEL = { ...LABEL, color: uiRoles.inkFaint };
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base };
const FIGURE_SMALL = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.sm };
const PLEX = { fontFamily: uiFonts.figure.family };

const TODAY = '2026-10-09';
const days: DailyEffortMetrics[] = [
  { dateKey: '2026-10-05', totalVolume: 1000, workingSetCount: 4, estimatedRM1: 140, highestWeight: 120,
    personalRecordCounts: { totalVolume: 2, estimatedRM1: 1, highestWeight: 3 } },
  { dateKey: '2026-10-07', totalVolume: 1400, workingSetCount: 5, estimatedRM1: 150, highestWeight: 120 },
];
const data = buildHeatmapData(days, 'totalVolume', { todayDateKey: TODAY, weeks: 12 });

describe('Daily heatmap', () => {
  it('titles a month in meta with its year in the figure face, and draws gutter, headers and tiles on their roles', () => {
    render(<DailyHeatmap data={data} formatValue={String} metricLabel="Volume" testIDPrefix="h" />);
    const title = screen.getByTestId('h-heatmap-month-title-2026-10');
    expect(style(title)).toMatchObject(META);
    expect(style(within(title).getByText('2026'))).toMatchObject(PLEX);
    expect(style(screen.getByTestId('h-heatmap-row-label-2026-10-05'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.inkMuted, textAlign: 'right' });
    expect(style(screen.getAllByText('Week')[0])).toMatchObject({ ...LABEL, color: uiRoles.inkMuted, textAlign: 'center' });
    expect(style(screen.getByTestId('h-heatmap-cell-2026-10-07-value'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.ink, textAlign: 'center' });
  });

  it('draws the legend as the faint micro-label', () => {
    render(<HeatmapLegend />);
    for (const text of ['% of max', '0%', '100%']) expect(style(screen.getByText(text))).toMatchObject(FAINT_LABEL);
  });
});

describe('Weekly heatmap', () => {
  it('draws the bar value as a figure, PRs as a record meta line, an empty month in ink meta and the axis faint', () => {
    render(<WeeklyHeatmap data={data} metric="totalVolume" testIDPrefix="w" formatValue={String} />);
    expect(style(screen.getByTestId('w-heatmap-value-2026-10-05'))).toMatchObject({ ...FIGURE, color: uiRoles.ink, textAlign: 'right' });
    const prs = screen.getByTestId('w-heatmap-prs-2026-10-05');
    expect(prs).toHaveTextContent('2 PRs');
    expect(style(prs)).toMatchObject({ ...META, color: uiRoles.record, fontWeight: '700', position: 'absolute' });
    // The record line's figure is as heavy as its words.
    expect(style(within(prs).getByText('2'))).toMatchObject({ ...PLEX, color: uiRoles.record, fontWeight: '700' });
    const empty = within(screen.getByTestId('w-heatmap-empty-month-2026-08')).getByText(/August/);
    expect(style(empty)).toMatchObject({ ...META, color: uiRoles.ink });
    expect(style(within(empty).getByText('2026'))).toMatchObject(PLEX);
    expect(style(screen.getAllByTestId(/^w-heatmap-axis-value-/, { includeHiddenElements: true })[0])).toMatchObject({ ...FAINT_LABEL, position: 'absolute' });
  });
});

describe('Timeline', () => {
  it('titles the focused week with its dates in the figure face, its figure figureLarge and unit, ticks and months faint labels', () => {
    render(<TimelineHeatmap data={data} metric="totalVolume" selectedWeekKey={null} onSelectWeek={jest.fn()} testIDPrefix="t"
      formatValue={String} metricLabel="Volume" unitLabel={() => 'volume'} />);
    const week = hidden('t-timeline-readout-week');
    expect(style(week)).toMatchObject({ fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg });
    expect(style(within(week).getByText('5', { includeHiddenElements: true }))).toMatchObject(PLEX);
    const value = hidden('t-timeline-readout-value');
    expect(style(value)).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.lg });
    expect(style(within(value).getByText('volume', { includeHiddenElements: true }))).toMatchObject(FAINT_LABEL);
    expect(style(hidden('t-timeline-tick-0'))).toMatchObject({ ...FAINT_LABEL, position: 'absolute' });
    expect(style(screen.getAllByTestId(/^t-timeline-month-/, { includeHiddenElements: true })[0])).toMatchObject(FAINT_LABEL);
  });
});

describe('RM curve', () => {
  const props = () => ({ read: { status: 'ready' as const, retry: jest.fn(),
    data: buildRmCurveModel(waveGraph(), { start: new Date(2026, 0, 1), end: new Date(2027, 0, 1), historyLookbackWeeks: 52 }) },
    scope: { range: 'history' as const, gym: {}, rir: null }, onScope: jest.fn(),
    dateFormat: 'YYYY-MM-DD' as const, historyWeeks: 52, progressWeeks: 4 });

  it('names its filters in bodyStrong and choices in body, and draws word lines in body with figures in Plex Mono', () => {
    jest.useFakeTimers();
    render(<RmCurveContent {...props()} />);
    act(() => { jest.runAllTimers(); });
    expect(style(screen.getByText('All gyms'))).toMatchObject({ ...BODY_STRONG, color: uiRoles.ink });
    const counts = screen.getByText(/sets · /);
    expect(style(counts)).toMatchObject({ ...BODY, color: uiRoles.ink });
    expect(style(within(counts).getAllByText(/^\d+$/)[0])).toMatchObject(PLEX);
    expect(style(screen.getByText('REPS + RIR'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expect(style(screen.getByTestId('rm-fit-state'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
    const fitting = screen.getByText(/fitting sessions/);
    expect(style(fitting)).toMatchObject(BODY);
    expect(style(within(fitting).getByText(/^\d+$/))).toMatchObject(PLEX);
    const legend = screen.getByText(/All dates · 1RM/);
    expect(style(legend)).toMatchObject({ ...BODY, color: periodColour('all'), flexShrink: 1 });
    // `1RM` is a word; only the value after it is a figure.
    expect(within(legend).queryByText('1')).toBeNull();
    fireEvent.press(screen.getByLabelText('gym: All gyms'));
    expect(style(within(screen.getByTestId('rm-curve-sheet')).getAllByText('All gyms')[0])).toMatchObject({ ...BODY, color: uiRoles.ink });
    jest.useRealTimers();
  });

  it('draws its axis ticks as the faint micro-label', () => {
    jest.useFakeTimers();
    render(<RmCurveContent {...props()} />);
    act(() => { jest.runAllTimers(); });
    const tick = screen.UNSAFE_getAllByType(SvgText)[0].props;
    expect(tick).toMatchObject({ fill: uiRoles.inkFaint, fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs });
    jest.useRealTimers();
  });

  it('draws the selected set\'s lines in body, its figures in the figure role and its headings as labels', () => {
    jest.useFakeTimers();
    render(<RmCurveContent {...props()} />);
    act(() => { jest.runAllTimers(); });
    fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
    const details = within(screen.getByTestId('rm-curve-details'));
    expect(style(details.getByText('SELECTED SET'))).toMatchObject(LABEL);
    const period = screen.getByTestId('rm-selected-period');
    expect(style(period)).toMatchObject({ ...BODY, color: periodColour('all') });
    const set = details.getByText(/block \d+, set \d+/);
    expect(style(set)).toMatchObject({ ...BODY, color: uiRoles.ink });
    expect(style(within(set).getAllByText(/^\d+$/)[0])).toMatchObject(PLEX);
    expect(style(details.getByText(/^\d+ \/ \d+$/))).toMatchObject(FIGURE);
    const load = details.getByText(/^Equivalent reps/);
    expect(style(load)).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
    expect(style(within(load).getAllByText(/^[\d.]+$/)[0])).toMatchObject(PLEX);
    jest.useRealTimers();
  });
});
