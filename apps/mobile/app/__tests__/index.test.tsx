import { render } from '@testing-library/react-native';

import IndexScreen from '../index';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: 'index-redirect' }, href),
  };
});

describe('IndexScreen', () => {
  it('redirects the root `/` route to `/today`', () => {
    const { getByTestId } = render(<IndexScreen />);
    const redirectNode = getByTestId('index-redirect');
    expect(redirectNode.props.children).toBe('/today');
  });

  it('does not render the legacy session-list shell at the root', () => {
    const { queryByText } = render(<IndexScreen />);
    expect(queryByText('Active')).toBeNull();
    expect(queryByText('History')).toBeNull();
  });
});
