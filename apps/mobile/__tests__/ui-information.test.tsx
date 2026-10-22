import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal, ScrollView, StyleSheet } from 'react-native';

import { Icon, IconButton, Information, uiFonts, uiGeometry, uiIconSize, uiRoles, uiSpace } from '@/components/ui';

it('offers a labelled 44pt target and keeps the 16pt glyph 4pt from an adjacent heading', () => {
  render(<Information label="Example" title="About Example" body="Lorem ipsum." testIDPrefix="example" />);
  const button = screen.getByRole('button', { name: 'About Example' });
  expect(button).toHaveStyle({ width: 44, height: 44 });
  const icon = screen.UNSAFE_getByType(Icon);
  expect(icon.props).toMatchObject({ name: 'info', size: 'sm' });
  const margin = StyleSheet.flatten(screen.UNSAFE_getByType(IconButton).parent!.props.style).marginLeft;
  expect(margin + (uiGeometry.tapTarget - uiIconSize.sm) / 2).toBe(uiSpace.xs);
  expect(screen.getByRole('header', { name: 'Example' })).toHaveStyle({ fontFamily: uiFonts.display.family });
  expect(screen.queryByText('Lorem ipsum.')).toBeNull();
});

it.each(['backdrop', 'escape', 'back'])('reads arbitrary help and dismisses through %s, then reopens', (path) => {
  render(<Information title="About Example" body="Lorem ipsum." sections={[
    ['First section', 'Dolor sit amet.'], ['Last section', 'Consectetur adipiscing elit.'],
  ]} testIDPrefix="example" />);
  fireEvent.press(screen.getByTestId('example-info'));
  const panel = screen.getByTestId('example-help');
  const help = within(panel);
  expect(panel).toHaveStyle({ backgroundColor: uiRoles.surface });
  expect(help.getByRole('header', { name: 'About Example' })).toHaveStyle({ fontFamily: uiFonts.display.family, color: uiRoles.ink });
  expect(help.getByText('Lorem ipsum.')).toHaveStyle({ fontFamily: uiFonts.body.family, color: uiRoles.inkMuted });
  expect(help.getByRole('header', { name: 'Last section' })).toBeTruthy();
  expect(help.getByText('Consectetur adipiscing elit.')).toBeTruthy();
  expect(StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.style)).toMatchObject({ flexShrink: 1 });
  expect(help.queryAllByRole('button')).toHaveLength(0);
  if (path === 'backdrop') fireEvent.press(screen.getByTestId('example-help-backdrop', { includeHiddenElements: true }));
  if (path === 'escape') fireEvent(panel, 'accessibilityEscape');
  if (path === 'back') fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(screen.queryByTestId('example-help')).toBeNull();
  fireEvent.press(screen.getByTestId('example-info'));
  expect(screen.getByText('Lorem ipsum.')).toBeTruthy();
});

it('supports a short explanation without an adjacent heading, sections or test IDs', () => {
  render(<Information title="About Example" body="Lorem ipsum." />);
  expect(screen.queryAllByRole('header')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'About Example' }));
  expect(screen.getAllByRole('header')).toHaveLength(1);
  expect(screen.getByText('Lorem ipsum.')).toBeTruthy();
});
