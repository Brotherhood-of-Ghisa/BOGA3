import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, ListCard, ListCardHeader, ListRow, uiBorder, uiGeometry, uiRoles, uiSpace, uiText } from '@/components/ui';

it('gives passive compact content one shared line and 4pt insets without a touch minimum', () => {
  render(<ListRow density="compact" label="Alex" leading={<Text testID="rank">1</Text>}
    meta={<Text testID="value">128</Text>} testID="row" />);
  const row = screen.getByTestId('row');
  expect(row).toHaveStyle({ paddingHorizontal: uiSpace.md, gap: uiSpace.sm, borderTopWidth: uiBorder.width });
  expect(StyleSheet.flatten(row.props.style).minHeight).toBeUndefined();
  expect(screen.getByText('Alex')).toHaveStyle(uiText.body);
  for (const content of [screen.getByText('Alex'), screen.getByTestId('rank'), screen.getByTestId('value')]) {
    expect(StyleSheet.flatten(content.parent?.parent?.props.style)).toMatchObject({ paddingVertical: uiSpace.xs });
  }
  expect(row.props.onPress).toBeUndefined();
});

it('keeps a control target at 44 with no row padding added around it', () => {
  const control = jest.fn();
  render(<ListRow density="compact" label="Two line name" description="Second line" testID="row"
    trailing={<IconButton name="more-vertical" accessibilityLabel="Row actions" onPress={control} testID="control" />} />);
  expect(screen.UNSAFE_getAllByType(View).map(node => StyleSheet.flatten(node.props.style))).toContainEqual(
    expect.objectContaining({ minHeight: uiGeometry.tapTarget, width: uiGeometry.tapTarget }));
  expect(StyleSheet.flatten(screen.getByTestId('row').props.style).paddingVertical).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByText('Two line name').parent?.parent?.props.style)).toMatchObject({ paddingVertical: uiSpace.xs });
  fireEvent.press(screen.getByTestId('control'));
  expect(control).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('row').props.accessible).toBeUndefined();
});

it('retains selected/own emphasis and the independent row action', () => {
  const open = jest.fn();
  const view = render(<ListRow density="compact" own label="You" onPress={open} testID="row" />);
  expect(screen.getByText('You')).toHaveStyle(uiText.bodyStrong);
  expect(screen.getByTestId('row')).toHaveStyle({ minHeight: uiGeometry.tapTarget, backgroundColor: uiRoles.paper });
  fireEvent.press(screen.getByTestId('row'));
  expect(open).toHaveBeenCalledTimes(1);
  view.rerender(<ListRow density="compact" selected label="Selected" testID="row" />);
  expect(screen.getByTestId('row')).toHaveStyle({ backgroundColor: uiRoles.accentWash });
});

it('puts an independent history target around its inset content, beside disclosure', () => {
  const history = jest.fn();
  const disclosure = jest.fn();
  render(<ListRow density="compact" label="Lat pulldown" testID="row"
    contentAction={{ onPress: history, accessibilityLabel: 'Open history', accessibilityRole: 'link', testID: 'history' }}
    trailing={<IconButton name="chevron-down" accessibilityLabel="Show contributions" onPress={disclosure} testID="disclosure" />} />);
  expect(screen.getByTestId('history')).toHaveStyle({ minHeight: uiGeometry.tapTarget, justifyContent: 'center' });
  expect(StyleSheet.flatten(screen.getByTestId('history').props.style).paddingVertical).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByText('Lat pulldown').parent?.parent?.props.style)).toMatchObject({ paddingVertical: uiSpace.xs });
  fireEvent.press(screen.getByTestId('history'));
  expect(history).toHaveBeenCalledTimes(1);
  expect(disclosure).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('disclosure'));
  expect(disclosure).toHaveBeenCalledTimes(1);
  expect(history).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('row').props.accessible).toBeUndefined();
});

it('keeps the header outside the labelled board region and the footer inside it', () => {
  const board = jest.fn();
  const header = jest.fn();
  render(<ListCard header={<ListCardHeader label="This week" metadata="26 Oct – 1 Nov 26" metadataTestID="date"
    trailing={<IconButton name="swap" accessibilityLabel="Switch" onPress={header} testID="switch" />} />}
    columnLabels={<Text>Sets</Text>} footer={<Text>You, 6th, 58</Text>}
    onPress={board} accessibilityLabel="Board, Alex 128 sets" regionTestID="board">
    <ListRow density="compact" label="Alex" />
  </ListCard>);
  expect(screen.getByTestId('date')).toHaveStyle({ marginLeft: 0, textAlign: 'left' });
  fireEvent.press(screen.getByTestId('switch'));
  expect(header).toHaveBeenCalledTimes(1);
  expect(board).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('board'));
  expect(board).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('board').props.accessibilityLabel).toBe('Board, Alex 128 sets');
  expect(screen.getByText('You, 6th, 58')).toBeTruthy();
});
