import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { TableGallery } from '@/components/pattern-gallery/table-gallery';
import { StatsTableRow, StatsTableName } from '@/components/stats/stats-table';
import { ListRow, uiGeometry, uiSpace, uiText } from '@/components/ui';

it('shares the compact list recipe and keeps wrapping content free of nested padding/minimums', () => {
  render(<><ListRow density="compact" testID="list"><Text style={uiText.bodyStrong}>{'Long name\nSecond line'}</Text></ListRow>
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
  expect(within(screen.getByTestId('stats-contributions-header')).queryAllByRole('button')).toHaveLength(0);
  fireEvent.press(screen.getByTestId('stats-muscle-select-back_lats'));
  expect(screen.queryByTestId('stats-contributions')).toBeNull();
  expect(screen.getByTestId('stats-muscle-select-back_lats')).toHaveProp('accessibilityState', { expanded: false });
});

it.each([375, 402])('keeps the complete wide figures and speaks stacked content at %ipt', width => {
  const original = Dimensions.get('window');
  act(() => Dimensions.set({ window: { ...original, width } }));
  try {
    render(<TableGallery initialLong />);
    expect(screen.getByTestId('stats-muscle-row-back_lats-now')).toHaveTextContent('1975296');
    const history = screen.getByTestId('stats-muscle-history-back_lats');
    expect(history.props.accessibilityValue.text).toContain('Now 1975296, previous 1234560, change +60%. volume.');
    expect(screen.getByTestId('stats-muscle-row-back_lats-figures').props.accessible).toBeUndefined();
    expect(screen.getByTestId('stats-muscle-row-back_lats-figures')).toHaveStyle({ paddingBottom: 0 });
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
