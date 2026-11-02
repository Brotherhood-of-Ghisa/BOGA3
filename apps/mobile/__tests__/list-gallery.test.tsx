import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ListGallery } from '@/components/pattern-gallery/list-gallery';
import { COMPACT_ROW_FIXTURES } from '@/components/pattern-gallery/compact-row-fixtures';
import { listGalleryWeekBoard } from '@/components/pattern-gallery/list-fixtures';
import { ListRow, uiSpace, uiText } from '@/components/ui';

it('preserves passive row identities, order, full names, unabridged figures and the single board action', () => {
  render(<ListGallery initialLong />);
  expect(screen.getAllByTestId(/^group-home-board-row-u\d$/).map(row => row.props.testID)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'].map(id => `group-home-board-row-${id}`));
  expect(screen.getByTestId('group-home-board-row-u0-name')).toHaveProp('numberOfLines', 1);
  expect(screen.getByTestId('group-home-board').props.accessibilityLabel).toContain('Contessa Serbelloni Mazzanti Vien dal Mare, 123456');
  expect(screen.getByTestId('today-group-board').props.accessibilityLabel).toContain('123456 sets, 12345 PRs');
  expect(screen.getByTestId('today-group-board-row-u0-working-sets')).toHaveTextContent('123456');
  expect(screen.getByTestId('today-group-board-row-u0-fill')).toHaveStyle({ width: '100%' });
  expect(screen.getByTestId('today-group-board-row-u0').props.onPress).toBeUndefined();
  fireEvent.press(screen.getByTestId('today-group-board'));
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Board · g1');
});

it('keeps own and tied rows in the feature models and ellipsizes only the visible name', () => {
  const view = render(<ListGallery initialState="own" />);
  expect(screen.getByTestId('today-group-board-row-me-name')).toHaveTextContent('You');
  expect(screen.getByTestId('today-group-board-row-me-name')).toHaveStyle(uiText.bodyStrong);
  expect(screen.queryByTestId('today-group-board-me')).toBeNull();
  view.unmount();
  render(<ListGallery initialState="ties" />);
  for (const prefix of ['group-home-board', 'today-group-board']) {
    expect(screen.getByTestId(`${prefix}-row-u0-rank`)).toHaveTextContent('1');
    expect(screen.getByTestId(`${prefix}-row-u1-rank`)).toHaveTextContent('1');
    expect(screen.getByTestId(`${prefix}-row-u2-rank`)).toHaveTextContent('3');
  }
});

it('keeps the group switch, heading and CoW outside the board action', () => {
  render(<ListGallery initialSample="actions" />);
  fireEvent.press(screen.getByTestId('today-group-title'));
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Group home · g1');
  fireEvent.press(screen.getByTestId('today-cow-current'));
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Current CoW');
  fireEvent.press(screen.getByTestId('today-group-switch'));
  fireEvent.press(screen.getByTestId('today-group-switch-g2'));
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Group · g2');
  fireEvent.press(screen.getByTestId('today-group-board'));
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Board · g2');
});

it('offers identical row-only content and insets in list and table hosts', () => {
  render(<ListGallery initialSample="rows" />);
  for (const surface of ['list', 'table']) {
    for (const fixture of COMPACT_ROW_FIXTURES) {
      const row = screen.getByTestId(`${surface}-row-${fixture.id}`);
      expect(within(row).getByText(fixture.name)).toBeTruthy();
      expect(StyleSheet.flatten(within(row).getByText(fixture.name).parent?.parent?.props.style)).toMatchObject({ paddingVertical: uiSpace.xs });
    }
    fireEvent.press(screen.getByTestId(`${surface}-row-action`));
    expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Row action');
    fireEvent.press(screen.getByTestId(`${surface}-history`));
    expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('History');
    fireEvent.press(screen.getByTestId(`${surface}-disclosure`));
    expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Contributions');
  }
  expect(screen.UNSAFE_getAllByType(ListRow).every(row => row.props.density === 'compact')).toBe(true);
});

it.each(['ready', 'own', 'ties'] as const)('keeps large %s fixtures ordered and ties equal', state => {
  const normal = listGalleryWeekBoard(state, false);
  const long = listGalleryWeekBoard(state, true);
  expect(long.rows.map(row => [row.userId, row.rank])).toEqual(normal.rows.map(row => [row.userId, row.rank]));
  for (let index = 1; index < long.rows.length; index++) {
    const previous = long.rows[index - 1];
    const row = long.rows[index];
    expect(row.workingSets).toBeLessThanOrEqual(previous.workingSets);
    if (row.rank === previous.rank) {
      expect([row.workingSets, row.groupRecords]).toEqual([previous.workingSets, previous.groupRecords]);
    }
  }
});

it('recovers a failed reference read through its existing retry and preserves empty/loading/offline states', () => {
  render(<ListGallery initialState="error" />);
  expect(screen.getByTestId('group-glance-error-state')).toBeTruthy();
  fireEvent.press(screen.getByTestId('group-glance-error-state-retry'));
  expect(screen.getByTestId('group-home-board-row-u0')).toBeTruthy();
  expect(screen.getByTestId('list-gallery-action')).toHaveTextContent('Retry');
});

it.each(['empty', 'loading', 'offline'])('renders the %s fixture without inventing row actions', state => {
  render(<ListGallery initialState={state} />);
  expect(screen.getByTestId(`ui-gallery-list-boards-${state}-normal`)).toBeTruthy();
  expect(screen.queryByTestId('group-home-board-row-u0')).toBeNull();
});
