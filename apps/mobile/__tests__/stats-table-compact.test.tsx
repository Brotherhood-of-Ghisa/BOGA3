import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { TableGallery } from '@/components/pattern-gallery/table-gallery';
import { resolveComparisonLayout, ComparisonHeaders } from '@/components/stats/comparison-columns';
import { tableGalleryMuscles } from '@/components/pattern-gallery/table-fixtures';
import { StatsTableRow, StatsTableName, StatsTableFamily } from '@/components/stats/stats-table';
import { ListRow, uiGeometry, uiSpace, uiText } from '@/components/ui';

it('shares the compact list recipe and keeps wrapping content free of nested padding/minimums', () => {
  render(<><ListRow density="compact" testID="list"><Text style={uiText.body}>{'Long name\nSecond line'}</Text></ListRow>
    <StatsTableRow testID="table"><StatsTableName name={'Long name\nSecond line'} /></StatsTableRow></>);
  expect(StyleSheet.flatten(screen.getByTestId('table').props.style)).toEqual(StyleSheet.flatten(screen.getByTestId('list').props.style));
  for (const id of ['list', 'table']) {
    const name = within(screen.getByTestId(id)).getByText(/Long name\s+Second line/);
    expect(name.props.numberOfLines).toBeUndefined();
    let inset = name.parent;
    while (inset && StyleSheet.flatten(inset.props.style)?.paddingVertical === undefined) inset = inset.parent;
    expect(inset).toHaveStyle({ paddingVertical: uiSpace.xs });
    expect(StyleSheet.flatten(name.props.style).paddingVertical).toBeUndefined();
  }
});

it('sorts through the real headers and keeps contributor labels, history and disclosure independent', () => {
  render(<TableGallery />);
  expect(screen.getByTestId('stats-muscle-sort-now')).toHaveProp('accessibilityState', { selected: true });
  fireEvent.press(screen.getByTestId('stats-muscle-sort-now'));
  expect(screen.getByTestId('stats-muscle-sort-now-indicator-up', { includeHiddenElements: true })).toBeTruthy();
  const rows = screen.getAllByTestId(/^stats-muscle-row-(?:back_lats|back_upper)$/).map(row => row.props.testID);
  expect(rows).toEqual(['stats-muscle-row-back_upper', 'stats-muscle-row-back_lats']);
  const history = screen.getByTestId('stats-muscle-history-back_lats');
  expect(history).toHaveStyle({ minHeight: uiGeometry.tapTarget });
  expect(StyleSheet.flatten(screen.getByTestId('stats-muscle-row-back_lats').props.style).paddingVertical).toBeUndefined();
  fireEvent.press(history);
  expect(screen.getByTestId('table-gallery-action')).toHaveTextContent('Muscle history · Lats');
  expect(screen.getByTestId('stats-contribution-pulldown')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open Lat Pulldown history' }).props.accessibilityValue.text).toContain('Primary');
  fireEvent.press(screen.getByRole('link', { name: /^Open Lat Pulldown history/ }));
  expect(screen.getByTestId('table-gallery-action')).toHaveTextContent('Exercise history · Lat Pulldown');
  expect(screen.queryByTestId('stats-contributions-header')).toBeNull();
  fireEvent.press(screen.getByTestId('stats-muscle-select-back_lats'));
  expect(screen.queryByTestId('stats-contributions')).toBeNull();
  expect(screen.getByTestId('stats-muscle-select-back_lats')).toHaveProp('accessibilityState', { expanded: false });
});

it.each([375, 402])('keeps complete wide figures and speaks the layout it draws at %ipt', width => {
  const original = Dimensions.get('window');
  act(() => Dimensions.set({ window: { ...original, width } }));
  try {
    render(<TableGallery initialLong />);
    expect(screen.getByTestId('stats-muscle-row-back_lats-now')).toHaveTextContent('1975296');
    const history = screen.getByTestId('stats-muscle-history-back_lats');
    const stacked = screen.UNSAFE_getAllByType(ComparisonHeaders)[0].props.layout.stacked;
    if (stacked) {
      expect(history.props.accessibilityValue.text).toContain('Now 1975296, previous 1234560, change +60%. volume.');
      expect(screen.getByTestId('stats-muscle-row-back_lats-figures').props.accessible).toBeUndefined();
      expect(screen.getByTestId('stats-muscle-row-back_lats-figures')).toHaveStyle({ paddingBottom: 0 });
    } else {
      expect(screen.getByTestId('stats-muscle-row-back_lats-figures')).toHaveProp('accessibilityLabel', 'Now 1975296, previous 1234560, change +60%. volume.');
    }
    expect(within(history).getByText('Latissimus dorsi with a long muscle name').props.numberOfLines).toBeUndefined();
  } finally { act(() => Dimensions.set({ window: original })); }
});

it('uses the production empty/loading/error presenters and recovers through Retry', () => {
  const view = render(<TableGallery initialState="error" />);
  fireEvent.press(screen.getByTestId('table-gallery-retry'));
  expect(screen.getByTestId('stats-muscle-row-back_lats')).toBeTruthy();
  view.unmount();
  const empty = render(<TableGallery initialState="empty" />);
  expect(screen.getByTestId('stats-muscle-list-empty')).toBeTruthy();
  empty.unmount();
  const loading = render(<TableGallery initialState="loading" />);
  expect(screen.getByTestId('table-gallery-loading')).toBeTruthy();
  loading.unmount();
  render(<TableGallery initialState="contributors-empty" />);
  expect(screen.getByTestId('stats-contributions-empty')).toHaveTextContent('No working sets for Lats in either period');
});


it('shows zero, new and unavailable figures without changing the production formatter', () => {
  render(<TableGallery initialState="values" />);
  expect(screen.getByTestId('stats-muscle-row-chest-now')).toHaveTextContent('—');
  expect(screen.getByTestId('stats-muscle-row-back_lats-change')).toHaveTextContent('new');
  expect(screen.getByTestId('stats-muscle-row-quads-now')).toHaveTextContent('0');
  expect(screen.getByTestId('stats-muscle-row-quads-change')).toHaveTextContent('—');
});


it('draws Δ while announcing Change and omits inactive compact arrows', () => {
  render(<TableGallery />);
  expect(within(screen.getByTestId('stats-muscle-sort-change')).getByText('Δ')).toBeTruthy();
  expect(screen.getByTestId('stats-muscle-sort-change').props.accessibilityLabel).toContain('Change, working sets');
  expect(screen.queryByTestId('stats-muscle-sort-change-indicator', { includeHiddenElements: true })).toBeNull();
  fireEvent.press(screen.getByTestId('stats-muscle-sort-change'));
  expect(screen.getByTestId('stats-muscle-sort-change-indicator-down', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('stats-muscle-sort-now-indicator', { includeHiddenElements: true })).toBeNull();
  fireEvent.press(screen.getByTestId('stats-muscle-sort-change'));
  expect(screen.getByTestId('stats-muscle-sort-change-indicator-up', { includeHiddenElements: true })).toBeTruthy();
});

it.each(['name', 'now', 'previous', 'change'] as const)('keeps 44pt column targets and an inline SE3 layout when sorting %s', activeSort => {
  const rows = tableGalleryMuscles();
  const layout = resolveComparisonLayout(375, rows, 'workingSetCount', true, { compact: true, activeSort });
  expect(layout.stacked).toBe(false);
  expect(layout.columns.every(width => width >= uiGeometry.tapTarget)).toBe(true);
  const plain = resolveComparisonLayout(375, rows, 'workingSetCount', true, { compact: true });
  for (const [index, key] of ['now', 'previous', 'change'].entries()) {
    if (key !== activeSort) expect(layout.columns[index]).toBe(plain.columns[index]);
  }
});

it('retains a passive column header and compact role groups in the standalone contributor view', () => {
  render(<TableGallery initialSample="single" />);
  const header = screen.getByTestId('stats-contributions-header');
  expect(within(header).getByText('Δ')).toBeTruthy();
  expect(within(header).queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByRole('header', { name: 'Change, working sets' })).toBeTruthy();
  for (const family of screen.UNSAFE_getAllByType(StatsTableFamily)) expect(family.props.compact).toBe(true);
  expect(screen.getByText('Lat Pulldown')).toHaveStyle(uiText.body);
});
